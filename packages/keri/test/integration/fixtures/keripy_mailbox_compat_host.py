#!/usr/bin/env python3
"""Minimal KERIpy-backed mailbox compatibility host for interop tests.

This fixture intentionally stays test-only. It uses real KERIpy Habery,
parser, reply processing, and Mailboxer storage, but layers the missing
`POST /mailboxes` admin route on top of a small stdlib HTTP server so `tufa`
can exercise mailbox add/poll/send flows against a KERIpy-backed host.
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from keri.app.forwarding import ForwardHandler
from keri.app.storing import Mailboxer
from keri.cli.common.existing import setupHby
from keri.core import Kevery, coring, parsing, routing, serdering
from keri.kering import Ilks, Kinds, Roles, Vrsn_1_0
from keri.peer import Exchanger
from hio.help import decking

CESR_ATTACHMENT_HEADER = "CESR-ATTACHMENT"


def mailbox_topic_key(pre: str, topic: str) -> bytes:
    """Return the provider-side mailbox topic bucket key for ``pre/topic``."""
    if topic.startswith("/"):
        return f"{pre}{topic}".encode("utf-8")
    return f"{pre}/{topic}".encode("utf-8")


class AuthorizedForwardHandler(ForwardHandler):
    """Forward handler that enforces current mailbox authorization."""

    def __init__(self, hby, mbx, mailbox_aid):
        super().__init__(hby=hby, mbx=mbx)
        self.mailbox_aid = mailbox_aid

    def handle(self, serder, attachments=None):
        """Store forwarded mailbox traffic only when this mailbox is authorized."""
        modifiers = serder.ked.get("q", {})
        recipient = modifiers["pre"]
        topic = modifiers["topic"]
        end = self.hby.db.ends.get(keys=(recipient, Roles.mailbox, self.mailbox_aid))
        if not end or not (end.allowed or end.enabled):
            return

        embeds = serder.ked["e"]
        payload = bytearray()
        for pather, atc in attachments or []:
            ked = pather.resolve(embeds)
            sadder = coring.Sadder(ked=ked, kind=Kinds.json)
            payload.extend(sadder.raw)
            payload.extend(atc)

        if payload:
            self.mbx.storeMsg(topic=mailbox_topic_key(recipient, topic), msg=payload)


class CompatHost:
    """Small HTTP facade over KERIpy mailbox runtime state."""

    def __init__(
        self,
        name: str,
        alias: str,
        base: str,
        bran: str | None,
        port: int,
        base_path: str = "/",
    ):
        """Create one test-only mailbox host around real KERIpy runtime pieces."""
        self.hby = setupHby(name=name, base=base, bran=bran)
        self.hab = self.hby.habByName(alias)
        if self.hab is None:
            raise ValueError(f"missing local KERIpy alias {alias!r}")

        self.mbx = Mailboxer(name=alias, temp=self.hby.temp)
        cues = decking.Deck()
        self.rvy = routing.Revery(db=self.hby.db, cues=cues)
        self.kvy = Kevery(db=self.hby.db, lax=True, local=False, rvy=self.rvy, cues=cues)
        self.kvy.registerReplyRoutes(router=self.rvy.rtr)
        self.exc = Exchanger(
            hby=self.hby,
            handlers=[AuthorizedForwardHandler(self.hby, self.mbx, self.hab.pre)],
        )
        self.parser = parsing.Parser(
            framed=True,
            kvy=self.kvy,
            exc=self.exc,
            rvy=self.rvy,
            version=Vrsn_1_0,
        )
        self.port = port
        self.base_path = self.normalize_base_path(base_path)

    def close(self):
        """Close the mailbox databaser and KERIpy habery."""
        self.mbx.close(clear=self.mbx.temp)
        self.hby.close(clear=self.hby.temp)

    @staticmethod
    def normalize_base_path(path: str) -> str:
        """Normalize the hosted base path used for mailbox and OOBI routes."""
        path = (path or "/").strip()
        if not path or path == "/":
            return "/"
        if not path.startswith("/"):
            path = "/" + path
        return path.rstrip("/") or "/"

    def relative_path(self, path: str):
        """Return the request path relative to this host's advertised base path."""
        if self.base_path == "/":
            return path
        if path == self.base_path:
            return "/"
        if path.startswith(self.base_path + "/"):
            return path[len(self.base_path):]
        return None

    def oobi_path(self, path: str):
        """Return the OOBI-relative request path when the request targets OOBI."""
        rel = self.relative_path(path)
        if rel is not None:
            return rel
        if path == "/oobi" or path.startswith("/oobi/"):
            return path
        if path.startswith("/.well-known/keri/oobi/"):
            return path
        return None

    def parse_messages(self, raw: bytes):
        """Ingest raw CESR bytes through the real KERIpy parser stack."""
        if raw:
            self.parser.parse(ims=bytearray(raw), local=False)

    def serve_oobi(self, path: str):
        """Serve controller or role OOBI responses for this host."""
        path = self.oobi_path(path)
        if path is None:
            return None
        parts = [part for part in path.split("/") if part]
        aid = role = eid = None

        if len(parts) >= 4 and parts[0] == ".well-known" and parts[1] == "keri" and parts[2] == "oobi":
            aid = parts[3]
            role = Roles.controller
        elif parts and parts[0] == "oobi":
            aid = parts[1] if len(parts) > 1 else None
            role = parts[2] if len(parts) > 2 else None
            eid = parts[3] if len(parts) > 3 else None

        if not aid or not role:
            return None

        msg = self.hab.replyToOobi(aid=aid, role=role, eids=[eid] if eid else None)
        return bytes(msg) if msg else None

    def handle_mailboxes(self, fields: dict[str, bytes]):
        """Handle one mailbox add/remove admin request using KERIpy state."""
        kel = fields.get("kel")
        delkel = fields.get("delkel")
        rpy = fields.get("rpy")
        if not kel or not rpy:
            return 400, b"kel and rpy are required"

        serder = serdering.SerderKERI(raw=bytearray(rpy))
        route = serder.ked.get("r", "")
        data = serder.ked.get("a", {})
        cid = data.get("cid")
        role = data.get("role")
        eid = data.get("eid")
        if route not in ("/end/role/add", "/end/role/cut"):
            return 400, b"unsupported mailbox authorization route"
        if role != Roles.mailbox:
            return 400, b"mailbox authorization reply must use role=mailbox"
        if eid != self.hab.pre:
            return 403, b"mailbox authorization target does not match hosted mailbox"

        self.parse_messages(kel)
        if delkel:
            self.parse_messages(delkel)
        self.parse_messages(rpy)

        end = self.hby.db.ends.get(keys=(cid, Roles.mailbox, self.hab.pre))
        expected = route == "/end/role/add"
        accepted = bool(end and (end.allowed if expected else not end.allowed))
        if not accepted:
            return 403, b"mailbox authorization reply was not accepted"

        body = json.dumps({
            "cid": cid,
            "role": role,
            "eid": self.hab.pre,
            "allowed": expected,
        }).encode("utf-8")
        return 200, body

    def mailbox_sse(self, raw: bytes):
        """Answer one ``mbx`` query with KERIpy-backed mailbox SSE output."""
        serder = serdering.SerderKERI(raw=bytearray(raw))
        query = serder.ked.get("q", {})
        pre = query.get("i") or query.get("pre")
        topics = query.get("topics", {})
        if not isinstance(pre, str) or not isinstance(topics, dict):
            return 400, b"bad mailbox query"

        chunks = [b"retry: 5000\n\n"]
        for topic, start in topics.items():
            if not isinstance(topic, str):
                continue
            try:
                fn = int(start)
            except Exception:
                fn = 0

            for idx, _, msg in self.mbx.cloneTopicIter(mailbox_topic_key(pre, topic), fn):
                chunks.append(f"id: {idx}\nevent: {topic}\nretry: 5000\ndata: ".encode("utf-8"))
                chunks.append(msg)
                chunks.append(b"\n\n")

        return 200, b"".join(chunks)


