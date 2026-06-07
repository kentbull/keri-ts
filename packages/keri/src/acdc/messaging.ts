/**
 * ACDC v2 message factory helpers.
 *
 * This module mirrors KERIpy's `keri.acdc.messaging` builder surface. Callers
 * provide semantic values and the helpers preserve KERIpy field order, default
 * schema content, compact-form SAID rules, and v2 registry-update SAD shapes
 * before delegating serialization to `SerderACDC`.
 */
import {
  Ilks,
  type Kind,
  Kinds,
  Mapper,
  type MapperMap,
  type MapperValue,
  NonceDex,
  Noncer,
  Protocols,
  SerderACDC,
  versify,
  type Versionage,
  Vrsn_2_0,
} from "../../../cesr/mod.ts";
import { ValidationError } from "../core/errors.ts";
import { makeNowIso8601 } from "../time/mod.ts";

type SectionValue = string | MapperMap;
type AggregateValue = string | MapperValue[];

interface AcdcVersionOptions {
  pvrsn?: Versionage;
  gvrsn?: Versionage | null;
  kind?: Kind;
}

interface AcdcTopLevelOptions extends AcdcVersionOptions {
  uuid?: string | null;
  regid?: string | null;
  schema?: SectionValue | null;
  edge?: SectionValue | null;
  rule?: SectionValue | null;
  compactify?: boolean;
}

export interface RegceptOptions extends AcdcVersionOptions {
  uuid?: string | null;
  stamp?: string | null;
}

export interface BlindateOptions extends AcdcVersionOptions {
  sn?: number | bigint;
  stamp?: string | null;
}

export interface UpdateOptions extends AcdcVersionOptions {
  sn?: number | bigint;
  stamp?: string | null;
}

export interface AcdcMapOptions extends AcdcTopLevelOptions {
  ilk?: typeof Ilks.acm | null;
  attribute?: SectionValue | null;
  issuee?: string | null;
  aggregate?: AggregateValue | null;
}

export interface AcdcAttributeOptions extends AcdcTopLevelOptions {
  attribute?: SectionValue | null;
  issuee?: string | null;
}

export interface AcdcAggregateOptions extends AcdcTopLevelOptions {
  aggregate?: AggregateValue | null;
}

export interface SectionateOptions extends AcdcVersionOptions {
  ilk?: typeof Ilks.acm | typeof Ilks.act | typeof Ilks.acg | null;
  uuid?: string | null;
  regid?: string | null;
  schema?: SectionValue | null;
  attribute?: SectionValue | null;
  issuee?: string | null;
  aggregate?: AggregateValue | null;
  edge?: SectionValue | null;
  rule?: SectionValue | null;
}

export type DefaultSchemaResult = readonly [said: string, sad: MapperMap];
export type SectionateResult = readonly [
  acdc: SerderACDC,
  schema: SerderACDC,
  attribute: SerderACDC | null,
  aggregate: SerderACDC | null,
  edge: SerderACDC,
  rule: SerderACDC,
];

function versionString({
  pvrsn = Vrsn_2_0,
  gvrsn = Vrsn_2_0,
  kind = Kinds.json,
}: AcdcVersionOptions = {}): string {
  return versify({
    proto: Protocols.acdc,
    pvrsn,
    gvrsn,
    kind,
    size: 0,
  });
}

function sequenceHex(sn: number | bigint): string {
  const value = BigInt(sn);
  if (value < 0n) {
    throw new ValidationError(`ACDC sequence number must be non-negative: ${sn}`);
  }
  return value.toString(16);
}

function randomNonce(): string {
  return new Noncer({
    code: NonceDex.Salt_128,
    raw: crypto.getRandomValues(new Uint8Array(16)),
  }).qb64;
}

function cloneMapperValue<T extends MapperValue | undefined | null>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneMapperValue(entry)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneMapperValue(entry as MapperValue)]),
    ) as T;
  }
  return value;
}

function defaultSchema(schema: MapperMap, kind: Kind): DefaultSchemaResult {
  const mapper = new Mapper({
    mad: schema,
    makify: true,
    strict: false,
    saids: { "$id": "E" },
    saidive: true,
    kind,
  });
  const said = mapper.said;
  if (said === null) {
    throw new ValidationError("Default ACDC schema did not produce an $id SAID.");
  }
  return [said, mapper.mad] as const;
}

