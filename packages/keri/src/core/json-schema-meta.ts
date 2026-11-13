/**
 * The JSON Schema meta-schemas the validator checks schema documents against, as data.
 *
 * Source: the draft 2020-12 meta-schemas (core, applicator, unevaluated, validation, meta-data, format-annotation,
 * content) and the draft-07 meta-schema as published by the JSON Schema project (json-schema.org; BSD-3-Clause or
 * AFL-3.0), byte-for-byte except for two mechanical edits:
 * - every `format` annotation is dropped, because schema validation here matches KERIpy and Ajv without a
 *   format checker (a `format` never rejects a document);
 * - every `"$dynamicRef": "#meta"` becomes `"$ref"` to the 2020-12 root schema, which is what it resolves to when
 *   no extension vocabulary replaces the meta-schema, and the validator interprets `$ref` but not `$dynamicRef`.
 * Regular expressions in `pattern` and `patternProperties` are checked separately.
 */
// deno-lint-ignore-file no-explicit-any
type Meta = Record<string, any>;

/** The 2020-12 root meta-schema (`$id` https://json-schema.org/draft/2020-12/schema) and its vocabularies. */
export const META_2020_12: readonly Meta[] = [
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://json-schema.org/draft/2020-12/schema",
    "$vocabulary": {
      "https://json-schema.org/draft/2020-12/vocab/core": true,
      "https://json-schema.org/draft/2020-12/vocab/applicator": true,
      "https://json-schema.org/draft/2020-12/vocab/unevaluated": true,
      "https://json-schema.org/draft/2020-12/vocab/validation": true,
      "https://json-schema.org/draft/2020-12/vocab/meta-data": true,
      "https://json-schema.org/draft/2020-12/vocab/format-annotation": true,
      "https://json-schema.org/draft/2020-12/vocab/content": true,
    },
    "$dynamicAnchor": "meta",
    "title": "Core and Validation specifications meta-schema",
    "allOf": [
      {
        "$ref": "meta/core",
      },
      {
        "$ref": "meta/applicator",
      },
      {
        "$ref": "meta/unevaluated",
      },
      {
        "$ref": "meta/validation",
      },
      {
        "$ref": "meta/meta-data",
      },
      {
        "$ref": "meta/format-annotation",
      },
      {
        "$ref": "meta/content",
      },
    ],
    "type": [
      "object",
      "boolean",
    ],
    "$comment":
      "This meta-schema also defines keywords that have appeared in previous drafts in order to prevent incompatible extensions as they remain in common use.",
    "properties": {
      "definitions": {
        "$comment": "\"definitions\" has been replaced by \"$defs\".",
        "type": "object",
        "additionalProperties": {
          "$ref": "https://json-schema.org/draft/2020-12/schema",
        },
        "deprecated": true,
        "default": {},
      },
      "dependencies": {
        "$comment":
          "\"dependencies\" has been split and replaced by \"dependentSchemas\" and \"dependentRequired\" in order to serve their differing semantics.",
        "type": "object",
        "additionalProperties": {
          "anyOf": [
            {
              "$ref": "https://json-schema.org/draft/2020-12/schema",
            },
            {
              "$ref": "meta/validation#/$defs/stringArray",
            },
          ],
        },
        "deprecated": true,
        "default": {},
      },
      "$recursiveAnchor": {
        "$comment": "\"$recursiveAnchor\" has been replaced by \"$dynamicAnchor\".",
        "$ref": "meta/core#/$defs/anchorString",
        "deprecated": true,
      },
      "$recursiveRef": {
        "$comment": "\"$recursiveRef\" has been replaced by \"$dynamicRef\".",
        "$ref": "meta/core#/$defs/uriReferenceString",
        "deprecated": true,
      },
    },
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://json-schema.org/draft/2020-12/meta/core",
    "$vocabulary": {
      "https://json-schema.org/draft/2020-12/vocab/core": true,
    },
    "$dynamicAnchor": "meta",
    "title": "Core vocabulary meta-schema",
    "type": [
      "object",
      "boolean",
    ],
    "properties": {
      "$id": {
        "$ref": "#/$defs/uriReferenceString",
        "$comment": "Non-empty fragments not allowed.",
        "pattern": "^[^#]*#?$",
      },
      "$schema": {
        "$ref": "#/$defs/uriString",
      },
      "$ref": {
        "$ref": "#/$defs/uriReferenceString",
      },
      "$anchor": {
        "$ref": "#/$defs/anchorString",
      },
      "$dynamicRef": {
        "$ref": "#/$defs/uriReferenceString",
      },
      "$dynamicAnchor": {
        "$ref": "#/$defs/anchorString",
      },
      "$vocabulary": {
        "type": "object",
        "propertyNames": {
          "$ref": "#/$defs/uriString",
        },
        "additionalProperties": {
          "type": "boolean",
        },
      },
      "$comment": {
        "type": "string",
      },
      "$defs": {
        "type": "object",
        "additionalProperties": {
          "$ref": "https://json-schema.org/draft/2020-12/schema",
        },
      },
    },
    "$defs": {
      "anchorString": {
        "type": "string",
        "pattern": "^[A-Za-z_][-A-Za-z0-9._]*$",
      },
      "uriString": {
        "type": "string",
      },
      "uriReferenceString": {
        "type": "string",
      },
    },
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://json-schema.org/draft/2020-12/meta/applicator",
    "$vocabulary": {
      "https://json-schema.org/draft/2020-12/vocab/applicator": true,
    },
    "$dynamicAnchor": "meta",
    "title": "Applicator vocabulary meta-schema",
    "type": [
      "object",
      "boolean",
    ],
    "properties": {
      "prefixItems": {
        "$ref": "#/$defs/schemaArray",
      },
      "items": {
        "$ref": "https://json-schema.org/draft/2020-12/schema",
      },
      "contains": {
        "$ref": "https://json-schema.org/draft/2020-12/schema",
      },
      "additionalProperties": {
        "$ref": "https://json-schema.org/draft/2020-12/schema",
      },
      "properties": {
        "type": "object",
        "additionalProperties": {
          "$ref": "https://json-schema.org/draft/2020-12/schema",
        },
        "default": {},
      },
      "patternProperties": {
        "type": "object",
        "additionalProperties": {
          "$ref": "https://json-schema.org/draft/2020-12/schema",
        },
        "propertyNames": {},
        "default": {},
      },
      "dependentSchemas": {
        "type": "object",
        "additionalProperties": {
          "$ref": "https://json-schema.org/draft/2020-12/schema",
        },
        "default": {},
      },
      "propertyNames": {
        "$ref": "https://json-schema.org/draft/2020-12/schema",
      },
      "if": {
        "$ref": "https://json-schema.org/draft/2020-12/schema",
      },
      "then": {
        "$ref": "https://json-schema.org/draft/2020-12/schema",
      },
      "else": {
        "$ref": "https://json-schema.org/draft/2020-12/schema",
      },
      "allOf": {
        "$ref": "#/$defs/schemaArray",
      },
      "anyOf": {
        "$ref": "#/$defs/schemaArray",
      },
      "oneOf": {
        "$ref": "#/$defs/schemaArray",
      },
      "not": {
        "$ref": "https://json-schema.org/draft/2020-12/schema",
      },
    },
    "$defs": {
      "schemaArray": {
        "type": "array",
        "minItems": 1,
        "items": {
          "$ref": "https://json-schema.org/draft/2020-12/schema",
        },
      },
    },
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://json-schema.org/draft/2020-12/meta/unevaluated",
    "$vocabulary": {
      "https://json-schema.org/draft/2020-12/vocab/unevaluated": true,
    },
    "$dynamicAnchor": "meta",
    "title": "Unevaluated applicator vocabulary meta-schema",
    "type": [
      "object",
      "boolean",
    ],
    "properties": {
      "unevaluatedItems": {
        "$ref": "https://json-schema.org/draft/2020-12/schema",
      },
      "unevaluatedProperties": {
        "$ref": "https://json-schema.org/draft/2020-12/schema",
      },
    },
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://json-schema.org/draft/2020-12/meta/validation",
    "$vocabulary": {
      "https://json-schema.org/draft/2020-12/vocab/validation": true,
    },
    "$dynamicAnchor": "meta",
    "title": "Validation vocabulary meta-schema",
    "type": [
      "object",
      "boolean",
    ],
    "properties": {
      "type": {
        "anyOf": [
          {
            "$ref": "#/$defs/simpleTypes",
          },
          {
            "type": "array",
            "items": {
              "$ref": "#/$defs/simpleTypes",
            },
            "minItems": 1,
            "uniqueItems": true,
          },
        ],
      },
      "const": true,
      "enum": {
        "type": "array",
        "items": true,
      },
      "multipleOf": {
        "type": "number",
        "exclusiveMinimum": 0,
      },
      "maximum": {
        "type": "number",
      },
      "exclusiveMaximum": {
        "type": "number",
      },
      "minimum": {
        "type": "number",
      },
      "exclusiveMinimum": {
        "type": "number",
      },
      "maxLength": {
        "$ref": "#/$defs/nonNegativeInteger",
      },
      "minLength": {
        "$ref": "#/$defs/nonNegativeIntegerDefault0",
      },
      "pattern": {
        "type": "string",
      },
      "maxItems": {
        "$ref": "#/$defs/nonNegativeInteger",
      },
      "minItems": {
        "$ref": "#/$defs/nonNegativeIntegerDefault0",
      },
      "uniqueItems": {
        "type": "boolean",
        "default": false,
      },
      "maxContains": {
        "$ref": "#/$defs/nonNegativeInteger",
      },
      "minContains": {
        "$ref": "#/$defs/nonNegativeInteger",
        "default": 1,
      },
      "maxProperties": {
        "$ref": "#/$defs/nonNegativeInteger",
      },
      "minProperties": {
        "$ref": "#/$defs/nonNegativeIntegerDefault0",
      },
      "required": {
        "$ref": "#/$defs/stringArray",
      },
      "dependentRequired": {
        "type": "object",
        "additionalProperties": {
          "$ref": "#/$defs/stringArray",
        },
      },
    },
    "$defs": {
      "nonNegativeInteger": {
        "type": "integer",
        "minimum": 0,
      },
      "nonNegativeIntegerDefault0": {
        "$ref": "#/$defs/nonNegativeInteger",
        "default": 0,
      },
      "simpleTypes": {
        "enum": [
          "array",
          "boolean",
          "integer",
          "null",
          "number",
          "object",
          "string",
        ],
      },
      "stringArray": {
        "type": "array",
        "items": {
          "type": "string",
        },
        "uniqueItems": true,
        "default": [],
      },
    },
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://json-schema.org/draft/2020-12/meta/meta-data",
    "$vocabulary": {
      "https://json-schema.org/draft/2020-12/vocab/meta-data": true,
    },
    "$dynamicAnchor": "meta",
    "title": "Meta-data vocabulary meta-schema",
    "type": [
      "object",
      "boolean",
    ],
    "properties": {
      "title": {
        "type": "string",
      },
      "description": {
        "type": "string",
      },
      "default": true,
      "deprecated": {
        "type": "boolean",
        "default": false,
      },
      "readOnly": {
        "type": "boolean",
        "default": false,
      },
      "writeOnly": {
        "type": "boolean",
        "default": false,
      },
      "examples": {
        "type": "array",
        "items": true,
      },
    },
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://json-schema.org/draft/2020-12/meta/format-annotation",
    "$vocabulary": {
      "https://json-schema.org/draft/2020-12/vocab/format-annotation": true,
    },
    "$dynamicAnchor": "meta",
    "title": "Format vocabulary meta-schema for annotation results",
    "type": [
      "object",
      "boolean",
    ],
    "properties": {
      "format": {
        "type": "string",
      },
    },
  },
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://json-schema.org/draft/2020-12/meta/content",
    "$vocabulary": {
      "https://json-schema.org/draft/2020-12/vocab/content": true,
    },
    "$dynamicAnchor": "meta",
    "title": "Content vocabulary meta-schema",
    "type": [
      "object",
      "boolean",
    ],
    "properties": {
      "contentEncoding": {
        "type": "string",
      },
      "contentMediaType": {
        "type": "string",
      },
      "contentSchema": {
        "$ref": "https://json-schema.org/draft/2020-12/schema",
      },
    },
  },
];

