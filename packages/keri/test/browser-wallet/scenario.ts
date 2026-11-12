/**
 * The scenario, as named steps the Deno runner executes in order for each engine. A step calls the
 * page (`ctx.page`) and/or the counterparty (`ctx.peer`, the Tufa CLI in Docker). A step whose
 * `needs` failed is skipped, so one defect does not hide the steps that do not depend on it.
 */

/** Result of one `tufa` command on the counterparty. */
export interface PeerResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** What a step can do. */
export interface Context {
  /** Run one page step and return its JSON result. */
  page(step: string, args?: Record<string, unknown>): Promise<any>;
  /** Run one `tufa` command on the counterparty's store; throws unless it exits 0. */
  peer(args: string[], timeoutMs?: number): Promise<PeerResult>;
  /** Replace the counterparty store's configuration file (used for KRAM). */
  peerConfig(config: unknown): Promise<void>;
  /** `tufa` store options selecting this run's counterparty store. */
  store: string[];
  /** Values earlier steps recorded. */
  facts: Record<string, any>;
  servers: { witness: { origin: string; pre: string }; mailbox: { origin: string; pre: string } };
}

export interface Step {
  name: string;
  /** Step names that must have passed. */
  needs?: string[];
  run(ctx: Context): Promise<unknown>;
}

/** Fail the step unless `condition` holds. */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** First line of the form `<label>  <value>` or the last whitespace-separated token matching `pattern`. */
function find(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  assert(match, `no ${pattern} in output:\n${text}`);
  return match[1] ?? match[0];
}

