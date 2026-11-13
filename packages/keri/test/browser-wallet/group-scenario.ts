/**
 * Lane 15c, "group wallet": a 2-of-3 group whose members are the browser wallet and two Tufa CLI members on one
 * keri-ts mailbox host and one witness. The group issues a v2 DH credential to a single-signature Tufa holder with a
 * Tufa member as custodian; the browser consents through `proposals`, and the tab is reloaded between its consent and
 * the issuance's completion. Written, not yet run: its first run is the qualification phase.
 *
 * Steps are named in the style of `scenario.ts`; the page side is `group-steps.ts`. The group's signing order is
 * [Tufa A, browser, Tufa B], so Tufa A holds signing index 0 and is the elected DH custodian.
 */

import {
  capture,
  finish,
  joinGroup,
  jsonLines,
  keyStateOf,
  lastJson,
  mailboxOobi,
  provisionTufa,
  resolveAll,
  start,
  type TufaParty,
  witnessOobi,
} from "./group-flows.ts";
import { type Context, setupWhenGranted, type Step } from "./scenario.ts";

/** Fail the step unless `condition` holds. */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The Tufa parties and group identity earlier steps recorded. */
export interface GroupFacts {
  member: string;
  a: TufaParty;
  b: TufaParty;
  holder: TufaParty;
  group: { pre: string; inception: string };
  grant: string;
  registry: string;
  [key: string]: unknown;
}

/** The facts as the lane's steps read them. */
function facts(ctx: Context): GroupFacts {
  return ctx.facts as GroupFacts;
}

/** Page arguments naming the browser member and the group. */
function who(ctx: Context): Record<string, unknown> {
  const { member, group } = facts(ctx);
  return { member, group: group?.pre };
}

const OPENED = "1 open wallet, incept the browser member with the witness";
const PROVISIONED = "2a Tufa members and holder provisioned on the shared mailbox";
export const OOBIS = "2b OOBIs resolved and mailboxes added all round";
export const INCEPTION =
  "3 group inception proposed by Tufa, approved from proposals.list, Counselor completes on all three";
const MAILBOX = "4 group mailbox role: propose, approve, complete";
const REGISTRY = "5 group registry proposed by Tufa, approved by the browser";
const CONSENT = "6a group issuance: Tufa custodian begins, browser consents";
const RELOAD = "6b reload the tab, reopen the wallet on the same store";
const COMPLETE = "6c after the reload: registry update approved, issuance completes";
export const RECORDED = "6d holder admits; the browser holds the registry root and the inventory records it";
const MEMBERS = "7 members rotate and learn each other";
const ROTATION = "8 group rotation proposed by the browser, approved by the Tufa members";
const MAIL = "9 after the rotation the browser still receives group mail";
const CLOSE = "10 close, store lock released";

/** Step 1 to 2b: the shared setup the KERIpy-member lane reuses with a smaller group. */
export const setupSteps: Step[] = [
  {
    name: OPENED,
    run: async ({ page, facts }) => {
      const opened = await page("openWallet");
      const member = await page("inceptMember");
      facts.member = member.member;
      return { opened, member };
    },
  },
  {
    name: PROVISIONED,
    run: async (ctx) => {
      const id = crypto.randomUUID().slice(0, 8);
      const [a, b, holder] = await Promise.all([
        provisionTufa(ctx, `member-a-${id}`, "member-a"),
        provisionTufa(ctx, `member-b-${id}`, "member-b"),
        provisionTufa(ctx, `holder-${id}`, "holder"),
      ]);
      Object.assign(ctx.facts, { a, b, holder });
      return { a: a.pre, b: b.pre, holder: holder.pre };
    },
  },
  {
    name: OOBIS,
    needs: [OPENED, PROVISIONED],
    run: async (ctx) => {
      const { a, b, holder, member } = facts(ctx);
      const mailbox = await ctx.page("addMailboxHost", { member });
      const resolved = await ctx.page("resolveOobis", {
        oobis: [a, b, holder].map((party) => ({ url: mailboxOobi(ctx, party.pre), alias: party.alias })),
      });
      const browser = mailboxOobi(ctx, member);
      const parties = [a, b, holder];
      for (const party of parties) {
        await resolveAll(ctx, party, [
          browser,
          ...parties.filter((other) => other !== party).map((other) => mailboxOobi(ctx, other.pre)),
        ]);
      }
      return { mailbox, resolved };
    },
  },
];

