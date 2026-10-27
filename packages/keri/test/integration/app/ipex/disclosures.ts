/** Credential graph data, independent of HTTP peer lifetime and conversation order. */
import { Compactor, Kinds, type MapperMap, NonceDex, Noncer, type SerderACDC } from "cesr-ts";
import { assertEquals } from "jsr:@std/assert";
import { acdcmap } from "../../../../src/acdc/messaging.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import type { DisclosurePlan } from "../../../../src/app/ipex/ipex-graph.ts";
import { Schemer } from "../../../../src/core/scheming.ts";

/** Build a full commitment and its status-only partial with identical SAIDs. */
function disclosure(
  issuer: string,
  options: { issuee?: string; edge?: MapperMap } = {},
): { full: SerderACDC; partial: SerderACDC } {
  const nonce = () => new Noncer({ code: NonceDex.Salt_128, raw: crypto.getRandomValues(new Uint8Array(16)) }).qb64;
  const scalar = { type: "string" };
  const valueBlock = {
    oneOf: [scalar, {
      type: "object",
      required: ["d", "u", "value"],
      properties: { d: scalar, u: scalar, value: scalar },
      additionalProperties: false,
    }],
  };
  const schema = new Schemer({
    sed: {
      $id: "",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      version: "1.0.0",
      type: "object",
      required: ["v", "t", "d", "u", "i", "s", "a"],
      properties: {
        v: scalar,
        t: { type: "string", const: "acm" },
        d: scalar,
        u: scalar,
        i: scalar,
        s: { oneOf: [scalar, { type: "object" }] },
        a: {
          oneOf: [scalar, {
            type: "object",
            required: ["d", "u", "status", "contact", "role", "private"],
            properties: {
              d: scalar,
              u: scalar,
              i: scalar,
              status: valueBlock,
              contact: {
                oneOf: [scalar, {
                  type: "object",
                  required: ["d", "u", "city", "email", "postcode"],
                  properties: { d: scalar, u: scalar, city: valueBlock, email: valueBlock, postcode: valueBlock },
                  additionalProperties: false,
                }],
              },
              role: valueBlock,
              private: valueBlock,
            },
            additionalProperties: false,
          }],
        },
        e: { oneOf: [scalar, { type: "object" }] },
      },
      additionalProperties: false,
    },
  });
  const full = acdcmap(issuer, {
    ...options,
    schema: schema.sed as MapperMap,
    uuid: nonce(),
    attribute: {
      d: "",
      u: nonce(),
      status: { d: "", u: nonce(), value: "citizen" },
      contact: {
        d: "",
        u: nonce(),
        city: { d: "", u: nonce(), value: "Denver" },
        email: { d: "", u: nonce(), value: "person@example.test" },
        postcode: { d: "", u: nonce(), value: "hidden-postcode" },
      },
      role: { d: "", u: nonce(), value: "engineer" },
      private: { d: "", u: nonce(), value: "hidden-value" },
    },
    kind: Kinds.json,
  });
  return { full, partial: partialDisclosure(full, ["a/status/"]) };
}

/** Derive one independent partial from the immutable full node; never merge earlier reveals. */
export function partialDisclosure(full: SerderACDC, fields: readonly string[]): SerderACDC {
  const compactor = new Compactor({
    mad: structuredClone(full.sad!.a) as MapperMap,
    kind: full.kind,
    verify: false,
  });
  compactor.compact([...fields], "a");
  const partial = acdcmap(full.issuer!, {
    uuid: full.sad!.u as string,
    schema: full.sad!.s as MapperMap,
    attribute: compactor.partials![fields.join("|")].mad,
    edge: full.sad!.e as MapperMap | undefined,
    kind: full.kind,
  });
  assertEquals(partial.said, full.said);
  return partial;
}

export type EdgeRefusalCase =
  | "unknown-leaf"
  | "unknown-group"
  | "malformed-leaf"
  | "edge-schema"
  | "inherited-schema"
  | "malformed-schema";
export type GraphCase = "I2I" | "NI2I" | "E1E" | "AND" | "OR" | "multi-hop" | "branching" | EdgeRefusalCase;
/** Concrete credential bodies, issuer keys and the deliberately missing proof. */
export interface DisclosureGraph {
  fullNodes: SerderACDC[];
  nodes: SerderACDC[];
  badNodes: SerderACDC[];
  issuers: Hab[];
  unsigned: string | null;
}

/** Select graph data without coupling it to the peer's role or conversation order. */
export function graphDisclosures(hby: Habery, hab: Hab, graphCase?: GraphCase): DisclosureGraph {
  if (!graphCase) {
    const { full, partial } = disclosure(hab.pre);
    return { fullNodes: [full], nodes: [partial], badNodes: [], issuers: [hab], unsigned: null };
  }
  if (graphCase === "multi-hop" || graphCase === "branching") return deepGraph(hby, hab, graphCase);
  switch (graphCase) {
    case "I2I":
    case "NI2I":
    case "E1E":
    case "AND":
    case "OR":
      return relationGraph(hby, hab, graphCase);
    default:
      return edgeRefusalGraph(hby, hab, graphCase);
  }
}