function schemaSaidAndSad(
  schema: SectionValue | null | undefined,
  fallback: DefaultSchemaResult,
  kind: Kind,
): DefaultSchemaResult {
  if (schema === undefined || schema === null) {
    return fallback;
  }
  if (typeof schema === "string") {
    return [schema, schema as unknown as MapperMap] as const;
  }
  return defaultSchema(cloneMapperValue(schema), kind);
}

function withIssuee(
  attribute: SectionValue | null | undefined,
  issuee: string | null | undefined,
): SectionValue | null | undefined {
  const cloned = cloneMapperValue(attribute);
  if (issuee !== undefined && issuee !== null && cloned && typeof cloned === "object" && !Array.isArray(cloned)) {
    cloned.i = issuee;
  }
  return cloned;
}

function validateAttributeAggregatePair(
  attribute: unknown,
  aggregate: unknown,
): void {
  if ((attribute !== undefined && attribute !== null) === (aggregate !== undefined && aggregate !== null)) {
    throw new ValidationError("Either one or the other but not both of attribute and aggregate is required.");
  }
}

/** Create an ACDC v2 registry inception (`rip`) message. */
export function regcept(issuer: string, options: RegceptOptions = {}): SerderACDC {
  const { uuid, stamp, pvrsn = Vrsn_2_0, gvrsn = Vrsn_2_0, kind = Kinds.json } = options;
  return new SerderACDC({
    sad: {
      v: versionString({ pvrsn, gvrsn, kind }),
      t: Ilks.rip,
      d: "",
      u: uuid ?? randomNonce(),
      i: issuer,
      n: sequenceHex(0),
      dt: stamp ?? makeNowIso8601(),
    },
    makify: true,
  });
}

/** Create an ACDC v2 blindable registry update (`bup`) message. */
export function blindate(
  regid: string,
  prior: string,
  blid: string,
  options: BlindateOptions = {},
): SerderACDC {
  const { sn = 1, stamp, pvrsn = Vrsn_2_0, gvrsn = Vrsn_2_0, kind = Kinds.json } = options;
  return new SerderACDC({
    sad: {
      v: versionString({ pvrsn, gvrsn, kind }),
      t: Ilks.bup,
      d: "",
      rd: regid,
      n: sequenceHex(sn),
      p: prior,
      dt: stamp ?? makeNowIso8601(),
      b: blid,
    },
    makify: true,
  });
}

/** Create an ACDC v2 registry transaction-state update (`upd`) message. */
export function update(
  regid: string,
  prior: string,
  acdc: string,
  state: string,
  options: UpdateOptions = {},
): SerderACDC {
  const { sn = 1, stamp, pvrsn = Vrsn_2_0, gvrsn = Vrsn_2_0, kind = Kinds.json } = options;
  return new SerderACDC({
    sad: {
      v: versionString({ pvrsn, gvrsn, kind }),
      t: Ilks.upd,
      d: "",
      rd: regid,
      n: sequenceHex(sn),
      p: prior,
      dt: stamp ?? makeNowIso8601(),
      td: acdc,
      ts: state,
    },
    makify: true,
  });
}

/** Create the default schema block for ACDC v2 map-style (`acm`) messages. */
export function acmSchemaDefault(kind: Kind = Kinds.json): DefaultSchemaResult {
  return defaultSchema({
    "$id": "",
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    title: "ACM Default Schema",
    description: "Default JSON Schema for acm ACDC.",
    credentialType: "ACDC_acm_message",
    version: "2.0.0",
    type: "object",
    required: ["v", "d", "i", "s"],
    properties: {
      v: { description: "ACDC version string", type: "string" },
      t: { description: "Message type", type: "string" },
      d: { description: "Message SAID", type: "string" },
      u: { description: "Message UUID", type: "string" },
      i: { description: "Issuer AID", type: "string" },
      rd: { description: "Registry SAID", type: "string" },
      s: {
        description: "Schema Section",
        oneOf: [
          { description: "Schema Section SAID", type: "string" },
          { description: "Uncompacted Schema Section", type: "object" },
        ],
      },
      a: {
        description: "Attribute Section",
        oneOf: [
          { description: "Attribute Section SAID", type: "string" },
          { description: "Uncompacted Attribute Section", type: "object" },
        ],
      },
      A: {
        description: "Aggregate Section",
        oneOf: [
          { description: "Aggregate Section AGID", type: "string" },
          { description: "Uncompacted Aggregate Section", type: "array" },
        ],
      },
      e: {
        description: "Edge Section",
        oneOf: [
          { description: "Edge Section SAID", type: "string" },
          { description: "Uncompacted Edge Section", type: "object" },
        ],
      },
      r: {
        description: "Rule Section",
        oneOf: [
          { description: "Rule Section SAID", type: "string" },
          { description: "Uncompacted Rule Section", type: "object" },
        ],
      },
    },
    additionalProperties: false,
  }, kind);
}

