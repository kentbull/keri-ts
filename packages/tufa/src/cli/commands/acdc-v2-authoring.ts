/** Tufa parses/configures ACDC v2 authoring; wallet owns state transitions and acceptance. */
import { RegistryCustody, WalletAuthor } from "@keri-ts/wallet";
import { type MapperMap, MtrDex, Salter, type SerderACDC, type SerderKERI } from "cesr-ts";
import { type Operation, race, scoped, sleep, spawn } from "effection";
import { parseBooleanOption, parseGvrsn, parseNumberOption, parseStringOption } from "keri-ts/cli";
import {
  type AgentRuntime,
  approveAcdcV2Registry,
  type Hab,
  type Habery,
  isLocalGroupHab,
  publishAcdcV2Registry,
  Receiptor,
  type RegistryDisclosure,
  runAgentRuntime,
  Schemer,
  ValidationError,
} from "keri-ts/runtime";
import { withHabAndAgentRuntime } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { openWallet, walletStoreArgs } from "../support/wallet.ts";

/** Inline JSON and explicit files retain their semantic values; builders own credential structure. */
function section(value: unknown, flag: string): MapperMap | undefined {
  const text = parseStringOption(value, flag);
  if (text === undefined) return undefined;
  const parsed: unknown = JSON.parse(text.startsWith("@") ? Deno.readTextFileSync(text.slice(1)) : text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError(`${flag} must be a JSON object.`);
  }
  return parsed as MapperMap;
}
/** Require explicit identifiers before acquiring store handles. */
function required(value: unknown, flag: string): string {
  const text = parseStringOption(value, flag);
  if (!text) throw new ValidationError(`--${flag} is required.`);
  return text;
}

/** Complete one explicit member approval using the existing shared processors and witness receipt owner. */
export function* approveAcdcV2RegistryEvent(
  hby: Habery,
  runtime: AgentRuntime,
  hab: Hab,
  receiptor: Receiptor,
  event: SerderACDC,
  opening?: RegistryDisclosure,
  proposal: { anchor?: SerderKERI; salts?: Readonly<Record<string, string>> } = {},
): Operation<void> {
  const approved = yield* approveAcdcV2Registry(hby, runtime.protocol, hab, event, { opening, ...proposal });
  yield* publishAcdcV2Registry(hby, runtime.postman, hab, approved);
  const anchor = (approved[0].sad!.a as { anc: string }).anc;
  const sealing = hby.db.getEvtSerder(hab.pre, anchor)!;
  const regid = event.ilk === "rip" ? event.said! : event.regid!;
  while (runtime.acdc!.store.seqEvent(regid, Number(BigInt(`0x${event.sad!.n}`)))?.said !== event.said) {
    if (hby.db.kels.getLast(hab.pre, sealing.sn!) === anchor) {
      yield* receiptor.receipt(hab.pre, { sn: sealing.sn!, allowTcp: true });
    }
    yield* runtime.protocol.processEscrowsOnce();
    if (runtime.acdc!.store.seqEvent(regid, Number(BigInt(`0x${event.sad!.n}`)))?.said === event.said) break;
    yield* sleep(100);
  }
}

