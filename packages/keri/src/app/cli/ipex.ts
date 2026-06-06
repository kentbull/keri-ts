import { type Operation } from "npm:effection@^3.6.0";
import { concatBytes, parseSerder, SerderKERI, smell } from "../../../../cesr/mod.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox-topics.ts";
import { ValidationError } from "../../core/errors.ts";
import { type AgentRuntime, createAgentRuntime } from "../agent-runtime.ts";
import { splitCesrStream } from "../cesr-http.ts";
import type { Hab, Habery } from "../habbing.ts";
import {
  IPEX_AGREE_ROUTE,
  IPEX_APPLY_ROUTE,
  IPEX_GRANT_ROUTE,
  IPEX_OFFER_ROUTE,
  IPEX_SPURN_ROUTE,
} from "../ipexing.ts";
import { ipexCredentialAdmit, ipexCredentialGrant } from "../ipex-credentialing.ts";
import { Reger } from "../../db/reger.ts";
import { setupHby } from "./common/existing.ts";

interface IpexBaseArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  compat?: boolean;
  alias?: string;
  recipient?: string;
  message?: string;
  out?: string;
  delivery?: "auto" | "direct" | "indirect";
}

interface IpexGrantArgs extends IpexBaseArgs {
  said?: string;
  agree?: string;
}

interface IpexAdmitArgs extends IpexBaseArgs {
  said?: string;
  grantFile?: string;
  noWait?: boolean;
}