/** Create the default schema block for ACDC v2 fixed-attribute (`act`) messages. */
export function actSchemaDefault(kind: Kind = Kinds.json): DefaultSchemaResult {
  return defaultSchema({
    "$id": "",
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    title: "ACT Default Schema",
    description: "Default JSON Schema for act ACDC.",
    credentialType: "ACDC_act_message",
    version: "2.0.0",
    type: "object",
    required: ["v", "t", "d", "u", "i", "rd", "s", "a", "e", "r"],
    properties: {
      v: { description: "ACDC version string", type: "string" },
      t: { description: "Message type", type: "string" },
      d: { description: "Message SAID", type: "string" },
      u: { description: "Message UUID", type: "string" },
      i: { description: "Issuer AID", type: "string" },
      rd: { description: "Registry SAID", type: "string" },
      s: {
        description: "Schema Section",
        oneOf: [
          { description: "Schema Section SAID", type: "string" },
          { description: "Uncompacted Schema Section", type: "object" },
        ],
      },
      a: {
        description: "Attribute Section",
        oneOf: [
          { description: "Attribute Section SAID", type: "string" },
          { description: "Uncompacted Attribute Section", type: "object" },
        ],
      },
      e: {
        description: "Edge Section",
        oneOf: [
          { description: "Edge Section SAID", type: "string" },
          { description: "Uncompacted Edge Section", type: "object" },
        ],
      },
      r: {
        description: "Rule Section",
        oneOf: [
          { description: "Rule Section SAID", type: "string" },
          { description: "Uncompacted Rule Section", type: "object" },
        ],
      },
    },
    additionalProperties: false,
  }, kind);
}

/** Create the default schema block for ACDC v2 fixed-aggregate (`acg`) messages. */
export function acgSchemaDefault(kind: Kind = Kinds.json): DefaultSchemaResult {
  return defaultSchema({
    "$id": "",
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    title: "ACG Default Schema",
    description: "Default JSON Schema for acg ACDC.",
    credentialType: "ACDC_acg_message",
    version: "2.0.0",
    type: "object",
    required: ["v", "t", "d", "u", "i", "rd", "s", "A", "e", "r"],
    properties: {
      v: { description: "ACDC version string", type: "string" },
      t: { description: "Message type", type: "string" },
      d: { description: "Message SAID", type: "string" },
      u: { description: "Message UUID", type: "string" },
      i: { description: "Issuer AID", type: "string" },
      rd: { description: "Registry SAID", type: "string" },
      s: {
        description: "Schema Section",
        oneOf: [
          { description: "Schema Section SAID", type: "string" },
          { description: "Uncompacted Schema Section", type: "object" },
        ],
      },
      A: {
        description: "Aggregate Section",
        oneOf: [
          { description: "Aggregate Section AGID", type: "string" },
          { description: "Uncompacted Aggregate Section", type: "array" },
        ],
      },
      e: {
        description: "Edge Section",
        oneOf: [
          { description: "Edge Section SAID", type: "string" },
          { description: "Uncompacted Edge Section", type: "object" },
        ],
      },
      r: {
        description: "Rule Section",
        oneOf: [
          { description: "Rule Section SAID", type: "string" },
          { description: "Uncompacted Rule Section", type: "object" },
        ],
      },
    },
    additionalProperties: false,
  }, kind);
}