/** Compose one finite author operation and print acceptance only after all owned stores close. */
export function* acdcV2AuthorCommand(
  args: Record<string, unknown>,
  operation: "incept" | "issue" | "update" | "revoke",
): Operation<void> {
  const name = required(args.registryName, "registry-name"), alias = required(args.alias, "alias");
  const publicOpening = parseBooleanOption(args.public, "public") ?? false;
  const withCustody = parseBooleanOption(args.withCustody, "with-custody") ?? false;
  if ((Array.isArray(args.send) ? args.send.length : args.send) || args.out || args.estOnly) {
    throw new ValidationError("ACDC v2 authoring uses registrar replay and the controller's establishment-only trait.");
  }
  const timeout = parseNumberOption(args.timeout, "timeout") ?? 60;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new ValidationError("ACDC v2 authoring --timeout must be positive.");
  }
  const result = yield* race([
    (function* () {
      return yield* withHabAndAgentRuntime(
        walletStoreArgs(args),
        alias,
        { skipConfig: false },
        function* ({ hby, runtime, hab }) {
          return yield* scoped(function* () {
            if (!runtime.acdc) throw new ValidationError("ACDC v2 registry evidence is unavailable.");
            const wallet = yield* openWallet(hby, runtime.acdc.store, runtime.exc);
            const custody = withCustody || (operation !== "incept" && !publicOpening)
              ? new RegistryCustody({ hby, registry: wallet.registry, db: wallet.db })
              : undefined;
            const author = new WalletAuthor(
              wallet,
              runtime.acdc,
              new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock, {
                gvrsn: parseGvrsn(args.witnessGvrsn ?? "1"),
              }),
              custody,
            );
            const group = isLocalGroupHab(hby, hab);
            if (group) yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: true }));
            function* approve(event: SerderACDC, opening?: RegistryDisclosure): Operation<void> {
              yield* approveAcdcV2RegistryEvent(hby, runtime, hab, author.receiptor, event, opening);
            }
            if (operation === "incept") {
              if (args.discloser && !withCustody) throw new ValidationError("--discloser requires --with-custody.");
              if (custody && (!hby.mgr.aeid || !hby.mgr.seed)) {
                throw new ValidationError("Private custody requires an authenticated encrypted Keeper.");
              }
              const reg = group
                ? runtime.acdc.registryByName(name) ?? runtime.acdc.makeRegistry(name, hab.pre)
                : undefined;
              if (reg && reg.hab.pre !== hab.pre) {
                throw new ValidationError("Registry belongs to a different controller.");
              }
              const event = reg ? reg.store.event(reg.regk!)! : yield* author.incept(name, hab.pre);
              const discloser = parseStringOption(args.discloser, "discloser") ?? hab.pre;
              if (group && custody) {
                // Resume the original signed proposal via join rather than generating
                // another salt for an already proposed or accepted inception.
                if (
                  runtime.acdc.store.seqEvent(event.said!, 0) ||
                  hby.db.pses.getLast(hab.pre, hab.kever!.sn + 1)
                ) {
                  throw new ValidationError(
                    "Registry inception already exists; use multisig join --v2 --said for its retained proposal",
                  );
                }
                const root = new Salter({ code: MtrDex.Salt_128, raw: crypto.getRandomValues(new Uint8Array(16)) });
                const salts = custody.sealMembers(hab, root);
                yield* approveAcdcV2RegistryEvent(hby, runtime, hab, author.receiptor, event, undefined, { salts });
                custody.receiveRoot(event.said!, discloser, root);
              } else if (group) {
                yield* approve(event);
              }
              const info = custody?.createCustody(event.said!, discloser);
              return {
                registry: event.said,
                controller: hab.pre,
                accepted: true,
                ...(info ? { discloser: info.discloser } : {}),
              };
            }
            const reg = author.registry(name, hab.pre),
              options = { public: publicOpening, boundEvent: parseStringOption(args.boundEvent, "bound-event") };
            if (operation === "issue") {
              let schema = parseStringOption(args.schema, "schema");
              const schemaFile = parseStringOption(args.schemaFile, "schema-file");
              if (schemaFile) {
                const schemer = new Schemer({ raw: Deno.readFileSync(schemaFile) });
                if (schema && schema !== schemer.said) throw new ValidationError("Schema file differs from --schema.");
                hby.db.schema.pin(schemer.said, schemer);
                schema = schemer.said;
              }
              const acdc = author.create(reg, {
                schema,
                issuee: parseStringOption(args.recipient, "recipient"),
                attribute: section(args.data, "data"),
                edge: section(args.edges, "edges"),
                rule: section(args.rules, "rules"),
              });
              const staged = group ? author.stage(reg, acdc, "issued", options) : undefined;
              if (staged) yield* approve(staged.event, staged.opening);
              const record = staged
                ? wallet.recordIssued(acdc, staged.event.said!, { blinder: staged.opening })
                : yield* author.issue(reg, acdc, options);
              return {
                credential: record.credential,
                registry: record.registry,
                update: record.update,
                accepted: true,
              };
            }
            const said = required(args.said, "said");
            if (group) {
              if (wallet.db.issued.get([said])?.registry !== reg.regk) {
                throw new ValidationError("Credential is not in this registry's issued inventory.");
              }
              const staged = operation === "revoke"
                ? author.stageRevocation(reg, said, options)
                : author.stage(reg, wallet.issuedCredential(said), required(args.state, "state"), options);
              yield* approve(staged.event, staged.opening);
              return { credential: said, registry: reg.regk, update: staged.event.said, accepted: true };
            }
            const event = operation === "revoke"
              ? yield* author.revoke(reg, said, options)
              : yield* author.update(reg, wallet.issuedCredential(said), required(args.state, "state"), options);
            return { credential: said, registry: reg.regk, update: event.said, accepted: true };
          });
        },
      );
    })(),
    (function* () {
      yield* sleep(timeout * 1000);
      throw new ValidationError("ACDC v2 authoring timed out before authenticated acceptance.");
    })(),
  ]);
  writeJsonLine(result);
}

/** ACDC v2 state advance shares the same finite operation, not the historical upd builder. */
export function* acdcV2UpdateCommand(args: Record<string, unknown>): Operation<void> {
  yield* acdcV2AuthorCommand(args, "update");
}
