"""Test-only timing overrides for the frozen KERIpy peers, applied by monkeypatch.

The KERIpy checkouts are reference peers and are never edited. Their waits are
literals inside generators, so this module reaches them from the harness side:
it replaces ``hio.base.doing.doify`` with a version that proxies selected
KERIpy generator methods and shortens only the *sleep values they yield*. Every
deadline, timeout and retry count stays as KERIpy wrote it; a poll that waited
``1.0`` seconds between checks now waits ``0.1``. Nothing here changes what a
command sends, stores or accepts.

Newer KERIpy commits ship a tock registry (``keri.app.tocking``) whose defaults are
already fast and which reads ``KERI_<NAME>_TOCK`` environment variables. When it is
present this module only sets the few variables the defaults leave slower than the
tests want and skips the monkeypatches; older peers (the main, 1.2 and 1.3 profiles)
keep the monkeypatch path below.

Everything is behind one switch. ``KERI_TEST_FAST=1`` turns the overrides on;
any other value, or no value, leaves the pinned commit's own timing (its registry
defaults, or the historical literals) untouched and imports nothing from KERIpy or hio. The final stock-timing qualification pass runs with
the switch off.

Waits this module cannot reach without editing KERIpy (fixed windows measured by
``timedelta`` literals inside a loop, for example the five second ``--poll``
window of ``kli vc list``) are deliberately left alone.
"""

import functools
import importlib
import importlib.util
import inspect
import os
import re
import types

#: Environment variable that enables the overrides. Only the value ``1`` does.
SWITCH = "KERI_TEST_FAST"

#: The Doist cycle ``keri.app.directing.runController`` hard-codes (32 ms).
STOCK_TOCK = 0.03125
#: Faster cycle used while the switch is on; every tock-0 doer runs once per cycle.
FAST_TOCK = 0.005

#: Idle wait of ``WitnessReceiptor`` between checks that a witness queue drained.
RECEIPT_IDLE = {1.0: 0.05}
#: Escrow processing loops of Anchorer, Counselor, Registrar and Credentialer.
ESCROW_PASS = {0.5: 0.05}
#: Command condition polls (resolve an OOBI, wait for a query, wait for a challenge reply).
COMMAND_POLL = {1.0: 0.1, 0.5: 0.1, 0.25: 0.05, 2.0: 0.2}
#: Mailbox ``Poller`` event check; the reconnect wait is capped instead of mapped.
POLLER_EVENT_CHECK = {0.25: 0.02}
POLLER_RECONNECT_CAP = 0.5
#: Reconnect hint (milliseconds) KERIpy's mailbox servers send to SSE clients.
MAILBOX_RETRY_MS = 500
#: Seconds an unresolved OOBI waits before it is retried (stock 30).
OOBI_RETRY_DELAY = 1
#: Tock registry module of newer KERIpy commits, and the one default tighter than its default.
TOCK_REGISTRY = "keri.app.tocking"
REGISTRY_ENVIRONMENT = {"KERI_OOBI_RETRY_TOCK": str(OOBI_RETRY_DELAY)}

#: Library generators, keyed by ``module.qualname`` with a shared value map.
LIBRARY_RULES = {
    "keri.app.agenting.WitnessReceiptor.receiptDo": (RECEIPT_IDLE, None),
    "keri.app.indirecting.Poller.eventDo": (POLLER_EVENT_CHECK, POLLER_RECONNECT_CAP),
}
#: Escrow loops are named ``escrowDo`` in these modules.
ESCROW_MODULES = ("keri.app.delegating", "keri.app.grouping", "keri.vdr.credentialing")
#: CLI command modules whose loops poll a condition (not a fixed ``--poll`` window).
#: ``keri.cli`` is the v2 layout, ``keri.app.cli`` the v1 layout of the release peers.
COMMAND_MODULES = (
    "commands.query",
    "commands.contacts.query",
    "commands.contacts.add",
    "commands.challenge.verify",
    "commands.oobi.resolve",
    "commands.init",
    "commands.multisig.continue_",
    "commands.multisig.continue",
)
_COMMAND_PREFIXES = ("keri.cli.", "keri.app.cli.")

_applied = False


def enabled(environ=os.environ):
    """Return True only when the one documented switch is set to ``1``."""
    return environ.get(SWITCH) == "1"


def _shorten(rules):
    """Build the sleep-value mapper for one generator."""
    values, cap = rules

    def shorten(value):
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if value in values:
                return values[value]
            if cap is not None and value > cap:
                return cap
        return value

    return shorten


