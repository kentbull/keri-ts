"""Drive real hidden CLI input through a Unix PTY and verify terminal restoration."""
import json
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import sys
import tempfile
import termios
import time


SECRET = b"MyPasscodeARealSecret"
OTHER = b"AnotherPasscodeSecretX"


def conversation(command, root, head, answers, expected):
    """Keep the slave open so its terminal settings remain observable after exit."""
    master, slave = pty.openpty()
    before = termios.tcgetattr(slave)
    child = subprocess.Popen(command, cwd=root, stdin=slave,
                             stdout=subprocess.PIPE, stderr=slave)
    captured = b""
    index = 0
    deadline = time.monotonic() + 20
    try:
        while child.poll() is None:
            if time.monotonic() > deadline:
                raise AssertionError("Terminal input did not settle: " + repr(captured))
            if select.select([master], [], [], 0.05)[0]:
                captured += os.read(master, 65536)
            if index < len(answers) and answers[index][0] in captured:
                _, answer = answers[index]
                # Retain only new UI bytes when waiting for the next prompt.
                captured += b"\n"
                if answer == "halt":
                    child.send_signal(signal.SIGUSR1)
                else:
                    os.write(master, answer)
                index += 1
        while select.select([master], [], [], 0)[0]:
            captured += os.read(master, 65536)
        output = child.stdout.read()
        assert child.returncode == expected, (child.returncode, output, captured)
        assert index == len(answers), (index, captured)
        assert SECRET not in captured and OTHER not in captured, captured
        assert SECRET not in output and OTHER not in output, output
        assert termios.tcgetattr(slave) == before, "Terminal settings were not restored"
        if expected:
            assert list(head.iterdir()) == [], list(head.iterdir())
        return output
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        child.stdout.close()
        os.close(master)
        os.close(slave)


def main():
    """Exercise successful input, blank/mismatch, Ctrl-C, Ctrl-D and task halt."""
    executable = sys.argv[1]
    root = Path(__file__).resolve().parents[4]
    cases = {
        "confirm": ([(b"Passcode:", SECRET + b"\r"), (b"Re-enter passcode:", SECRET + b"\r")], 0),
        "blank": ([(b"Passcode:", b"\r")], 1),
        "mismatch": ([(b"Passcode:", SECRET + b"\r"), (b"Re-enter passcode:", OTHER + b"\r")], 1),
        "cancel": ([(b"Passcode:", SECRET + b"\r"), (b"Re-enter passcode:", b"\x03")], 1),
        "eof": ([(b"Passcode:", b"\x04")], 1),
    }
    with tempfile.TemporaryDirectory(prefix="init-terminal-") as directory:
        for name, (answers, expected) in cases.items():
            head = Path(directory) / name
            head.mkdir()
            command = [executable, "run", "-A", "--unstable-ffi", "packages/tufa/mod.ts",
                       "init", "--name", name, "--head-dir", str(head)]
            conversation(command, root, head, answers, expected)
        head = Path(directory) / "halt"
        head.mkdir()
        output = conversation([executable, "run", "-A", "test/fixtures/passcode-cancel.ts"],
                              root / "packages/keri", head, [(b"Passcode:", "halt")], 0)
        assert b"passcode task halted and input restored" in output
    print(json.dumps({"cases": [*cases, "halt"], "hidden": True, "restored": True}))


if __name__ == "__main__":
    main()
