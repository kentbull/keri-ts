"""Independent KERIpy credential graphs; no server or conversation driving."""
import copy
from dataclasses import dataclass

from keri import Kinds
from keri.acdc import acdcmap
from keri.app import Hab
from keri.core import Compactor, Noncer, SerderACDC


def disclosure(issuer, *, issuee=None, edge=None):
    """Build a full commitment and its status-only partial with identical SAIDs."""
    full = acdcmap(issuer, uuid=Noncer().qb64, iseaid=issuee, edge=edge, attribute=dict(
        d="", u=Noncer().qb64,
        status=dict(d="", u=Noncer().qb64, value="citizen"),
        contact=dict(d="", u=Noncer().qb64,
                     city=dict(d="", u=Noncer().qb64, value="Denver"),
                     email=dict(d="", u=Noncer().qb64, value="person@example.test"),
                     postcode=dict(d="", u=Noncer().qb64, value="hidden-postcode")),
        role=dict(d="", u=Noncer().qb64, value="engineer"),
        private=dict(d="", u=Noncer().qb64, value="hidden-value")))
    return full, partial_disclosure(full, ["a/status/"])


def partial_disclosure(full, fields):
    """Derive an independent partial from its full commitment, never an earlier reveal."""
    compactor = Compactor(mad=copy.deepcopy(full.sad["a"]),
                          kind=full.kind, verify=False)
    compactor.compact(paths=fields, root="a")
    partial = acdcmap(full.israid, uuid=full.sad["u"], schema=full.sad["s"],
                      attribute=compactor.partials[tuple(fields)].mad,
                      edge=full.sad.get("e"))
    assert partial.said == full.said
    return partial


@dataclass
class DisclosureGraph:
    """Concrete credential bodies, issuer keys and the deliberately missing proof."""
    full_nodes: list[SerderACDC]
    nodes: list[SerderACDC]
    bad_nodes: list[SerderACDC]
    issuers: list[Hab]
    unsigned: str | None


def graph_disclosures(hby, hab, graph_case):
    """Select graph data without coupling it to the peer's role or conversation order."""
    if graph_case is None:
        full, partial = disclosure(hab.pre)
        return DisclosureGraph([full], [partial], [], [hab], None)
    if graph_case in ("multi-hop", "branching"):
        return deep_graph(hby, hab, graph_case)
    return relation_graph(hby, hab, graph_case)


def deep_graph(hby, hab, graph_case):
    """Root -> authority -> ancestor, optionally shared with an audit branch."""
    authority, ancestor = hby.makeHab(name="authority"), hby.makeHab(name="ancestor")
    tail_full, tail = disclosure(ancestor.pre, issuee=authority.pre)
    middle_full, middle = disclosure(authority.pre, issuee=hab.pre,
                           edge=dict(d="", authority=dict(n=tail.said, o="I2I")))
    edge = dict(d="", authority=dict(n=middle.said, o="I2I"))
    nodes, full_nodes, issuers = [middle, tail], [middle_full, tail_full], [hab, authority, ancestor]
    if graph_case == "branching":
        auditor = hby.makeHab(name="auditor")
        audit_full, audit = disclosure(auditor.pre, issuee=ancestor.pre,
                              edge=dict(d="", authority=dict(n=tail.said, o="NI2I")))
        edge["audit"] = dict(n=audit.said, o="NI2I")
        nodes.insert(1, audit)
        full_nodes.insert(1, audit_full)
        issuers.append(auditor)
    full, partial = disclosure(hab.pre, edge=edge)
    nodes.insert(0, partial)
    full_nodes.insert(0, full)
    # Multi-hop omits the ancestor; branching carries it without its issuer proof.
    return DisclosureGraph(full_nodes, nodes, nodes[:-1] if graph_case == "multi-hop" else nodes,
                           issuers, tail.said if graph_case == "branching" else None)


def relation_edge(graph_case, far, invalid):
    """Keep the nested AND/OR truth table separate from credential construction."""
    if graph_case not in ("AND", "OR"):
        return dict(d="", authority=dict(n=far.said, o=graph_case))
    return dict(d="", o=graph_case, authority=dict(
        o="OR" if graph_case == "AND" else "AND",
        link=dict(n=far.said, o="I2I" if invalid and graph_case == "OR" else "NI2I"),
        sameIssuee=dict(n=far.said, o="I2I" if graph_case == "AND" else "E1E")),
        check=dict(n=far.said, o="E1E" if graph_case == "AND" and not invalid else "I2I"))


def relation_graph(hby, hab, graph_case):
    """Two nodes vary a relation or proof while retaining independent issuer keys."""
    authority = hby.makeHab(name="authority")
    far_full, far = disclosure(authority.pre, issuee=hab.pre if graph_case == "I2I" else authority.pre)

    def near(far, invalid=False):
        return disclosure(hab.pre, issuee=authority.pre, edge=relation_edge(graph_case, far, invalid))

    full, partial = near(far)
    nodes = [partial, far]
    bad_nodes = nodes
    if graph_case in ("AND", "OR"):
        bad_nodes = [near(far, invalid=True)[1], far]
    elif graph_case != "NI2I":
        _, bad_far = disclosure(authority.pre, issuee=authority.pre if graph_case == "I2I" else hab.pre)
        bad_nodes = [near(bad_far)[1], bad_far]
    # NI2I leaves the relation intact and removes the far node's proof instead.
    return DisclosureGraph([full, far_full], nodes, bad_nodes, [hab, authority],
                           far.said if graph_case == "NI2I" else None)