/** Create a top-level field-map ACDC v2 message (`acm` or implicit map ACDC). */
export function acdcmap(issuer: string, options: AcdcMapOptions = {}): SerderACDC {
  const {
    ilk = Ilks.acm,
    uuid,
    regid,
    schema,
    attribute,
    issuee,
    aggregate,
    edge,
    rule,
    pvrsn = Vrsn_2_0,
    gvrsn = Vrsn_2_0,
    kind = Kinds.json,
    compactify = false,
  } = options;
  validateAttributeAggregatePair(attribute, aggregate);
  const actualAttribute = withIssuee(attribute, issuee);
  const [, schemaSad] = schemaSaidAndSad(schema, acmSchemaDefault(kind), kind);
  const sad: Record<string, unknown> = {
    v: versionString({ pvrsn, gvrsn, kind }),
  };
  if (ilk !== null) {
    sad.t = ilk;
  }
  sad.d = "";
  if (uuid !== undefined && uuid !== null) {
    sad.u = uuid;
  }
  sad.i = issuer;
  if (regid !== undefined && regid !== null) {
    sad.rd = regid;
  }
  sad.s = schemaSad;
  if (actualAttribute !== undefined && actualAttribute !== null) {
    sad.a = actualAttribute;
  }
  if (aggregate !== undefined && aggregate !== null) {
    sad.A = cloneMapperValue(aggregate as MapperValue[]);
  }
  if (edge !== undefined && edge !== null) {
    sad.e = cloneMapperValue(edge);
  }
  if (rule !== undefined && rule !== null) {
    sad.r = cloneMapperValue(rule);
  }
  return new SerderACDC({ sad, makify: true, compactify });
}

/** Create a top-level fixed-attribute ACDC v2 message (`act`). */
export function acdcatt(issuer: string, options: AcdcAttributeOptions = {}): SerderACDC {
  const {
    uuid,
    regid,
    schema,
    attribute,
    issuee,
    edge,
    rule,
    pvrsn = Vrsn_2_0,
    gvrsn = Vrsn_2_0,
    kind = Kinds.json,
    compactify = false,
  } = options;
  const [, schemaSad] = schemaSaidAndSad(schema, actSchemaDefault(kind), kind);
  return new SerderACDC({
    sad: {
      v: versionString({ pvrsn, gvrsn, kind }),
      t: Ilks.act,
      d: "",
      u: uuid ?? "",
      i: issuer,
      rd: regid ?? "",
      s: schemaSad,
      a: withIssuee(attribute ?? {}, issuee),
      e: cloneMapperValue(edge ?? {}),
      r: cloneMapperValue(rule ?? {}),
    },
    makify: true,
    compactify,
  });
}

/** Create a top-level fixed-aggregate ACDC v2 message (`acg`). */
export function acdcagg(issuer: string, options: AcdcAggregateOptions = {}): SerderACDC {
  const {
    uuid,
    regid,
    schema,
    aggregate,
    edge,
    rule,
    pvrsn = Vrsn_2_0,
    gvrsn = Vrsn_2_0,
    kind = Kinds.json,
    compactify = false,
  } = options;
  const [, schemaSad] = schemaSaidAndSad(schema, acgSchemaDefault(kind), kind);
  return new SerderACDC({
    sad: {
      v: versionString({ pvrsn, gvrsn, kind }),
      t: Ilks.acg,
      d: "",
      u: uuid ?? "",
      i: issuer,
      rd: regid ?? "",
      s: schemaSad,
      A: cloneMapperValue(aggregate ?? []),
      e: cloneMapperValue(edge ?? {}),
      r: cloneMapperValue(rule ?? {}),
    },
    makify: true,
    compactify,
  });
}

/** Create a compact schema-section (`sch`) disclosure message. */
export function sectschema(schema: SectionValue, options: AcdcVersionOptions = {}): SerderACDC {
  const { pvrsn = Vrsn_2_0, gvrsn = Vrsn_2_0, kind = Kinds.json } = options;
  return new SerderACDC({
    sad: { v: versionString({ pvrsn, gvrsn, kind }), t: Ilks.sch, d: "", s: cloneMapperValue(schema) },
    makify: true,
  });
}

/** Create a compact attribute-section (`att`) disclosure message. */
export function sectattr(attribute: SectionValue, options: AcdcVersionOptions = {}): SerderACDC {
  const { pvrsn = Vrsn_2_0, gvrsn = Vrsn_2_0, kind = Kinds.json } = options;
  return new SerderACDC({
    sad: { v: versionString({ pvrsn, gvrsn, kind }), t: Ilks.att, d: "", a: cloneMapperValue(attribute) },
    makify: true,
  });
}

/** Create a compact aggregate-section (`agg`) disclosure message. */
export function sectaggr(aggregate: AggregateValue, options: AcdcVersionOptions = {}): SerderACDC {
  const { pvrsn = Vrsn_2_0, gvrsn = Vrsn_2_0, kind = Kinds.json } = options;
  return new SerderACDC({
    sad: { v: versionString({ pvrsn, gvrsn, kind }), t: Ilks.agg, d: "", A: cloneMapperValue(aggregate) },
    makify: true,
  });
}