/** Root → authority → ancestor, optionally sharing the ancestor with an audit branch. */
function deepGraph(hby: Habery, hab: Hab, graphCase: "multi-hop" | "branching"): DisclosureGraph {
  const authority = hby.makeHab("authority"), ancestor = hby.makeHab("ancestor");
  const tail = disclosure(ancestor.pre, { issuee: authority.pre });
  const middle = disclosure(authority.pre, {
    issuee: hab.pre,
    edge: { d: "", authority: { n: tail.partial.said, o: "I2I" } },
  });
  const edge: MapperMap = { d: "", authority: { n: middle.partial.said, o: "I2I" } };
  const nodes = [middle.partial, tail.partial],
    fullNodes = [middle.full, tail.full],
    issuers = [hab, authority, ancestor];
  if (graphCase === "branching") {
    const auditor = hby.makeHab("auditor");
    const audit = disclosure(auditor.pre, {
      issuee: ancestor.pre,
      edge: { d: "", authority: { n: tail.partial.said, o: "NI2I" } },
    });
    edge.audit = { n: audit.partial.said, o: "NI2I" };
    nodes.splice(1, 0, audit.partial);
    fullNodes.splice(1, 0, audit.full);
    issuers.push(auditor);
  }
  const root = disclosure(hab.pre, { edge });
  nodes.unshift(root.partial);
  fullNodes.unshift(root.full);
  // Multi-hop omits the ancestor entirely; branching carries it without its issuer proof.
  return {
    fullNodes,
    nodes,
    issuers,
    badNodes: graphCase === "multi-hop" ? nodes.slice(0, -1) : nodes,
    unsigned: graphCase === "branching" ? tail.partial.said : null,
  };
}

type RelationCase = "I2I" | "NI2I" | "E1E" | "AND" | "OR";

/** Keep the nested AND/OR truth table separate from credential construction. */
function relationEdge(graphCase: RelationCase, far: SerderACDC, invalid: boolean): MapperMap {
  if (graphCase !== "AND" && graphCase !== "OR") return { d: "", authority: { n: far.said, o: graphCase } };
  return {
    d: "",
    o: graphCase,
    authority: {
      o: graphCase === "AND" ? "OR" : "AND",
      link: { n: far.said, o: invalid && graphCase === "OR" ? "I2I" : "NI2I" },
      sameIssuee: { n: far.said, o: graphCase === "AND" ? "I2I" : "E1E" },
    },
    check: { n: far.said, o: graphCase === "AND" && !invalid ? "E1E" : "I2I" },
  };
}

/** Two nodes vary a relation or proof while retaining independent issuer keys. */
function relationGraph(hby: Habery, hab: Hab, graphCase: RelationCase): DisclosureGraph {
  const authority = hby.makeHab("authority");
  const far = disclosure(authority.pre, { issuee: graphCase === "I2I" ? hab.pre : authority.pre });
  const near = (far: SerderACDC, invalid = false) =>
    disclosure(hab.pre, {
      issuee: authority.pre,
      edge: relationEdge(graphCase, far, invalid),
    });
  const { full, partial } = near(far.partial);
  const nodes = [partial, far.partial];
  let badNodes = nodes;
  if (graphCase === "AND" || graphCase === "OR") {
    badNodes = [near(far.partial, true).partial, far.partial];
  } else if (graphCase !== "NI2I") {
    const badFar = disclosure(authority.pre, { issuee: graphCase === "I2I" ? authority.pre : hab.pre });
    badNodes = [near(badFar.partial).partial, badFar.partial];
  }
  // NI2I leaves the relation intact and removes the far node's proof instead.
  return {
    fullNodes: [full, far.full],
    nodes,
    badNodes,
    issuers: [hab, authority],
    unsigned: graphCase === "NI2I" ? far.partial.said : null,
  };
}

/** Signed controls vary only malformed edge syntax or a declared far-node schema constraint. */
function edgeRefusalGraph(hby: Habery, hab: Hab, graphCase: EdgeRefusalCase): DisclosureGraph {
  const authority = hby.makeHab("authority");
  const far = disclosure(authority.pre, { issuee: hab.pre });
  const pin = (value: string, version = "1.0.0") =>
    new Schemer({
      sed: {
        $id: "",
        version,
        type: "object",
        properties: { a: { properties: { status: { properties: { value: { const: value } } } } } },
      },
    }).sed as MapperMap;
  const near = (invalid: boolean) => {
    const leaf: MapperMap = { n: far.partial.said, o: "I2I" };
    let edge: MapperMap = { d: "", authority: leaf };
    if (graphCase === "unknown-leaf" && invalid) leaf.o = "UNKNOWN";
    if (graphCase === "unknown-group") edge.o = invalid ? "UNKNOWN" : "AND";
    if (graphCase === "malformed-leaf" && invalid) leaf.unexpected = true;
    if (graphCase === "edge-schema") leaf.s = pin(invalid ? "visitor" : "citizen");
    if (graphCase === "inherited-schema") {
      edge = {
        d: "",
        authority: { o: "AND", s: pin(invalid ? "visitor" : "citizen"), link: leaf },
      };
    }
    if (graphCase === "malformed-schema") leaf.s = pin("citizen", invalid ? "invalid-version" : "1.0.0");
    return disclosure(hab.pre, { edge });
  };
  const good = near(false), bad = near(true);
  return {
    fullNodes: [good.full, far.full],
    nodes: [good.partial, far.partial],
    badNodes: [bad.partial, far.partial],
    issuers: [hab, authority],
    unsigned: null,
  };
}

/** Paths describe the disclosed graph, while each node retains only its status field. */
export function disclosurePlan(schema: string, graph?: GraphCase): DisclosurePlan {
  const paths = ["/"];
  if (graph) {
    paths.push(
      graph === "AND" || graph === "OR" || graph === "inherited-schema" ? "/e/authority/link/_/" : "/e/authority/_/",
    );
  }
  if (graph === "branching") paths.push("/e/audit/_/");
  if (graph === "multi-hop" || graph === "branching") paths.push("/e/authority/_/e/authority/_/");
  return paths.map((path) => [schema, path, ["a/status/"]]);
}
