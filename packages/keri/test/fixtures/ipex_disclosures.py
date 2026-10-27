"""Independent KERIpy credential graphs; no server or conversation driving."""
import copy
from dataclasses import dataclass

from keri import Kinds
from keri.acdc import acdcmap, scheming
from keri.app import Hab
from keri.core import Compactor, Noncer, SerderACDC
from keri.core.scheming import Schemer


def disclosure_schema(edge_schema=None):
    """Shared concrete status/private schema before role-specific edge constraints."""
    scalar = {"type": "string"}
    value_block = {"oneOf": [scalar, {
        "type": "object", "required": ["d", "u", "value"],
        "properties": {"d": scalar, "u": scalar, "value": scalar},
        "additionalProperties": False,
    }]}
    return Schemer(sed={
        "$id": "", "$schema": "https://json-schema.org/draft/2020-12/schema",
        "version": "1.0.0", "type": "object",
        "required": ["v", "t", "d", "u", "i", "s", "a"],
        "properties": {
            "v": scalar, "t": {"type": "string", "const": "acm"},
            "d": scalar, "u": scalar, "i": scalar,
            "s": {"oneOf": [scalar, {"type": "object"}]},
            "a": {"oneOf": [scalar, {
                "type": "object", "required": ["d", "u", "status", "contact", "role", "private"],
                "properties": {
                    "d": scalar, "u": scalar, "i": scalar, "status": value_block,
                    "contact": {"oneOf": [scalar, {
                        "type": "object", "required": ["d", "u", "city", "email", "postcode"],
                        "properties": {"d": scalar, "u": scalar, "city": value_block,
                                       "email": value_block, "postcode": value_block},
                        "additionalProperties": False,
                    }]},
                    "role": value_block, "private": value_block,
                },
                "additionalProperties": False,
            }]},
            "e": edge_schema or {"oneOf": [scalar, {"type": "object"}]},
        },
        "additionalProperties": False,
    })


def disclosure(issuer, *, issuee=None, edge=None, edge_schema=None, schema=None):
    """Build a full commitment and its status-only partial with identical SAIDs."""
    schema = Schemer(sed=schema) if schema is not None else disclosure_schema(edge_schema)
    full = acdcmap(issuer, uuid=Noncer().qb64, iseaid=issuee, edge=edge, schema=schema.sed, attribute=dict(
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
    if graph_case in ("fixed-path", "optional-path"):
        return path_shape_graph(hby, hab, graph_case)
    if graph_case in ("multi-hop", "branching"):
        return deep_graph(hby, hab, graph_case)
    if graph_case in ("I2I", "NI2I", "E1E", "AND", "OR"):
        return relation_graph(hby, hab, graph_case)
    if graph_case in ("unknown-leaf", "unknown-group", "malformed-leaf", "simple-edge", "edge-schema", "inherited-schema", "malformed-schema"):
        return edge_refusal_graph(hby, hab, graph_case)
    raise ValueError(f"Unknown fixture graph: {graph_case}")


def path_shape_graph(hby, hab, shape):
    """Same two-node authority graph; requiredness alone controls positional use."""
    authority = hby.makeHab(name="authority")
    terminal_schema = copy.deepcopy(disclosure_schema().sed)
    terminal_schema["$id"] = ""
    del terminal_schema["properties"]["e"]
    far_full, far = disclosure(authority.pre, issuee=hab.pre, schema=terminal_schema)
    root_schema = copy.deepcopy(disclosure_schema().sed)
    root_schema["$id"] = ""
    root_schema["required"].append("e")
    root_schema["properties"]["e"] = dict(type="object", additionalProperties=False,
        required=["authority"] if shape == "fixed-path" else [],
        properties=dict(d=dict(type="string"), authority=dict(type="object", required=["n"],
            properties=dict(n=dict(type="string"), o=dict(type="string")))))
    full, partial = disclosure(hab.pre, schema=root_schema,
                               edge=dict(d="", authority=dict(n=far.said, o="I2I")))
    for node in (full, partial, far_full, far):
        scheming.validateSchema(acdc=node, db=hby.db)  # selection is not own-schema rejection
    assert partial.sad["e"]["authority"]["n"] == far.said
    assert full.schema["$id"] != far.schema["$id"], "root and terminal schemas are distinct"
    nodes = [partial, far]
    return DisclosureGraph([full, far_full], nodes, nodes, [hab, authority], None)


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


def edge_refusal_graph(hby, hab, graph_case):
    """Vary signed malformed edge syntax or a declared far-node schema constraint."""
    authority = hby.makeHab(name="authority")
    def simple_schema():
        scalar = dict(type="string")
        resource = Schemer(sed={
            "$id": "", "version": "1.0.0", "type": "object",
            "properties": {"d": scalar, "authority": {"$ref": "#/$defs/target"},
                           "opaque": {"oneOf": [scalar, dict(type="object", properties=dict(n=scalar))]}},
            "$defs": {"target": scalar}})
        return dict(oneOf=[scalar, resource.sed])

    far_full, far = disclosure(authority.pre, issuee=hab.pre,
                              edge_schema=simple_schema() if graph_case == "simple-edge" else None)

    def pin(value, version="1.0.0"):
        return Schemer(sed={"$id": "", "version": version, "type": "object",
                            "properties": {"a": {"properties": {"status": {
                                "properties": {"value": {"const": value}}}}}}}).sed

    def near(invalid):
        leaf = dict(n=far.said)
        edge = dict(d="", authority=leaf)
        if graph_case == "unknown-group":
            edge["o"] = "UNKNOWN" if invalid else "AND"
        if graph_case == "malformed-leaf" and invalid:
            leaf["n"] = 42  # Reserved node references must be qualified SAID strings.
        if graph_case == "edge-schema":
            leaf["s"] = pin("visitor" if invalid else "citizen")
        if graph_case == "inherited-schema":
            edge = dict(d="", authority=dict(o="AND", s=pin("visitor" if invalid else "citizen"), link=leaf))
        if graph_case == "malformed-schema":
            leaf["s"] = pin("citizen", "invalid-version" if invalid else "1.0.0")
        leaf["o"] = "UNKNOWN" if graph_case == "unknown-leaf" and invalid else "I2I"
        if graph_case == "simple-edge":
            return disclosure(hab.pre, edge=dict(d="", authority=far.said, **(dict(opaque=far.said) if invalid else {})),
                edge_schema=simple_schema())
        return disclosure(hab.pre, edge=edge)

    full, partial = near(False)
    _, bad = near(True)
    if graph_case == "simple-edge":
        for node in (full, partial, bad, far_full, far):
            assert node.schema == full.schema, "both controls satisfy the negotiated repeated-schema plan"
            scheming.validateSchema(acdc=node, db=hby.db)  # opacity refusal is not own-schema failure
        assert partial.sad["e"]["authority"] == bad.sad["e"]["authority"] == far.said

    return DisclosureGraph([full, far_full], [partial, far], [bad, far], [hab, authority], None)