def parse_form(handler: BaseHTTPRequestHandler) -> dict[str, bytes]:
    """Parse a minimal multipart form body used by mailbox admin requests."""
    content_type = handler.headers.get("Content-Type", "")
    length = int(handler.headers.get("Content-Length", "0") or "0")
    raw = handler.rfile.read(length)

    if "multipart/form-data" not in content_type:
        return {}

    boundary = None
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part.split("=", 1)[1].strip('"')
            break

    if not boundary:
        return {}

    marker = ("--" + boundary).encode("utf-8")
    fields: dict[str, bytes] = {}
    for block in raw.split(marker):
        block = block.strip()
        if not block or block == b"--":
            continue

        header_blob, sep, body = block.partition(b"\r\n\r\n")
        if not sep:
            continue

        headers = header_blob.decode("utf-8", errors="ignore").split("\r\n")
        name = None
        for header in headers:
            lower = header.lower()
            if "content-disposition:" not in lower:
                continue
            for item in header.split(";"):
                item = item.strip()
                if item.startswith("name="):
                    name = item.split("=", 1)[1].strip('"')
                    break

        if not name:
            continue

        fields[name] = body.rstrip(b"\r\n")

    return fields


def read_cesr_request(handler: BaseHTTPRequestHandler) -> bytes:
    """Reconstruct CESR request bytes from body plus optional attachment header."""
    length = int(handler.headers.get("Content-Length", "0") or "0")
    raw = handler.rfile.read(length)
    attachment = handler.headers.get(CESR_ATTACHMENT_HEADER)
    if attachment:
        raw += attachment.encode("utf-8")
    return raw