/** Group inception with the browser as the middle member of [A, browser, B]; A proposes and B joins. */
export function inceptionStep(needs: string[], members: (f: GroupFacts) => string[], threshold: string): Step {
  return {
    name: INCEPTION,
    needs,
    run: async (ctx) => {
      const { a, b } = facts(ctx);
      const aids = members(facts(ctx));
      const file = await ctx.peerFile(
        `group-${crypto.randomUUID()}.json`,
        JSON.stringify({
          aids,
          rmids: aids,
          isith: threshold,
          nsith: threshold,
          toad: 1,
          wits: [ctx.servers.witness.pre],
        }),
      );
      const proposing = start(
        "tufa multisig incept (A)",
        ctx.peer([
          ...["multisig", "incept", ...a.store, "--version", "2.0", "--alias", a.alias, "--group", "group"],
          ...["--file", file, "--approval-timeout", "90", "--receipt-endpoint"],
        ], 150_000),
      );
      const joining = aids.includes(b.pre) ? start("tufa multisig join (B)", joinGroup(ctx, b, 90)) : undefined;
      const browsing = start(
        "browser approves the inception",
        (async () => {
          const proposal = await ctx.page("awaitProposal", { family: "event", type: "icp", proposer: a.pre });
          assert(proposal.proposer === a.pre, `proposal from ${proposal.proposer}, expected Tufa A ${a.pre}`);
          return await ctx.page("approveGroupInception", { id: proposal.id });
        })(),
      );
      const [proposed, browser, joined] = await finish<any>(proposing, browsing, ...(joining ? [joining] : []));
      const accepted = lastJson("A multisig incept", proposed);
      assert(accepted.accepted === true, `A did not report the group accepted: ${proposed.stdout}`);
      if (joined) assert(lastJson("B multisig join", joined).accepted === true, `B: ${joined.stdout}`);
      const pre = String(accepted.group);
      assert(browser.group === pre, `the browser's group ${browser.group} differs from A's ${pre}`);
      const seen = await keyStateOf(ctx, a, pre);
      assert(
        seen.sn === browser.sn && seen.said === browser.said,
        `group key state differs: Tufa ${JSON.stringify(seen)}, browser ${JSON.stringify(browser)}`,
      );
      ctx.facts.group = { pre, inception: browser.said };
      return { group: pre, said: browser.said, browser: browser.status };
    },
  };
}

/** Which of the shared group steps a lane runs. */
export interface IssuanceLane {
  /** The group has the second Tufa member B, who joins the mailbox proposal. */
  withB: boolean;
  /** The tab is reloaded between the browser's consent and the issuance's completion. */
  reload: boolean;
}

