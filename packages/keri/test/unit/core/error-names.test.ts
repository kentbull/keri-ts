/**
 * Every exported error class names itself with a literal. A browser bundle cannot rely on `new.target.name`
 * (dnt rewrites it into a call that needs polyfills the browser entries do not load, so constructing any
 * `AppError` threw a TypeError) and a minifier mangles `constructor.name`.
 */
import { assertEquals } from "jsr:@std/assert";
import {
  ColdStartError,
  DeserializeError,
  GroupSizeError,
  ParserError,
  SemanticInterpretationError,
  SerializeError,
  ShortageError,
  SyntaxParseError,
  UnknownCodeError,
  VersionError,
  Vrsn_2_0,
  WireParseError,
} from "../../../../cesr/mod.ts";
import { RootRefused, RootUnverified } from "../../../src/acdc/salting.ts";
import { FailedSchemaValidationError, MissingSchemaError } from "../../../src/acdc/scheming.ts";
import { PeerVersionError } from "../../../src/app/delivery/forwarding.ts";
import { SignerNotHeldError } from "../../../src/app/identity/keeping.ts";
import { CesrHttpRefusal } from "../../../src/app/transport/cesr-egress.ts";
import { TransportError } from "../../../src/app/transport/transport-error.ts";
import {
  AppError,
  DatabaseError,
  DatabaseKeyError,
  DatabaseNotOpenError,
  DatabaseOperationError,
  InvalidPathNameError,
  PathError,
  PersistenceLatchedError,
  PersistenceReadError,
  ValidationError,
} from "../../../src/core/errors.ts";
import { UnsupportedTelReplayError } from "../../../src/db/replay/tel-replay.ts";
import { StoreLockHeldError, StoreLockUnsupportedError } from "../../../src/db/store-lock.ts";
import { OutputBarrierError } from "../../../src/runtime/web/output-barrier.ts";

const parser = () => new ParserError("parser");

/** One instance of each exported error class, with the name it must report. */
const errors: [string, () => Error][] = [
  ["ParserError", parser],
  ["WireParseError", () => new WireParseError(parser())],
  ["ShortageError", () => new ShortageError(2, 1)],
  ["ColdStartError", () => new ColdStartError("x")],
  ["VersionError", () => new VersionError("x")],
  ["UnknownCodeError", () => new UnknownCodeError("x")],
  ["GroupSizeError", () => new GroupSizeError("x")],
  ["DeserializeError", () => new DeserializeError("x")],
  ["SerializeError", () => new SerializeError("x")],
  ["SyntaxParseError", () => new SyntaxParseError("x")],
  ["SemanticInterpretationError", () => new SemanticInterpretationError("x")],
  ["AppError", () => new AppError("x")],
  ["ValidationError", () => new ValidationError("x")],
  ["PathError", () => new PathError("x")],
  ["InvalidPathNameError", () => new InvalidPathNameError("x")],
  ["DatabaseError", () => new DatabaseError("x")],
  ["DatabaseNotOpenError", () => new DatabaseNotOpenError("x")],
  ["DatabaseKeyError", () => new DatabaseKeyError("x")],
  ["DatabaseOperationError", () => new DatabaseOperationError("x")],
  ["PersistenceLatchedError", () => new PersistenceLatchedError("x")],
  ["PersistenceReadError", () => new PersistenceReadError("x")],
  ["CesrHttpRefusal", () => new CesrHttpRefusal("x", 400)],
  ["PeerVersionError", () => new PeerVersionError("x")],
  ["RootRefused", () => new RootRefused("x")],
  ["RootUnverified", () => new RootUnverified("x")],
  ["MissingSchemaError", () => new MissingSchemaError("ESchema")],
  ["FailedSchemaValidationError", () => new FailedSchemaValidationError("x")],
  ["OutputBarrierError", () => new OutputBarrierError("x")],
  ["StoreLockHeldError", () => new StoreLockHeldError("key", "name", "base")],
  ["StoreLockUnsupportedError", () => new StoreLockUnsupportedError()],
  ["UnsupportedTelReplayError", () => new UnsupportedTelReplayError("EPre", "ESaid", Vrsn_2_0, Vrsn_2_0)],
  ["TransportError", () => new TransportError("x")],
  ["SignerNotHeldError", () => new SignerNotHeldError("BKey")],
];

Deno.test("each exported error class reports its own name", () => {
  for (const [name, make] of errors) assertEquals(make().name, name);
});

Deno.test("an error's name does not depend on the class's own name, which a minifier mangles", () => {
  for (const [name, make] of errors) {
    const type = make().constructor;
    const original = Object.getOwnPropertyDescriptor(type, "name")!;
    Object.defineProperty(type, "name", { value: "a", configurable: true });
    try {
      assertEquals(make().name, name);
    } finally {
      Object.defineProperty(type, "name", original);
    }
  }
});