/** Throw one error naming every side that failed, so a failure on one side does not hide the other. */
function both(...sides: [string, PromiseSettledResult<unknown>][]): void {
  const failures = sides.flatMap(([side, result]) =>
    result.status === "rejected"
      ? [`${side}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
      : []
  );
  if (failures.length) throw new Error(failures.join("\n---\n"));
}

/** `tufa ipex setup` refuses a Grant the counterparty's store does not hold yet. */
const NO_GRANT_YET = "Select the exact unanchored pending issuance Grant";

/**
 * The counterparty comes online and takes the Grant: poll its mailbox until the Grant is stored, then run
 * `ipex setup`. One `ipex poll` is not enough: it ends at the first IPEX message newer than its start, and 4a's
 * Admit, still in the mailbox when 4b begins, ends it before the Grant has arrived. A wallet's own poller runs
 * all the time and has no such gap.
 */
async function setupWhenGranted(
  peer: Context["peer"],
  store: string[],
  grant: string,
  attempts = 20,
): Promise<PeerResult> {
  for (let attempt = 1;; attempt++) {
    await peer(["ipex", "poll", ...store, "-a", "peer", "--timeout", "3"]);
    try {
      return await peer(["ipex", "setup", ...store, "-a", "peer", "--said", grant, "--timeout", "150"], 170_000);
    } catch (error) {
      if (attempt >= attempts || !String(error instanceof Error ? error.message : error).includes(NO_GRANT_YET)) {
        throw error;
      }
    }
  }
}

export const steps: Step[] = [
  {
    name: "1 open wallet, request persistent storage",
    run: async ({ page, facts }) => {
      facts.open = await page("openWallet");
      return facts.open;
    },
  },
  {
    name: "2 incept with witness, collect receipt",
    needs: ["1 open wallet, request persistent storage"],
    run: async ({ page, facts }) => {
      facts.inception = await page("inceptWithWitness");
      return facts.inception;
    },
  },
  {
    name: "3a counterparty provisioned on the shared mailbox",
    run: async ({ peer, peerConfig, facts, servers, store }) => {
      const { mailbox } = servers;
      await peer(["init", ...store]);
      await peerConfig({
        kram: { enabled: true, denials: [], caches: { "~": [1000, 60000, 60000, 300000, 60000, 60000, 300000] } },
      });
      const incepted = await peer([
        "incept",
        ...store,
        "-a",
        "peer",
        "-tf",
        "--icount",
        "1",
        "--isith",
        "1",
        "--ncount",
        "1",
        "--nsith",
        "1",
        "--toad",
        "0",
      ]);
      facts.peerPre = find(incepted.stdout, /Prefix\s+(\S+)/);
      await peer(["oobi", "resolve", ...store, "-u", `${mailbox.origin}/oobi/${mailbox.pre}/controller`]);
      await peer(["mailbox", "add", ...store, "-a", "peer", "-w", mailbox.pre]);
      facts.peerOobi = `${mailbox.origin}/oobi/${facts.peerPre}/mailbox/${mailbox.pre}`;
      return { peer: facts.peerPre, oobi: facts.peerOobi };
    },
  },
  {
    name: "3b mailbox authorized, OOBIs resolved both ways",
    needs: ["2 incept with witness, collect receipt", "3a counterparty provisioned on the shared mailbox"],
    run: async ({ page, peer, facts, servers, store }) => {
      const mailbox = await page("addMailboxHost");
      const resolved = await page("resolvePeer", { peerOobi: facts.peerOobi, peerPre: facts.peerPre });
      const browserOobi = `${servers.mailbox.origin}/oobi/${facts.inception.pre}/mailbox/${servers.mailbox.pre}`;
      await peer(["oobi", "resolve", ...store, "-u", browserOobi]);
      return { mailbox, resolved, browserOobi };
    },
  },
  {
    name: "4a holder: credential from the counterparty, v2 DH issuance",
    needs: ["3b mailbox authorized, OOBIs resolved both ways"],
    run: async ({ page, peer, facts, store }) => {
      await peer(["vc", "registry", "incept", ...store, "-a", "peer", "--acdc-v2", "--registry-name", "peer-reg"]);
      const body = `/work/peer/body-${crypto.randomUUID()}.cesr`;
      await peer([
        "vc",
        "create",
        ...store,
        "-a",
        "peer",
        "--acdc-v2",
        "--prepare",
        "--registry-name",
        "peer-reg",
        "-r",
        facts.inception.pre,
        "--data",
        "{\"role\":\"tufa issued reader\"}",
        "--out",
        body,
      ]);
      const prepared = await peer([
        "ipex",
        "grant",
        "--issue",
        ...store,
        "-a",
        "peer",
        "-r",
        facts.inception.pre,
        "--credential",
        body,
        "--out",
        `/work/peer/grant-${crypto.randomUUID()}.cesr`,
      ]);
      const grant = find(prepared.stdout, /"grant":"([^"]+)"/);
      const sending = peer([
        "ipex",
        "grant",
        "--issue",
        ...store,
        "-a",
        "peer",
        "-r",
        facts.inception.pre,
        "--resume",
        grant,
        "--timeout",
        "150",
      ], 170_000);
      const receiving = page("receiveCredential", { grant });
      const [sent, received] = await Promise.allSettled([sending, receiving]);
      both(["peer", sent], ["browser", received]);
      if (sent.status !== "fulfilled" || received.status !== "fulfilled") throw new Error("unreachable");
      facts.held = received.value;
      return { grant, received: received.value, peer: sent.value.stdout.trim().split("\n").at(-1) };
    },
  },
  {
    name: "4b issuer: credential to the counterparty, v2 DH issuance",
    needs: ["3b mailbox authorized, OOBIs resolved both ways"],
    run: async ({ page, peer, facts, store }) => {
      const begun = await page("issueCredential", { peerPre: facts.peerPre });
      const setup = setupWhenGranted(peer, store, begun.grant);
      const finishing = page("finishIssuance", { grant: begun.grant });
      const [set, finished] = await Promise.allSettled([setup, finishing]);
      both(["peer", set], ["browser", finished]);
      if (set.status !== "fulfilled" || finished.status !== "fulfilled") throw new Error("unreachable");
      const admitted = await peer([
        "ipex",
        "admit",
        ...store,
        "-a",
        "peer",
        "--acdc-v2",
        "--consent",
        "--said",
        begun.grant,
      ], 150_000);
      const admit = await page("awaitAdmit", { grant: begun.grant });
      facts.issuedGrant = begun.grant;
      return { begun, finished: finished.value, peerAdmit: admitted.stdout.trim().split("\n").at(-1), admit };
    },
  },
  {
    name: "5 close, reopen, durable state present, mailbox polling resumes",
    needs: ["3b mailbox authorized, OOBIs resolved both ways"],
    run: async ({ page, peer, facts, store }) => {
      const before = await page("readInventory");
      await page("closeWallet");
      facts.reopen = await page("reopenWallet", {
        expect: {
          pre: facts.inception.pre,
          sn: before.state.sn,
          said: before.state.said,
          issued: before.issued,
          held: before.held,
          cursor: before.cursor,
        },
      });
      // New mail after the reopen: the poller must read it from the stored cursor, past every old index.
      const topic = "/challenge";
      await peer([
        "exn",
        "send",
        "-n",
        store[1],
        "--head-dir",
        store[3],
        "-p",
        store[5],
        "-s",
        "peer",
        "-r",
        facts.inception.pre,
        "-R",
        "/challenge/request",
        "--data",
        "words=one two",
      ]);
      const resumed = await page("awaitMailboxCursor", { topic, above: before.cursor[topic] ?? -1 });
      const lower = Object.entries(before.cursor).filter(([key, index]) =>
        (resumed.cursor[key] ?? -1) < (index as number)
      );
      if (lower.length) {
        throw new Error(`cursor moved backwards: ${JSON.stringify({ before: before.cursor, resumed })}`);
      }
      return { reopened: facts.reopen, resumed };
    },
  },
  {
    name: "6 rotate, collect receipt, counterparty sees new key state",
    needs: ["5 close, reopen, durable state present, mailbox polling resumes"],
    run: async ({ page, peer, facts, store, servers }) => {
      facts.rotation = await page("rotate");
      // The witness holds the receipted rotation; the counterparty learns it from the witness's OOBI.
      const { witness } = servers;
      await peer(["oobi", "resolve", ...store, "-u", `${witness.origin}/oobi/${witness.pre}/controller`]);
      await peer([
        "oobi",
        "resolve",
        ...store,
        "-u",
        `${witness.origin}/oobi/${facts.rotation.pre}/witness/${witness.pre}`,
      ]);
      const dumped = await peer(["db", "dump", "baser.states", ...store.slice(0, 4), "--prefix", facts.rotation.pre]);
      const seen = { sn: find(dumped.stdout, /"s": "(\w+)"/), said: find(dumped.stdout, /"d": "(\S+)"/) };
      assert(
        seen.sn === facts.rotation.sn.toString(16) && seen.said === facts.rotation.said,
        `counterparty key state ${JSON.stringify(seen)} differs from ${facts.rotation.sn}/${facts.rotation.said}`,
      );
      return { rotation: facts.rotation, peerSees: seen };
    },
  },
  {
    name: "7 close, store lock released",
    needs: ["5 close, reopen, durable state present, mailbox polling resumes"],
    run: async ({ page }) => await page("closeAndCheckLock"),
  },
];
