"""Opt-in witness fixture commands; protocol intake remains HttpEnd/Directant."""
import base64
import time
import traceback

from hio.base import doing
from keri import kering
from keri.app import agenting
from keri.db import dbing


class MessengerProbe:
    """Inspect accepted state and drive real Python factories, without seeding rows."""
    def __init__(self, hby, legacy, mbx):
        self.hby, self.legacy = hby, legacy
        self.mbx = mbx
        self.traffic = []
        self.serial = 0

    def process_request(self, req, rep):
        """Observe headers without reading or replacing the protocol request body."""
        if req.path == "/":
            entry = dict(method=req.method, type=req.content_type, length=req.content_length,
                         destination=req.get_header("CESR-DESTINATION"),
                         attachment=req.get_header("CESR-ATTACHMENT"),
                         authorization=req.get_header("Authorization"))
            self.traffic.append(entry)
            req.context.messenger_traffic = entry

    def process_response(self, req, rep, resource, req_succeeded):
        """Observe final HTTP status without changing response data or protocol processing."""
        entry = getattr(req.context, "messenger_traffic", None)
        if entry is not None:
            entry["status"] = rep.status_code

    def on_post(self, req, rep):
        """Surface fixture failures to the parent instead of Falcon's generic 500."""
        try:
            self.command(req, rep)
        except Exception:
            rep.status = "500 Internal Server Error"
            rep.text = traceback.format_exc()

    def command(self, req, rep):
        """Commands inspect state or send over the network; never accept protocol input."""
        command = req.media
        if command["action"] == "snapshot":
            states = {}
            for pre in command["prefixes"]:
                kever = self.hby.kevers.get(pre)
                if kever is not None:
                    states[pre] = self.accepted_kel(pre, kever.sn)
            said = command.get("exn")
            rep.media = dict(states=states, traffic=self.traffic,
                             exn=said if said and self.hby.db.exns.get(keys=(said,)) else None,
                             payload=[base64.b64encode(part.raw).decode()
                                      for part in self.hby.db.essrs.get(keys=(said,))] if said else [])
        elif command["action"] == "publish":
            rep.media = self.publish(command["alias"], command["recipient"])
        elif command["action"] == "send":
            rep.media = self.send(command["url"], command["destination"], command["stream"])
        else:
            raise ValueError("Unknown messenger fixture command")

    def publish(self, alias, recipient):
        """Publish an actual signed reply through the witness's ordinary mailbox owner."""
        if recipient not in self.hby.kevers:
            raise ValueError("Recipient must first reach accepted state through protocol intake")
        hab = self.hby.habByName(alias)
        version = {} if self.legacy else dict(version=kering.Vrsn_1_0, gvrsn=kering.Vrsn_1_0)
        message = hab.makeEndRole(eid=hab.pre, role=kering.Roles.agent, **version)
        self.mbx.storeMsg(topic=f"{recipient}/reply", msg=message)
        return dict(sender=hab.pre, message=base64.b64encode(message).decode())

    def send(self, url, destination, stream):
        """Send a fresh signed two-event KEL using the actual ordinary/stream factory."""
        self.serial += 1
        version = {} if self.legacy else {"version": kering.Vrsn_1_0}
        hab = self.hby.makeHab(name=f"messenger-{self.serial}", **version)
        hab.interact(**({} if self.legacy else dict(version=kering.Vrsn_1_0, gvrsn=kering.Vrsn_1_0)))
        if self.legacy:
            parts = [hab.makeOwnEvent(sn=sn) for sn in range(2)]
        else:
            parts = [hab.msgOwnEvent(sn=sn, framed=True, gvrsn=kering.Vrsn_1_0) for sn in range(2)]
        wire = bytearray().join(parts)
        if stream:
            messenger = agenting.streamMessengerFrom(hab, destination, {"http": url}, wire,
                                                     headers={"Authorization": "messenger-probe"})
        else:
            messenger = agenting.messengerFrom(hab, destination, {"http": url}, auth="messenger-probe")
            messenger.msgs.append(bytearray(wire))
        driver = doing.Doist(tock=.005, real=True, doers=[messenger])
        try:
            driver.enter()
            deadline = time.monotonic() + 10
            while (messenger.rep is None if stream else not messenger.idle):
                if time.monotonic() >= deadline:
                    raise TimeoutError("Python messenger did not complete")
                driver.recur()
                time.sleep(.005)
            responses = [messenger.rep] if stream else list(messenger.sent)
            assert all(response.status == 204 for response in responses), responses
        finally:
            driver.exit()
        return dict(pre=hab.pre,
                    saids=self.accepted_kel(hab.pre, 1),
                    wire=base64.b64encode(wire).decode(), responses=len(responses))

    def accepted_kel(self, pre, sn):
        """Read each reference's actual accepted KEL owner, not pending/raw seeded rows."""
        if self.legacy:
            return [bytes(self.hby.db.getKeLast(dbing.snKey(pre, on))).decode() for on in range(sn + 1)]
        return [self.hby.db.kels.getLast(keys=pre, on=on) for on in range(sn + 1)]