/** Create a compact edge-section (`edg`) disclosure message. */
export function sectedge(edge: SectionValue | null | undefined, options: AcdcVersionOptions = {}): SerderACDC {
  const { pvrsn = Vrsn_2_0, gvrsn = Vrsn_2_0, kind = Kinds.json } = options;
  return new SerderACDC({
    sad: { v: versionString({ pvrsn, gvrsn, kind }), t: Ilks.edg, d: "", e: cloneMapperValue(edge ?? {}) },
    makify: true,
  });
}

/** Create a compact rule-section (`rul`) disclosure message. */
export function sectrule(rule: SectionValue | null | undefined, options: AcdcVersionOptions = {}): SerderACDC {
  const { pvrsn = Vrsn_2_0, gvrsn = Vrsn_2_0, kind = Kinds.json } = options;
  return new SerderACDC({
    sad: { v: versionString({ pvrsn, gvrsn, kind }), t: Ilks.rul, d: "", r: cloneMapperValue(rule ?? {}) },
    makify: true,
  });
}

/**
 * Create a compact top-level ACDC plus the section disclosure messages needed
 * to re-expand it.
 */
export function sectionate(issuer: string, options: SectionateOptions = {}): SectionateResult {
  const {
    ilk = Ilks.acm,
    uuid,
    regid,
    schema,
    attribute,
    issuee,
    aggregate,
    edge,
    rule,
    pvrsn = Vrsn_2_0,
    gvrsn = Vrsn_2_0,
    kind = Kinds.json,
  } = options;

  if (ilk !== null && ilk !== Ilks.acm && ilk !== Ilks.act && ilk !== Ilks.acg) {
    throw new ValidationError(`Invalid ACDC message ilk=${ilk}.`);
  }
  validateAttributeAggregatePair(attribute, aggregate);
  if (ilk === Ilks.act && (attribute === undefined || attribute === null)) {
    throw new ValidationError("Invalid attribute=null for ilk=act.");
  }
  if (ilk === Ilks.acg && (aggregate === undefined || aggregate === null)) {
    throw new ValidationError("Invalid aggregate=null for ilk=acg.");
  }

  const actualAttribute = withIssuee(attribute, issuee);
  const fallback = ilk === Ilks.act
    ? actSchemaDefault(kind)
    : ilk === Ilks.acg
    ? acgSchemaDefault(kind)
    : acmSchemaDefault(kind);
  const [schemaSaid, schemaSad] = schemaSaidAndSad(schema, fallback, kind);
  const versionOptions = { pvrsn, gvrsn, kind };
  const sch = sectschema(schemaSad, versionOptions);

  if (ilk === Ilks.act) {
    const acdc = acdcatt(issuer, {
      uuid,
      regid,
      schema: schemaSaid,
      attribute: actualAttribute,
      issuee,
      edge,
      rule,
      ...versionOptions,
      compactify: true,
    });
    return [
      acdc,
      sch,
      sectattr(actualAttribute as SectionValue, versionOptions),
      null,
      sectedge(edge, versionOptions),
      sectrule(rule, versionOptions),
    ] as const;
  }

  if (ilk === Ilks.acg) {
    const acdc = acdcagg(issuer, {
      uuid,
      regid,
      schema: schemaSaid,
      aggregate,
      edge,
      rule,
      ...versionOptions,
      compactify: true,
    });
    return [
      acdc,
      sch,
      null,
      sectaggr(aggregate as AggregateValue, versionOptions),
      sectedge(edge, versionOptions),
      sectrule(rule, versionOptions),
    ] as const;
  }

  const acdc = acdcmap(issuer, {
    ilk,
    uuid,
    regid,
    schema: schemaSaid,
    attribute: actualAttribute,
    issuee,
    aggregate,
    edge,
    rule,
    ...versionOptions,
    compactify: true,
  });
  return [
    acdc,
    sch,
    actualAttribute !== undefined && actualAttribute !== null ? sectattr(actualAttribute, versionOptions) : null,
    aggregate !== undefined && aggregate !== null ? sectaggr(aggregate, versionOptions) : null,
    sectedge(edge, versionOptions),
    sectrule(rule, versionOptions),
  ] as const;
}