/** Group mailbox role, group registry, and one DH issuance to the holder, with the browser consenting. */
export function issuanceSteps(lane: IssuanceLane): Step[] {
  return [
    {
      name: MAILBOX,
      needs: [INCEPTION],
      run: async (ctx) => {
        const { a, b, group } = facts(ctx);
        const mailbox = ctx.servers.mailbox.pre;
        const proposed = await ctx.peer([
          "mailbox",
          "add",
          ...a.store,
          "-a",
          "group",
          "-w",
          mailbox,
          "--multisig-mode",
          "propose",
        ]);
        const approving = start(
          "browser approves the mailbox role",
          (async () => {
            const proposal = await ctx.page("awaitProposal", { family: "event", type: "rpy", proposer: a.pre });
            return await ctx.page("approveProposal", { id: proposal.id, expect: ["approved", "complete"] });
          })(),
        );
        const joining = lane.withB ? [start("tufa multisig join (B)", joinGroup(ctx, b, 60))] : [];
        const [approved] = await finish<any>(approving, ...joining);
        // A reads the approvals from its mailbox before it posts the accepted reply to the provider.
        let completed;
        for (let attempt = 1;; attempt++) {
          await ctx.peer(["ipex", "poll", ...a.store, "-a", a.alias, "--timeout", "3"]);
          try {
            completed = await ctx.peer([
              "mailbox",
              "add",
              ...a.store,
              "-a",
              "group",
              "-w",
              mailbox,
              "--multisig-mode",
              "complete",
            ]);
            break;
          } catch (error) {
            if (attempt >= 20 || !String(error instanceof Error ? error.message : error).includes("not yet approved")) {
              throw error;
            }
          }
        }
        const browser = await ctx.page("completeGroupMailbox", { group: group.pre });
        return {
          proposed: proposed.stdout.trim().split("\n").at(-1),
          approved,
          tufa: completed.stdout.trim(),
          browser,
        };
      },
    },
    {
      name: REGISTRY,
      needs: [MAILBOX],
      run: async (ctx) => {
        const { a } = facts(ctx);
        const incepting = start(
          "tufa vc registry incept (A)",
          ctx.peer([
            ...["vc", "registry", "incept", "--acdc-v2", ...a.store, "--alias", "group"],
            ...["--registry-name", "issuer-fresh", "--usage", "group reader", "--timeout", "90"],
          ], 120_000),
        );
        const approving = start(
          "browser approves the registry inception",
          (async () => {
            const proposal = await ctx.page("awaitProposal", { family: "registry", type: "rip" });
            return await ctx.page("approveProposal", {
              id: proposal.id,
              registryName: "group-registry",
              expect: ["complete"],
            });
          })(),
        );
        const [, approved] = await finish<any>(incepting, approving);
        return { approved };
      },
    },
    {
      name: CONSENT,
      needs: [REGISTRY],
      run: async (ctx) => {
        const { a, holder, group } = facts(ctx);
        // The holder knows the group by the mailbox the group authorized.
        await resolveAll(ctx, holder, [mailboxOobi(ctx, group.pre), witnessOobi(ctx, group.pre)]);
        const body = `/work/peer/body-${crypto.randomUUID()}.cesr`;
        await ctx.peer([
          ...["vc", "create", "--acdc-v2", "--prepare", ...a.store, "--alias", "group"],
          ...["--registry-name", "issuer-fresh", "--recipient", holder.pre, "--data", "{\"role\":\"group reader\"}"],
          ...["--out", body],
        ]);
        const custodian = start(
          "tufa ipex grant --issue (A, custodian)",
          ctx.peer([
            ...["ipex", "grant", "--issue", ...a.store, "--alias", "group", "--credential", body],
            ...["--recipient", holder.pre, "--coordinator", group.inception, "--custodian", a.pre],
            ...["--proposal-output", `/work/peer/proposal-${crypto.randomUUID()}.cesr`, "--timeout", "240"],
          ], 260_000),
        );
        ctx.facts.custodian = custodian;
        const proposal = await ctx.page("awaitProposal", { family: "issuance", type: "grant" });
        assert(proposal.group === group.pre, `Grant proposal is for ${proposal.group}, not the group ${group.pre}`);
        const consent = await ctx.page("consentIssuance", { grant: proposal.id, timeoutMs: 8_000 });
        ctx.facts.grant = proposal.id;
        ctx.facts.holding = start(
          "tufa ipex setup (holder)",
          setupWhenGranted(ctx.peer, holder.store, proposal.id, 20, holder.alias, 200),
        );
        return { grant: proposal.id, consent };
      },
    },
    ...(lane.reload
      ? [{
        name: RELOAD,
        needs: [CONSENT],
        run: async (ctx: Context) => {
          await ctx.reload();
          const reopened = await ctx.page("reopenWallet", who(ctx));
          return { reopened };
        },
      }]
      : []),
    {
      name: COMPLETE,
      needs: [lane.reload ? RELOAD : CONSENT],
      run: async (ctx) => {
        const { grant } = facts(ctx);
        // An issuance is live in memory only: after a reload the member consents again with the same call.
        const again = await ctx.page("consentIssuance", { grant, timeoutMs: 8_000 });
        const proposal = await ctx.page("awaitProposal", { family: "registry", type: "bup" });
        const update = await ctx.page("approveProposal", { id: proposal.id, expect: ["complete"] });
        const [issued] = await finish<any>(ctx.facts.custodian as never, ctx.facts.holding as never);
        const lines = jsonLines(issued.stdout);
        const outcome = lines.find((line) => line.registryIssued === true);
        assert(outcome, `the custodian did not report the registry update issued:\n${issued.stdout}`);
        assert(outcome.grant === grant, `custodian issued ${outcome.grant}, browser consented to ${grant}`);
        ctx.facts.registry = String(outcome.registry);
        const copies = lines.filter((line) => line.phase === "root_copy");
        assert(
          copies.some((copy) => copy.recipient === facts(ctx).member && copy.transmitted === true),
          `no root copy was sent to the browser member: ${JSON.stringify(copies)}`,
        );
        return { again, update, registry: outcome.registry, rootCopies: copies.length };
      },
    },
    {
      name: RECORDED,
      needs: [COMPLETE],
      run: async (ctx) => {
        const { holder, grant, registry, group } = facts(ctx);
        const admitted = lastJson(
          "holder ipex admit",
          await ctx.peer([
            "ipex",
            "admit",
            "--acdc-v2",
            "--consent",
            ...holder.store,
            "--alias",
            holder.alias,
            "--said",
            grant,
          ], 90_000),
        );
        const recorded = await ctx.page("awaitIssued", { grant, group: group.pre, registry });
        return { admit: admitted, recorded };
      },
    },
  ];
}