def make_handler(host: CompatHost):
    """Build the stdlib HTTP handler that exposes mailbox admin and protocol routes."""
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            """Silence stdlib HTTP access logs for cleaner test output."""
            return

        def do_GET(self):
            """Serve health and OOBI requests."""
            parsed = urlparse(self.path)
            if parsed.path == "/health":
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"ok")
                return

            relpath = host.oobi_path(parsed.path)
            if relpath is None:
                self.send_response(404)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"Not Found")
                return

            msg = host.serve_oobi(parsed.path)
            if msg is None:
                self.send_response(404)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"Not Found")
                return

            aid = None
            parts = [part for part in relpath.split("/") if part]
            if len(parts) >= 4 and parts[0] == ".well-known" and parts[1] == "keri" and parts[2] == "oobi":
                aid = parts[3]
            elif len(parts) >= 2 and parts[0] == "oobi":
                aid = parts[1]

            self.send_response(200)
            self.send_header("Content-Type", "application/cesr")
            self.send_header("Oobi-Aid", aid or host.hab.pre)
            self.end_headers()
            self.wfile.write(msg)

        def do_POST(self):
            """Handle mailbox admin, `mbx` query, and generic CESR POST ingress."""
            parsed = urlparse(self.path)
            relpath = host.relative_path(parsed.path)
            if relpath is None:
                self.send_response(404)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"Not Found")
                return

            if relpath == "/mailboxes":
                status, body = host.handle_mailboxes(parse_form(self))
                self.send_response(status)
                self.send_header("Content-Type", "application/json" if status == 200 else "text/plain")
                self.end_headers()
                self.wfile.write(body)
                return

            raw = read_cesr_request(self)
            try:
                serder = serdering.SerderKERI(raw=bytearray(raw))
            except Exception:
                self.send_response(400)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"Invalid CESR request")
                return

            if serder.ked.get("t") == Ilks.qry and serder.ked.get("r") == "mbx":
                status, body = host.mailbox_sse(raw)
                self.send_response(status)
                self.send_header("Content-Type", "text/event-stream" if status == 200 else "text/plain")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(body)
                return

            host.parse_messages(raw)
            self.send_response(204)
            self.end_headers()

        def do_PUT(self):
            """Accept raw CESR PUT ingress for parity with mailbox hosts."""
            parsed = urlparse(self.path)
            if host.relative_path(parsed.path) is None:
                self.send_response(404)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"Not Found")
                return
            raw = read_cesr_request(self)
            host.parse_messages(raw)
            self.send_response(204)
            self.end_headers()

    return Handler


def main():
    """Run the compatibility host until interrupted."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--alias", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--base", default="")
    parser.add_argument("--bran", default=None)
    parser.add_argument("--base-path", default="/")
    args = parser.parse_args()

    host = CompatHost(
        name=args.name,
        alias=args.alias,
        base=args.base,
        bran=args.bran,
        port=args.port,
        base_path=args.base_path,
    )
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(host))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        host.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # pragma: no cover - test fixture fatal path
        print(str(error), file=sys.stderr)
        raise