export function* ipexApplyCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  const schema = args.schema as string | undefined;
  requireNonEmpty(schema, "Schema");
  const { hby, runtime } = yield* openRuntime(ipexArgs);
  try {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = runtime.poster.resolveRecipient(requireString(ipexArgs.recipient, "Recipient"));
    const result = yield* runtime.poster.sendExchange(hab, {
      recipient,
      route: IPEX_APPLY_ROUTE,
      payload: {
        m: ipexArgs.message ?? "",
        s: schema,
        a: parseJsonArg(args.attrs as string | undefined) ?? {},
        i: recipient,
      },
      topic: CREDENTIAL_MAILBOX_TOPIC,
      delivery: ipexArgs.delivery,
    });
    console.log(JSON.stringify({ said: result.serder.said, deliveries: result.deliveries, queued: result.queued }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* ipexOfferCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  const acdcFile = args.acdc as string | undefined;
  requireNonEmpty(acdcFile, "ACDC file");
  const { hby, runtime } = yield* openRuntime(ipexArgs);
  try {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = runtime.poster.resolveRecipient(requireString(ipexArgs.recipient, "Recipient"));
    const result = yield* runtime.poster.sendExchange(hab, {
      recipient,
      route: IPEX_OFFER_ROUTE,
      payload: { m: ipexArgs.message ?? "" },
      dig: args.apply as string | undefined,
      embeds: { acdc: Deno.readFileSync(acdcFile!) },
      topic: CREDENTIAL_MAILBOX_TOPIC,
      delivery: ipexArgs.delivery,
    });
    console.log(JSON.stringify({ said: result.serder.said, deliveries: result.deliveries, queued: result.queued }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* ipexAgreeCommand(args: Record<string, unknown>): Operation<void> {
  yield* sendPriorResponse(args, IPEX_AGREE_ROUTE, "offer");
}

export function* ipexSpurnCommand(args: Record<string, unknown>): Operation<void> {
  yield* sendPriorResponse(args, IPEX_SPURN_ROUTE, "prior");
}

export function* ipexGrantCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs: IpexGrantArgs = {
    ...ipexBaseArgs(args),
    said: args.said as string | undefined,
    agree: args.agree as string | undefined,
  };
  requireNonEmpty(ipexArgs.said, "Credential SAID");
  const { hby, runtime, reger } = yield* openRuntime(ipexArgs);
  try {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = ipexArgs.out
      ? resolveAid(hby, requireString(ipexArgs.recipient, "Recipient"))
      : runtime.poster.resolveRecipient(requireString(ipexArgs.recipient, "Recipient"));
    const grant = ipexCredentialGrant({
      hby,
      hab,
      reger,
      recipient,
      credentialSaid: ipexArgs.said!,
      message: ipexArgs.message ?? "",
      options: {
        agree: ipexArgs.agree ? hby.db.exns.get([ipexArgs.agree]) : null,
      },
    });
    const stream = concatBytes(...grant.support, grant.wire);
    if (ipexArgs.out) {
      Deno.writeFileSync(ipexArgs.out, stream);
    } else {
      yield* sendCredentialBytes(runtime, hab, recipient, [...grant.support, grant.wire], ipexArgs.delivery);
    }
    console.log(JSON.stringify({ said: grant.grant.said, credential: ipexArgs.said, support: grant.support.length }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* ipexAdmitCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs: IpexAdmitArgs = {
    ...ipexBaseArgs(args),
    said: args.said as string | undefined,
    grantFile: args.grantFile as string | undefined,
    noWait: args.noWait as boolean | undefined,
  };
  const { hby, runtime, reger } = yield* openRuntime(ipexArgs);
  try {
    const hab = requireHab(hby, ipexArgs.alias);
    const grant = loadGrant(hby, ipexArgs);
    const admit = ipexCredentialAdmit({
      hab,
      reger,
      grant,
      message: ipexArgs.message ?? "",
      options: { requireSaved: !(ipexArgs.noWait ?? false) },
    });
    const recipient = grantSender(grant);
    if (ipexArgs.out) {
      Deno.writeFileSync(ipexArgs.out, admit.wire);
    } else {
      yield* sendCredentialBytes(runtime, hab, recipient, [admit.wire], ipexArgs.delivery);
    }
    console.log(JSON.stringify({ said: admit.admit.said, grant: grant.said }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* ipexListCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  const { hby, runtime } = yield* openRuntime(ipexArgs);
  try {
    for (const [, exn] of hby.db.exns.getTopItemIter()) {
      const route = exn.route ?? "";
      if (!route.startsWith("/ipex/")) {
        continue;
      }
      console.log(JSON.stringify({
        said: exn.said,
        route,
        sender: exn.ked?.i,
        prior: exn.ked?.p,
      }));
    }
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* ipexJoinCommand(args: Record<string, unknown>): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  const said = args.said as string | undefined;
  requireNonEmpty(said, "EXN SAID");
  const { hby, runtime } = yield* openRuntime(ipexArgs);
  try {
    const exn = hby.db.exns.get([said!]);
    if (!exn || !exn.route?.startsWith("/ipex/")) {
      throw new ValidationError(`IPEX message ${said} not found.`);
    }
    console.log(JSON.stringify({ said, route: exn.route, status: "single-sig" }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

function* sendPriorResponse(
  args: Record<string, unknown>,
  route: string,
  priorLabel: string,
): Operation<void> {
  const ipexArgs = ipexBaseArgs(args);
  const prior = args[priorLabel] as string | undefined;
  requireNonEmpty(prior, priorLabel);
  const { hby, runtime } = yield* openRuntime(ipexArgs);
  try {
    const hab = requireHab(hby, ipexArgs.alias);
    const recipient = runtime.poster.resolveRecipient(requireString(ipexArgs.recipient, "Recipient"));
    const result = yield* runtime.poster.sendExchange(hab, {
      recipient,
      route,
      payload: { m: ipexArgs.message ?? "" },
      dig: prior,
      topic: CREDENTIAL_MAILBOX_TOPIC,
      delivery: ipexArgs.delivery,
    });
    console.log(JSON.stringify({ said: result.serder.said, deliveries: result.deliveries, queued: result.queued }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

function ipexBaseArgs(args: Record<string, unknown>): IpexBaseArgs {
  return {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    compat: args.compat as boolean | undefined,
    alias: args.alias as string | undefined,
    recipient: args.recipient as string | undefined,
    message: args.message as string | undefined,
    out: args.out as string | undefined,
    delivery: args.delivery as "auto" | "direct" | "indirect" | undefined,
  };
}

function* openRuntime(args: IpexBaseArgs): Operation<{ hby: Habery; runtime: AgentRuntime; reger: Reger }> {
  requireNonEmpty(args.name, "Name");
  const hby = yield* setupHby(
    args.name!,
    args.base ?? "",
    args.passcode,
    false,
    args.headDirPath,
    {
      compat: args.compat ?? false,
      skipConfig: true,
    },
  );
  const runtime = yield* createAgentRuntime(hby, { mode: "local" });
  const reger = runtime.vdr.reger;
  if (!(reger instanceof Reger)) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  return { hby, runtime, reger };
}

function requireHab(hby: Habery, alias: string | undefined): Hab {
  requireNonEmpty(alias, "Alias");
  const hab = hby.habByName(alias!);
  if (!hab?.pre) {
    throw new ValidationError(`No local AID found for alias ${alias}.`);
  }
  return hab;
}

function resolveAid(hby: Habery, value: string): string {
  return hby.habByName(value)?.pre ?? value;
}

function requireString(value: string | undefined, label: string): string {
  requireNonEmpty(value, label);
  return value!;
}

function requireNonEmpty(value: string | undefined, label: string): void {
  if (!value) {
    throw new ValidationError(`${label} is required and cannot be empty.`);
  }
}

function parseJsonArg(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  const text = value.startsWith("@") ? Deno.readTextFileSync(value.slice(1)) : value;
  return JSON.parse(text) as Record<string, unknown>;
}

function loadGrant(hby: Habery, args: IpexAdmitArgs): SerderKERI {
  if (args.grantFile) {
    const raw = Deno.readFileSync(args.grantFile);
    for (const frame of splitCesrStream(raw)) {
      const { smellage } = smell(frame);
      const serder = parseSerder(frame.slice(0, smellage.size), smellage);
      if (serder instanceof SerderKERI && serder.route === IPEX_GRANT_ROUTE) {
        return serder;
      }
    }
    throw new ValidationError(`Grant file ${args.grantFile} does not contain an IPEX grant.`);
  }
  requireNonEmpty(args.said, "Grant SAID");
  const grant = hby.db.exns.get([args.said!]);
  if (!grant || grant.route !== IPEX_GRANT_ROUTE) {
    throw new ValidationError(`Grant ${args.said} not found.`);
  }
  return grant;
}

function grantSender(grant: SerderKERI): string {
  const sender = grant.ked?.i;
  if (typeof sender !== "string" || sender.length === 0) {
    throw new ValidationError("Grant is missing sender AID.");
  }
  return sender;
}

function* sendCredentialBytes(
  runtime: AgentRuntime,
  hab: Hab,
  recipient: string,
  messages: Uint8Array[],
  delivery: "auto" | "direct" | "indirect" | undefined,
): Operation<void> {
  for (const message of messages) {
    yield* runtime.poster.sendBytes(hab, {
      recipient,
      message,
      topic: CREDENTIAL_MAILBOX_TOPIC,
      delivery,
    });
  }
}
