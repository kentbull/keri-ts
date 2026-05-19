import { Ilks } from "cesr-ts";
import {
  type AgentRuntime,
  type CesrStreamInspection,
  type Hab,
  readMailboxAdminRequest,
  Roles,
  settleRuntimeIngress,
  ValidationError,
} from "keri-ts/runtime";
import { textResponse } from "../responses.ts";
import type { ProtocolRequestContext, ProtocolRoute } from "../types.ts";

/** Classify mailbox-admin requests before witness or generic ingress routing. */
export function classifyMailboxAdminRoute(
  context: ProtocolRequestContext,
): ProtocolRoute | null {
  if (!context.runtime || context.method !== "POST") {
    return null;
  }
  if (context.mailboxAdmin?.kind === "ambiguous") {
    return {
      kind: "ambiguousHostedPath",
      message: "Ambiguous mailbox endpoint path",
    };
  }
  if (context.mailboxAdmin?.kind === "one") {
    return {
      kind: "mailboxAdmin",
      mailboxAid: context.mailboxAdmin.endpoint!.eid,
    };
  }
  return null;
}

/**
 * Handle mailbox add/remove authorization requests for one hosted mailbox AID.
 *
 * Contract:
 * - request body is either one `application/cesr` stream or one
 *   `multipart/form-data` request carrying `kel`, optional `delkel`, and `rpy`
 * - both request shapes normalize to one mailbox authorization CESR stream
 * - that stream ends in the mailbox authorization `rpy`
 */
export async function handleMailboxAdmin(
  runtime: AgentRuntime,
  req: Request,
  mailboxAid: string,
  serviceHab?: Hab,
): Promise<Response> {
  let mailboxRequest;
  try {
    mailboxRequest = await readMailboxAdminRequest(req);
  } catch (error) {
    if (error instanceof ValidationError) {
      return textResponse(error.message, 400);
    }
    return textResponse(String(error), 400);
  }
  if (!mailboxRequest) {
    return textResponse("Unacceptable content type.", 406);
  }

  const { bytes, inspection } = mailboxRequest;
  const validation = validateMailboxAuthorizationReply(inspection, mailboxAid);
  if (validation instanceof Response) {
    return validation;
  }

  const { cid, role, expected } = validation;
  settleMailboxAdminIngress(runtime, bytes, mailboxAid);

  const acceptance = confirmMailboxAuthorization(
    runtime,
    cid,
    mailboxAid,
    expected,
  );
  if (acceptance instanceof Response) {
    return acceptance;
  }

  return new Response(
    JSON.stringify({
      cid,
      role,
      eid: mailboxAid,
      allowed: expected,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/** Validate the terminal mailbox authorization reply before local acceptance checks. */
export function validateMailboxAuthorizationReply(
  inspection: CesrStreamInspection,
  mailboxAid: string,
): Response | { cid: string; role: string; expected: boolean } {
  const serder = inspection.terminal;
  if (!serder) {
    return textResponse("Mailbox authorization stream is required", 400);
  }
  if (serder.ilk !== Ilks.rpy) {
    return textResponse("Mailbox authorization stream must end in rpy", 400);
  }

  const route = serder.route ?? "";
  if (route !== "/end/role/add" && route !== "/end/role/cut") {
    return textResponse("Unsupported mailbox authorization route", 400);
  }

  const data = serder.ked?.a as Record<string, unknown> | undefined;
  const cid = typeof data?.cid === "string" ? data.cid : null;
  const role = typeof data?.role === "string" ? data.role : null;
  const eid = typeof data?.eid === "string" ? data.eid : null;
  if (!cid || !role || !eid) {
    return textResponse(
      "Mailbox authorization reply is missing cid/role/eid",
      400,
    );
  }
  if (role !== Roles.mailbox) {
    return textResponse(
      "Mailbox authorization reply must use role=mailbox",
      400,
    );
  }
  if (eid !== mailboxAid) {
    return textResponse(
      "Mailbox authorization target does not match hosted mailbox",
      403,
    );
  }
  return { cid, role, expected: route === "/end/role/add" };
}

/** Confirm that mailbox authorization state was accepted locally. */
export function confirmMailboxAuthorization(
  runtime: AgentRuntime,
  cid: string,
  mailboxAid: string,
  expected: boolean,
): Response | null {
  const end = runtime.hby.db.ends.get([cid, Roles.mailbox, mailboxAid]);
  const accepted = expected ? !!end?.allowed : !!end && !end.allowed;
  if (!accepted) {
    return textResponse("Mailbox authorization reply was not accepted", 403);
  }
  return null;
}

/** Settle mailbox-admin CESR ingress without responder-side cue forwarding. */
export function settleMailboxAdminIngress(
  runtime: AgentRuntime,
  bytes: Uint8Array,
  mailboxAid: string,
): void {
  runtime.mailboxDirector.withActiveMailboxAid(mailboxAid, () => {
    settleRuntimeIngress(runtime, [bytes]);
  });
}
