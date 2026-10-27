/** Tufa parses/configures ACDC v2 authoring; wallet owns state transitions and acceptance. */
import { RegistryCustody, WalletAuthor } from "@keri-ts/wallet";
import { type MapperMap } from "cesr-ts";
import { call, type Operation, race, scoped, sleep } from "effection";
import { parseBooleanOption, parseGvrsn, parseNumberOption, parseStringOption } from "keri-ts/cli";
import { Receiptor, Schemer, ValidationError } from "keri-ts/runtime";
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
    (function*() {
      return yield* withHabAndAgentRuntime(
        walletStoreArgs(args),
        alias,
        { skipConfig: true },
        function*({ hby, runtime, hab }) {
          return yield* scoped(function*() {
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
            if (operation === "incept") {
              if (args.discloser && !withCustody) throw new ValidationError("--discloser requires --with-custody.");
              if (custody && (!hby.mgr.aeid || !hby.mgr.seed)) {
                throw new ValidationError("Private custody requires an authenticated encrypted Keeper.");
              }
              const event = yield* author.incept(name, hab.pre);
              const info = custody?.createCustody(
                event.said!,
                parseStringOption(args.discloser, "discloser") ?? hab.pre,
              );
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
              const record = yield* author.issue(reg, acdc, options);
              return {
                credential: record.credential,
                registry: record.registry,
                update: record.update,
                accepted: true,
              };
            }
            const said = required(args.said, "said");
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

/** Operator-selected protected artifact I/O; no automatic salt distribution. */
function* handoff(args: Record<string, unknown>, importing: boolean): Operation<void> {
  const name = parseStringOption(args.registryName, "registry-name"),
    registry = parseStringOption(args.registry, "registry"),
    file = required(args.file, "file");
  if (!registry && !name) throw new ValidationError("--registry or --registry-name is required.");
  const result = yield* withHabAndAgentRuntime(walletStoreArgs(args), required(args.alias, "alias"), {
    skipConfig: true,
  }, function*({ hby, runtime, hab }) {
    return yield* scoped(function*() {
      if (!runtime.acdc) throw new ValidationError("ACDC v2 registry evidence is unavailable.");
      const regid = registry ?? runtime.acdc.registryByName(name!)?.regk;
      if (!regid) throw new ValidationError("Unknown ACDC v2 registry alias.");
      const wallet = yield* openWallet(hby, runtime.acdc.store, runtime.exc);
      const custody = new RegistryCustody({ hby, registry: wallet.registry, db: wallet.db });
      if (importing) {
        return yield* call(() =>
          custody.importCustody(file, {
            registry: regid,
            controller: required(args.controller, "controller"),
            discloser: required(args.discloser, "discloser"),
            rewrap: parseBooleanOption(args.rewrap, "rewrap") ?? false,
          })
        );
      }
      if (wallet.registry.seqEvent(regid, 0)?.issuer !== hab.pre) {
        throw new ValidationError("Registry is controlled by another identifier.");
      }
      yield* call(() => custody.exportCustody(regid, file));
      return { registry: regid, file };
    });
  });
  writeJsonLine(result);
}
/** Import authentic protected custody under explicit participant bindings. */
export function* custodyImportCommand(args: Record<string, unknown>): Operation<void> {
  yield* handoff(args, true);
}
/** Export one exclusive protected plaintext artifact after explicit operator selection. */
export function* custodyExportCommand(args: Record<string, unknown>): Operation<void> {
  yield* handoff(args, false);
}
