/** A group's mailbox authorization is proposed to its members and completed only once they approve it. */
import { call, run } from "effection";
import { assertEquals, assertRejects } from "jsr:@std/assert";
import { completeGroupMailbox, mailboxStatus, proposeGroupMailbox } from "../../../../src/app/mailbox/mailbox-admin.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { scenario } from "../multisig/proposal-fixture.ts";

Deno.test("proposeGroupMailbox proposes the role to the other member and completion refuses until it is approved", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const group = s.left.habByName("group")!;
      const mailbox = s.bob.pre;
      const sent = yield* proposeGroupMailbox(s.left, s.runtime.protocol, s.runtime.postman, group, mailbox);
      assertEquals(sent.route, "/multisig/rpy");
      assertEquals(sent.group, s.group);
      assertEquals(sent.messages.length, 1, "the other member is asked");
      assertEquals(sent.accepted, false, "one of two signatures does not authorize the mailbox");
      assertEquals(mailboxStatus(s.left, s.group, mailbox).state, "absent");

      const deps = { hby: s.left, http: {} as never, reactor: s.runtime.reactor, protocol: s.runtime.protocol };
      yield* call(() =>
        assertRejects(
          () => run(() => completeGroupMailbox(deps, group, mailbox)),
          ValidationError,
          `Mailbox role for ${mailbox} is not yet approved for group ${s.group}.`,
        )
      );
    }, "2");
  });
});