def _proxy(generator_function, rules):
    """Wrap a generator function so the values it yields are shortened.

    The proxy forwards ``send``, ``throw`` and ``close`` and returns the wrapped
    generator's return value, which is everything hio's doers rely on.
    """
    shorten = _shorten(rules)

    @functools.wraps(generator_function)
    def proxy(*args, **kwargs):
        inner = generator_function(*args, **kwargs)
        sent = None
        thrown = None
        while True:
            try:
                value = inner.throw(thrown) if thrown is not None else inner.send(sent)
            except StopIteration as stop:
                return stop.value
            thrown = None
            try:
                sent = yield shorten(value)
            except GeneratorExit:
                inner.close()
                raise
            except BaseException as error:  # forwarded into the wrapped generator
                thrown = error
                sent = None

    return proxy


def _rules_for(function):
    """Return the shortening rules for a KERIpy generator function, or None."""
    module = getattr(function, "__module__", "") or ""
    qualname = getattr(function, "__qualname__", "") or ""
    rules = LIBRARY_RULES.get(f"{module}.{qualname}")
    if rules is not None:
        return rules
    if module in ESCROW_MODULES and qualname.endswith(".escrowDo"):
        return (ESCROW_PASS, None)
    for prefix in _COMMAND_PREFIXES:
        if module.startswith(prefix) and module[len(prefix):] in COMMAND_MODULES:
            return (COMMAND_POLL, None)
    return None


def _patch_doify(doing):
    """Route KERIpy's doified generator methods through the shortening proxy."""
    stock = doing.doify

    @functools.wraps(stock)
    def doify(f, *args, **kwargs):
        function = getattr(f, "__func__", f)
        if inspect.isgeneratorfunction(function):
            rules = _rules_for(function)
            if rules is not None:
                proxied = _proxy(function, rules)
                f = types.MethodType(proxied, f.__self__) if inspect.ismethod(f) else proxied
        return stock(f, *args, **kwargs)

    doing.doify = doify


def _patch_doist_tock(doing):
    """Run ``runController``'s Doist at the fast cycle; other Doists are untouched."""
    stock = doing.Doist.__init__

    @functools.wraps(stock)
    def init(self, *args, **kwargs):
        if kwargs.get("tock") == STOCK_TOCK:
            kwargs["tock"] = FAST_TOCK
        stock(self, *args, **kwargs)

    doing.Doist.__init__ = init


def _patch_lmdb_nosync():
    """Skip per-commit fsync for KERIpy stores; a killed process loses nothing.

    The pages stay in the OS cache, so a stopped or killed peer and a later
    reader still see every committed transaction. Only power-loss durability goes.
    """
    lmdb = importlib.import_module("lmdb")
    stock = lmdb.open

    @functools.wraps(stock)
    def open_environment(*args, **kwargs):
        kwargs["sync"] = False
        kwargs["metasync"] = False
        return stock(*args, **kwargs)

    lmdb.open = open_environment


def _has_tock_registry():
    """True when the selected KERIpy ships the tock registry (``keri.app.tocking``)."""
    try:
        return importlib.util.find_spec(TOCK_REGISTRY) is not None
    except (ImportError, ValueError):
        return False


def _patch_keri_constants():
    """Shorten the OOBI retry delay and the mailbox reconnect hint, where present."""
    try:
        oobiing = importlib.import_module("keri.app.oobiing")
        oobiing.Oobiery.RetryDelay = OOBI_RETRY_DELAY
    except (ImportError, AttributeError):
        pass
    _patch_mailbox_retry_hint()


def _patch_mailbox_retry_hint():
    """Lower the SSE reconnect hint mailbox servers send (default 5000 ms), where present."""
    try:
        indirecting = importlib.import_module("keri.app.indirecting")
    except ImportError:
        return
    for name in ("MailboxIterable", "QryRpyMailboxIterable"):
        klas = getattr(indirecting, name, None)
        defaults = getattr(getattr(klas, "__init__", None), "__defaults__", None)
        if defaults and defaults[-1] == 5000:
            klas.__init__.__defaults__ = (*defaults[:-1], MAILBOX_RETRY_MS)


def apply(environ=os.environ):
    """Apply the overrides once, when the switch is on, before KERIpy's ``main()``.

    Returns True when the overrides are active. Patches that do not apply to the
    selected peer (for example a release peer without a given class) are skipped.
    """
    global _applied
    if _applied or not enabled(environ):
        return _applied
    if _has_tock_registry():
        # The registry's defaults already cover cycle time, receipt, command, poller and
        # escrow waits; only the OOBI retry (5 s by default) is tightened here.
        for name, value in REGISTRY_ENVIRONMENT.items():
            os.environ.setdefault(name, value)
    else:
        doing = importlib.import_module("hio.base.doing")
        _patch_doify(doing)
        _patch_doist_tock(doing)
    try:
        _patch_lmdb_nosync()
    except ImportError:
        pass
    if not _has_tock_registry():
        _patch_keri_constants()
    else:
        _patch_mailbox_retry_hint()
    _applied = True
    return True
