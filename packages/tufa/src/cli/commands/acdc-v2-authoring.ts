/** Tufa parses/configures ACDC v2 authoring; wallet owns state transitions and acceptance. */
import { RegistryCustody, WalletAuthor } from "@keri-ts/wallet";
import { type MapperMap, type SerderACDC } from "cesr-ts";
import { call, type Operation, race, scoped, sleep, spawn } from "effection";
import { parseBooleanOption, parseGvrsn, parseNumberOption, parseStringOption } from "keri-ts/cli";
import {
  type AcdcMapOptions,
  type AcdcV2Registry,
  type AgentRuntime,
  approveAcdcV2Registry,
  type Hab,
  type Habery,
  isLocalGroupHab,
  publishAcdcV2Registry,
  Receiptor,
  type RegistryDisclosure,
  registryEventRef,
  registryEventStatus,
  runAgentRuntime,
  Schemer,
  settleRegistryEvent,
  validateAcdcSchema,
  ValidationError,
  type WitnessAuthMap,
} from "keri-ts/runtime";
import { withHabAndAgentRuntime } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { openWallet, walletStoreArgs } from "../support/wallet.ts";
import { authoringWitnessAuths } from "../support/witness-auth.ts";

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
  auths?: WitnessAuthMap,
): Operation<void> {
  const approved = yield* approveAcdcV2Registry(hby, runtime.protocol, hab, event, { opening });
  yield* publishAcdcV2Registry(hby, runtime.postman, hab, approved);
  const anchor = (approved[0].sad!.a as { anc: string }).anc;
  const sealing = hby.db.getEvtSerder(hab.pre, anchor)!;
  const deps = { db: hby.db, store: runtime.acdc!.store, protocol: runtime.protocol };
  const ref = registryEventRef(event, { pre: hab.pre, sn: sealing.sn!, said: anchor });
  while (registryEventStatus(deps, ref).state !== "accepted") {
    if (hby.db.kels.getLast(hab.pre, sealing.sn!) === anchor) {
      yield* receiptor.receipt(hab.pre, { sn: sealing.sn!, allowTcp: true, auths });
    }
    if ((yield* settleRegistryEvent(deps, ref)).state === "accepted") break;
    yield* sleep(100);
  }
}

/** Write a fresh public credential body without creating custody, issuing a BUP or recording inventory. */
export function* prepareAcdcV2Credential(
  author: WalletAuthor,
  reg: AcdcV2Registry,
  options: Omit<AcdcMapOptions, "regid">,
  output: string,
): Operation<SerderACDC> {
  if (reg.store.headEvent(reg.regk!)?.ilk !== "rip") {
    throw new ValidationError("Credential preparation requires a fresh accepted registry inception");
  }
  const credential = author.create(reg, options);
  const schema = validateAcdcSchema(credential, author.wallet.hby.db);
  if (schema.kind !== "valid") {
    throw new ValidationError(schema.kind === "missing" ? `Missing ACDC schema: ${schema.said}` : schema.reason);
  }
  yield* call(() => Deno.writeFile(output, credential.raw, { createNew: true, mode: 0o600 }));
  return credential;
}

/** Compose one finite author operation and print acceptance only after all owned stores close. */
export function* acdcV2AuthorCommand(
  args: Record<string, unknown>,
  operation: "incept" | "issue" | "update" | "revoke",
): Operation<void> {
  const name = required(args.registryName, "registry-name"), alias = required(args.alias, "alias");
  const publicOpening = parseBooleanOption(args.public, "public") ?? false;
  const withCustody = parseBooleanOption(args.withCustody, "with-custody") ?? false;
  const prepare = parseBooleanOption(args.prepare, "prepare") ?? false;
  const output = parseStringOption(args.out, "out");
  if (prepare && (operation !== "issue" || !output || publicOpening || withCustody || args.boundEvent)) {
    throw new ValidationError("--prepare requires vc create --acdc-v2 --out without custody or BUP options");
  }
  if ((Array.isArray(args.send) ? args.send.length : args.send) || (output && !prepare) || args.estOnly) {
    throw new ValidationError("ACDC v2 authoring uses registrar replay and the controller's establishment-only trait.");
  }
  const timeout = parseNumberOption(args.timeout, "timeout") ?? 60;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new ValidationError("ACDC v2 authoring --timeout must be positive.");
  }
  const result = yield* race([
    (function*() {
      return yield* withHabAndAgentRuntime(
        walletStoreArgs(args),
        alias,
        { skipConfig: false },
        function*({ hby, runtime, hab }) {
          return yield* scoped(function*() {
            if (!runtime.acdc) throw new ValidationError("ACDC v2 registry evidence is unavailable.");
            const auths = prepare ? undefined : authoringWitnessAuths(hab, args);
            const wallet = yield* openWallet(hby, runtime.acdc.store, runtime.exc);
            const custody = !prepare && (withCustody || (operation !== "incept" && !publicOpening))
              ? new RegistryCustody({ hby, hab, registry: wallet.registry, db: wallet.db })
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
            if (group && !prepare) yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: true }));
            function* approve(event: SerderACDC, opening?: RegistryDisclosure): Operation<void> {
              yield* approveAcdcV2RegistryEvent(hby, runtime, hab, author.receiptor, event, opening, auths);
            }
            if (operation === "incept") {
              if (custody && (!hby.mgr.aeid || !hby.mgr.seed)) {
                throw new ValidationError("Private custody requires an authenticated encrypted Keeper.");
              }
              const reg = group
                ? runtime.acdc.registryByName(name) ?? runtime.acdc.makeRegistry(name, hab.pre)
                : undefined;
              if (reg && reg.hab.pre !== hab.pre) {
                throw new ValidationError("Registry belongs to a different controller.");
              }
              const event = reg ? reg.store.event(reg.regk!)! : yield* author.incept(name, hab.pre, auths);
              if (group) yield* approve(event);
              custody?.createCustody(event.said!);
              return {
                registry: event.said,
                controller: hab.pre,
                accepted: true,
              };
            }
            const reg = author.registry(name, hab.pre),
              options = { auths, public: publicOpening, boundEvent: parseStringOption(args.boundEvent, "bound-event") };
            if (operation === "issue") {
              let schema = parseStringOption(args.schema, "schema");
              const schemaFile = parseStringOption(args.schemaFile, "schema-file");
              if (schemaFile) {
                const schemer = new Schemer({ raw: Deno.readFileSync(schemaFile) });
                if (schema && schema !== schemer.said) throw new ValidationError("Schema file differs from --schema.");
                hby.db.schema.pin(schemer.said, schemer);
                schema = schemer.said;
              }
              const bodyOptions = {
                schema,
                issuee: parseStringOption(args.recipient, "recipient"),
                attribute: section(args.data, "data"),
                edge: section(args.edges, "edges"),
                rule: section(args.rules, "rules"),
              };
              if (prepare) {
                const body = yield* prepareAcdcV2Credential(author, reg, bodyOptions, output!);
                return { credential: body.said, registry: body.regid, prepared: true, issued: false, output };
              }
              const acdc = author.create(reg, bodyOptions);
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
    (function*() {
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