/** The draft-07 meta-schema, self-contained. */
export const META_DRAFT_07: Meta = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "http://json-schema.org/draft-07/schema#",
  "title": "Core schema meta-schema",
  "definitions": {
    "schemaArray": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#",
      },
    },
    "nonNegativeInteger": {
      "type": "integer",
      "minimum": 0,
    },
    "nonNegativeIntegerDefault0": {
      "allOf": [
        {
          "$ref": "#/definitions/nonNegativeInteger",
        },
        {
          "default": 0,
        },
      ],
    },
    "simpleTypes": {
      "enum": [
        "array",
        "boolean",
        "integer",
        "null",
        "number",
        "object",
        "string",
      ],
    },
    "stringArray": {
      "type": "array",
      "items": {
        "type": "string",
      },
      "uniqueItems": true,
      "default": [],
    },
  },
  "type": [
    "object",
    "boolean",
  ],
  "properties": {
    "$id": {
      "type": "string",
    },
    "$schema": {
      "type": "string",
    },
    "$ref": {
      "type": "string",
    },
    "$comment": {
      "type": "string",
    },
    "title": {
      "type": "string",
    },
    "description": {
      "type": "string",
    },
    "default": true,
    "readOnly": {
      "type": "boolean",
      "default": false,
    },
    "examples": {
      "type": "array",
      "items": true,
    },
    "multipleOf": {
      "type": "number",
      "exclusiveMinimum": 0,
    },
    "maximum": {
      "type": "number",
    },
    "exclusiveMaximum": {
      "type": "number",
    },
    "minimum": {
      "type": "number",
    },
    "exclusiveMinimum": {
      "type": "number",
    },
    "maxLength": {
      "$ref": "#/definitions/nonNegativeInteger",
    },
    "minLength": {
      "$ref": "#/definitions/nonNegativeIntegerDefault0",
    },
    "pattern": {
      "type": "string",
    },
    "additionalItems": {
      "$ref": "#",
    },
    "items": {
      "anyOf": [
        {
          "$ref": "#",
        },
        {
          "$ref": "#/definitions/schemaArray",
        },
      ],
      "default": true,
    },
    "maxItems": {
      "$ref": "#/definitions/nonNegativeInteger",
    },
    "minItems": {
      "$ref": "#/definitions/nonNegativeIntegerDefault0",
    },
    "uniqueItems": {
      "type": "boolean",
      "default": false,
    },
    "contains": {
      "$ref": "#",
    },
    "maxProperties": {
      "$ref": "#/definitions/nonNegativeInteger",
    },
    "minProperties": {
      "$ref": "#/definitions/nonNegativeIntegerDefault0",
    },
    "required": {
      "$ref": "#/definitions/stringArray",
    },
    "additionalProperties": {
      "$ref": "#",
    },
    "definitions": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#",
      },
      "default": {},
    },
    "properties": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#",
      },
      "default": {},
    },
    "patternProperties": {
      "type": "object",
      "additionalProperties": {
        "$ref": "#",
      },
      "propertyNames": {},
      "default": {},
    },
    "dependencies": {
      "type": "object",
      "additionalProperties": {
        "anyOf": [
          {
            "$ref": "#",
          },
          {
            "$ref": "#/definitions/stringArray",
          },
        ],
      },
    },
    "propertyNames": {
      "$ref": "#",
    },
    "const": true,
    "enum": {
      "type": "array",
      "items": true,
      "minItems": 1,
      "uniqueItems": true,
    },
    "type": {
      "anyOf": [
        {
          "$ref": "#/definitions/simpleTypes",
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/definitions/simpleTypes",
          },
          "minItems": 1,
          "uniqueItems": true,
        },
      ],
    },
    "format": {
      "type": "string",
    },
    "contentMediaType": {
      "type": "string",
    },
    "contentEncoding": {
      "type": "string",
    },
    "if": {
      "$ref": "#",
    },
    "then": {
      "$ref": "#",
    },
    "else": {
      "$ref": "#",
    },
    "allOf": {
      "$ref": "#/definitions/schemaArray",
    },
    "anyOf": {
      "$ref": "#/definitions/schemaArray",
    },
    "oneOf": {
      "$ref": "#/definitions/schemaArray",
    },
    "not": {
      "$ref": "#",
    },
  },
  "default": true,
};