export const steps: Step[] = [
  ...setupSteps,
  inceptionStep([OOBIS], (f) => [f.a.pre, f.member, f.b.pre], "2"),
  ...issuanceSteps({ withB: true, reload: true }),
  {
    name: MEMBERS,
    needs: [RECORDED],
    run: async (ctx) => {
      const { a, b, member } = facts(ctx);
      const browserRotation = await ctx.page("rotateMember", { member });
      for (const party of [a, b]) {
        await ctx.peer(["rotate", ...party.store, "--alias", party.alias, "--receipt-endpoint", "--toad", "1"]);
      }
      for (const [party, others] of [[a, [b.pre, member]], [b, [a.pre, member]]] as [TufaParty, string[]][]) {
        for (const pre of others) await ctx.peer(["query", ...party.store, "--alias", party.alias, "--prefix", pre]);
      }
      // A different OOBI than the first: the witness serves each member's rotated KEL.
      const learned = await ctx.page("resolveOobis", {
        oobis: [a, b].map((party) => ({ url: witnessOobi(ctx, party.pre) })),
      });
      return { browserRotation, learned };
    },
  },
  {
    name: ROTATION,
    needs: [MEMBERS],
    run: async (ctx) => {
      const { a, b, group } = facts(ctx);
      const joining = [a, b].map((party) => start(`tufa multisig join (${party.alias})`, joinGroup(ctx, party, 150)));
      const rotating = start("browser proposes the group rotation", ctx.page("rotateGroup", who(ctx)));
      const [rotated, ...joined] = await finish<any>(rotating, ...joining);
      for (const result of joined) {
        assert(lastJson("multisig join", result).accepted === true, `join: ${result.stdout}`);
      }
      const seen = await keyStateOf(ctx, a, group.pre);
      assert(
        seen.sn === rotated.sn && seen.said === rotated.said,
        `group key state after rotation: Tufa ${JSON.stringify(seen)}, browser ${JSON.stringify(rotated)}`,
      );
      const published = await ctx.page("awaitPublication", who(ctx));
      return { rotated, published };
    },
  },
  {
    name: MAIL,
    needs: [ROTATION],
    run: async (ctx) => {
      const { holder, group } = facts(ctx);
      // The holder learns the rotated group, then sends it a Grant; the Grant reaches the browser through the group's mailbox.
      await ctx.peer(["oobi", "resolve", ...holder.store, "-u", witnessOobi(ctx, group.pre)]);
      await ctx.peer([
        "vc",
        "registry",
        "incept",
        ...holder.store,
        "-a",
        holder.alias,
        "--acdc-v2",
        "--registry-name",
        "holder-reg",
      ]);
      const body = `/work/peer/body-${crypto.randomUUID()}.cesr`;
      await ctx.peer([
        ...[
          "vc",
          "create",
          ...holder.store,
          "-a",
          holder.alias,
          "--acdc-v2",
          "--prepare",
          "--registry-name",
          "holder-reg",
        ],
        ...["-r", group.pre, "--data", "{\"role\":\"holder issued reader\"}", "--out", body],
      ]);
      const prepared = await ctx.peer([
        ...["ipex", "grant", "--issue", ...holder.store, "-a", holder.alias, "-r", group.pre, "--credential", body],
        ...["--out", `/work/peer/grant-${crypto.randomUUID()}.cesr`],
      ]);
      const grant = capture(prepared.stdout, /"grant":"([^"]+)"/);
      // The sender waits for a key exchange nobody here answers; it only has to deliver the Grant.
      const sending = start(
        "tufa ipex grant --issue --resume (holder)",
        ctx.peer([...["ipex", "grant", "--issue", ...holder.store, "-a", holder.alias, "-r", group.pre], ...[
          "--resume",
          grant,
          "--timeout",
          "30",
        ]], 60_000)
          .catch(() => undefined),
      );
      const received = await ctx.page("awaitGroupGrant", { ...who(ctx), grant });
      await finish(sending);
      return received;
    },
  },
  {
    name: CLOSE,
    needs: [RELOAD],
    run: async ({ page }) => await page("closeAndCheckLock"),
  },
];
