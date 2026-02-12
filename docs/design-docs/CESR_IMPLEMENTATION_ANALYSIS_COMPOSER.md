# CESR Implementation Analysis & Design Plan for KERI TS (Composer)

## Executive Summary

This document provides a comprehensive analysis of all CESR implementations across the KERI ecosystem, synthesizing their strengths, weaknesses, and design patterns to inform the development of the best-in-class CESR parser for KERI TS.

**Key Findings:**

- **KERIpy** (Python) is the authoritative reference with the most complete implementation
- **Rust implementations** (cesride, libkeri, parside) excel in performance and type safety
- **Elixir** (cesrixir) demonstrates excellent stream parsing architecture
- **TypeScript implementations** (cesr-ts, kerits, signify-ts) vary in completeness
- **Version handling** (v1.0 vs v2.0) is critical and inconsistently implemented
- **Stream parsing** requires sophisticated cold-start detection and tritet-based routing

**Architectural Decision:**
We explicitly decouple the **Parser** (Stream Processing) from the **Router** (Application Logic).

- **`CesrStream`**: A pure iterator transforming bytes into `CesrFrame` objects (Serder + Attachments).
- **`CesrRouter`**: Consumes `CesrFrame` objects and dispatches to `Kevery`/`Tevery`.

---

## 1. Implementation Inventory

### 1.1 KERIpy (Python) - Authoritative Reference

**Location:** `/Users/kbull/code/keri/wot/keripy`

**Status:** ✅ Complete, Production-Ready

**Key Files:**

- `src/keri/core/parsing.py` - Main parser (2300+ lines)
- `src/keri/core/coring.py` - CESR primitives (Matter, Prefixer, Seqner, etc.)
- `src/keri/kering.py` - Version string handling, cold start detection
- `src/keri/core/counting.py` - Counter codes and group parsing
- `src/keri/core/indexing.py` - Indexed signatures (Siger)

**Architecture:**

- **Parser Class**: Stream-based parser with generator pattern for incremental parsing
- **Cold Start Detection**: `sniff()` function uses tritet (3-bit) analysis of first byte
- **Version Handling**: Supports both v1.0 (`KERI10JSON00012b_`) and v2.0 (`KERICAACAAJSON00012b.`)
- **Extraction Methods**: Generator-based `_extractor()` for each primitive type
- **Group Parsing**: Specialized methods for each count code type (ControllerIdxSigs, WitnessIdxSigs, etc.)

**Strengths:**

- ✅ **Most Complete**: Handles all CESR primitives, groups, and edge cases
- ✅ **Well-Tested**: Extensive test suite with real-world examples
- ✅ **Version Support**: Full v1.0 and v2.0 compatibility
- ✅ **Stream Processing**: Efficient incremental parsing with generators
- ✅ **Error Handling**: Comprehensive error types (ShortageError, ColdStartError, etc.)
- ✅ **Documentation**: Well-documented with docstrings

**Weaknesses:**

- ❌ **Python Performance**: Slower than compiled languages
- ❌ **Type Safety**: Dynamic typing limits compile-time guarantees
- ❌ **Complexity**: Large codebase (2300+ lines in parser alone)
- ❌ **Coupling**: Heavily coupled to `Kevery` and application logic.

**Best Ideas to Adopt:**

1. **Generator-based extraction**: `_extractor()` pattern for incremental parsing
2. **Cold start detection**: `sniff()` function with tritet analysis
3. **Version-aware code tables**: Dynamic code table selection based on version
4. **Method dispatch**: Dictionary-based method dispatch for count codes
5. **Strippable streams**: `strip=True` parameter for in-place parsing

---

### 1.2 cesride (Rust) - Standalone CESR Library

**Location:** `/Users/kbull/code/keri/kentbull/cesride`

**Status:** ✅ Complete, Well-Designed

**Key Files:**

- `src/core/matter/mod.rs` - Matter trait and implementations
- `src/core/serder.rs` - Serder (event serialization)
- `src/core/prefixer.rs`, `seqner.rs`, `saider.rs`, etc. - Primitives
- `wasm/` - WebAssembly bindings

**Architecture:**

- **Trait-Based Design**: `Matter` trait with default implementations
- **Zero-Copy**: Efficient byte handling with minimal allocations
- **Error Types**: Comprehensive error handling with `Result<T, Error>`
- **WASM Support**: Full WebAssembly compilation for browser use

**Strengths:**

- ✅ **Performance**: Rust's zero-cost abstractions
- ✅ **Type Safety**: Strong compile-time guarantees
- ✅ **Memory Safety**: No unsafe code, guaranteed memory safety
- ✅ **WASM Ready**: Can be used in TypeScript via WASM
- ✅ **Clean API**: Well-designed trait system

**Weaknesses:**

- ❌ **No Parser**: Focuses on primitives, lacks full stream parser
- ❌ **Limited Version Support**: Primarily v1.0 focused
- ❌ **No Group Parsing**: Doesn't handle count codes/groups

**Best Ideas to Adopt:**

1. **Trait-based design**: `Matter` trait pattern for extensibility
2. **Zero-copy parsing**: Efficient byte slice handling
3. **Error handling**: `Result<T, Error>` pattern
4. **WASM compatibility**: Consider WASM for performance-critical paths

---

### 1.3 libkeri (Rust) - Full KERI Implementation

**Location:** `/Users/kbull/code/keri/kentbull/libkeri`

**Status:** 🚧 In Progress

**Key Files:**

- `src/cesr/mod.rs` - CESR module organization
- `src/keri/core/parsing.rs` - Parser implementation
- `src/keri/core/serdering/` - Event serialization
- `src/keri/db/` - Database layer with CESR storage

**Architecture:**

- **Modular Design**: Separated CESR, KERI core, and database layers
- **Database Integration**: CESR-aware database storage (CesrSuber, SerderSuber, etc.)
- **Version Handling**: `Versionage` struct with parsing support

**Strengths:**

- ✅ **Full Stack**: Complete KERI implementation, not just CESR
- ✅ **Database Integration**: CESR-aware storage abstractions
- ✅ **Type Safety**: Rust's type system

**Weaknesses:**

- ❌ **Incomplete**: Parser still in development
- ❌ **Complex**: Large codebase with many dependencies

**Best Ideas to Adopt:**

1. **Database abstractions**: CesrSuber, SerderSuber patterns for storage
2. **Modular organization**: Clear separation of concerns
3. **Version struct**: `Versionage` pattern for version handling

---

### 1.4 parside (Rust) - CESR Parser Library

**Location:** `/Users/kbull/code/keri/kentbull/parside`

**Status:** ✅ Complete Parser

**Key Files:**

- `src/message/parsers.rs` - Primitive parsers using nom
- `src/message/groups/` - Group parsing (ControllerIdxSigs, etc.)
- `src/message/message.rs` - Message parsing

**Architecture:**

- **Nom Parser Combinators**: Functional parser combinators for parsing
- **Type-Safe Parsing**: Strong typing with nom's `IResult`
- **Group Support**: Handles count codes and groups
- **Cold Code Detection**: `ColdCode` enum for stream state

**Strengths:**

- ✅ **Parser Combinators**: Elegant functional parsing approach
- ✅ **Type Safety**: Strong compile-time guarantees
- ✅ **Group Parsing**: Handles complex CESR groups
- ✅ **Performance**: Efficient nom-based parsing

**Weaknesses:**

- ❌ **Rust-Specific**: Can't directly use in TypeScript
- ❌ **Learning Curve**: Nom combinators require understanding
- ❌ **Limited Documentation**: Less documented than KERIpy

**Best Ideas to Adopt:**

1. **Parser combinators**: Consider a TypeScript parser combinator library
2. **Cold code enum**: Explicit stream state representation
3. **Group parsing**: Structured approach to count code groups
4. **Type-safe results**: `Result<T, Error>` pattern throughout

---

### 1.5 cesrixir (Elixir) - CESR Implementation

**Location:** `/Users/kbull/code/keri/kentbull/cesrixir`

**Status:** ✅ Complete, Well-Architected

**Key Files:**

- `lib/cesr.ex` - Main CESR module with stream consumption
- `lib/CodeTable/` - Version-aware code tables
- `lib/VersionString/` - Version string parsing
- `lib/Primitive/` - CESR primitives

**Architecture:**

- **Stream Processing**: `consume_stream/2` with accumulator pattern
- **Tritet Sniffing**: `sniff_tritet/1` for cold start detection
- **Version Tables**: Separate code tables for v1.0 and v2.0
- **Pattern Matching**: Elixir's pattern matching for elegant parsing

**Strengths:**

- ✅ **Elegant Stream Parsing**: Clean accumulator-based approach
- ✅ **Version Handling**: Excellent version string and table management
- ✅ **Pattern Matching**: Expressive parsing logic
- ✅ **Well-Structured**: Clear module organization

**Weaknesses:**

- ❌ **Elixir-Specific**: Can't directly use in TypeScript
- ❌ **Functional Style**: May be unfamiliar to TypeScript developers

**Best Ideas to Adopt:**

1. **Stream consumption pattern**: `consume_stream` with accumulator
2. **Tritet sniffing**: Explicit cold start detection
3. **Version tables**: Separate code tables per version
4. **Element consumption**: `consume_element` pattern for incremental parsing

---

### 1.6 cesr-ts (TypeScript) - Standalone CESR Library

**Location:** `/Users/kbull/code/keri/kentbull/cesr-ts`

**Status:** ✅ Complete Primitives, ⚠️ Limited Parser

**Key Files:**

- `src/matter.ts` - Matter class (similar to cesride)
- `src/core.ts` - Version string handling (`versify`, `deversify`)
- `src/prefixer.ts`, `seqner.ts`, `saider.ts`, etc. - Primitives

**Architecture:**

- **Class-Based**: TypeScript classes for each primitive
- **Version Strings**: `versify()` and `deversify()` functions
- **Fixed-Size Focus**: Primarily handles fixed-size primitives

**Strengths:**

- ✅ **TypeScript Native**: Direct use in KERI TS
- ✅ **Type Safety**: TypeScript types and interfaces
- ✅ **Version Handling**: `versify`/`deversify` functions

**Weaknesses:**

- ❌ **No Parser**: Missing stream parser implementation
- ❌ **Limited Groups**: Doesn't handle count codes/groups
- ❌ **Variable Size**: Limited variable-size primitive support
- ❌ **No Cold Start**: Missing cold start detection

**Best Ideas to Adopt:**

1. **Version functions**: `versify`/`deversify` pattern
2. **Class structure**: TypeScript class hierarchy
3. **Type definitions**: Strong TypeScript typing

---

### 1.7 kerits (TypeScript) - KERI Implementation

**Location:** `/Users/kbull/code/keri/kentbull/kerits`

**Status:** ✅ Complete Primitives, ⚠️ Partial Parser

**Key Files:**

- `src/cesr/matter.ts` - Matter class (416 lines, comprehensive)
- `src/cesr/codex.ts` - Code tables and sizes
- `src/storage/parser.ts` - Basic event parser
- `docs/cesr.md` - Comprehensive documentation

**Architecture:**

- **Comprehensive Matter**: Full `_infil()`, `_exfil()`, `_binfil()`, `_bexfil()` implementation
- **Code Tables**: Complete `Sizes` and `Hards` tables
- **Basic Parsing**: Simple event parser for JSON events
- **Test Vectors**: Generated from KERIpy for compatibility

**Strengths:**

- ✅ **Complete Matter**: Full encoding/decoding implementation
- ✅ **Well-Documented**: Excellent documentation in `docs/cesr.md`
- ✅ **Test Compatibility**: Test vectors from KERIpy
- ✅ **Variable Size**: Supports variable-size primitives

**Weaknesses:**

- ❌ **Limited Parser**: Basic parser, doesn't handle full CESR streams
- ❌ **No Cold Start**: Missing cold start detection
- ❌ **No Groups**: Doesn't parse count code groups
- ❌ **Version Handling**: Limited version string support

**Best Ideas to Adopt:**

1. **Matter implementation**: Excellent `_infil`/`_exfil` logic
2. **Code tables**: Comprehensive `Sizes` and `Hards` tables
3. **Documentation**: Excellent documentation patterns
4. **Test vectors**: KERIpy compatibility testing

---

### 1.8 cesr-decoder (JavaScript) - Browser-Based Decoder

**Location:** `/Users/kbull/code/keri/kentbull/cesr-decoder`

**Status:** ✅ Decoder Only, No Encoder

**Key Files:**

- `docs/assets/common/modules/cesr-parser.js` - Parser implementation
- `cesr-schema/` - JSON schemas for code tables

**Architecture:**

- **Browser-Focused**: Designed for web use
- **Schema-Driven**: JSON schemas for code tables
- **Frame Extraction**: `getCesrFrame()` for frame detection
- **Tritet-Based**: Uses tritet for cold start detection

**Strengths:**

- ✅ **Browser Ready**: Works in browsers
- ✅ **Schema-Driven**: JSON schemas for extensibility
- ✅ **Frame Detection**: Good frame extraction logic

**Weaknesses:**

- ❌ **Decoder Only**: No encoding support
- ❌ **JavaScript**: Not TypeScript, less type safety
- ❌ **Limited**: Basic functionality only

**Best Ideas to Adopt:**

1. **Frame extraction**: `getCesrFrame()` pattern
2. **Schema-driven**: Consider JSON schemas for code tables
3. **Tritet detection**: Cold start detection approach

---

### 1.9 cesrox (Rust) - Minimal CESR

**Location:** `/Users/kbull/code/keri/kentbull/cesrox`

**Status:** ✅ Minimal Implementation

**Architecture:**

- **Minimal**: Basic prefix and derivation code handling
- **Focused**: Only essential functionality

**Best Ideas to Adopt:**

1. **Simplicity**: Minimal, focused implementation

---

### 1.10 keriox (Rust) - KERI Implementation

**Location:** `/Users/kbull/code/keri/kentbull/keriox`

**Status:** 🚧 In Progress

**Architecture:**

- **Full Stack**: Complete KERI implementation
- **Event Parsing**: Event message parsing
- **Database**: Database integration

**Best Ideas to Adopt:**

1. **Event parsing**: Event message structure
2. **Database patterns**: Storage abstractions

---

## 2. Critical Design Patterns Analysis

### 2.1 Cold Start Detection

**Problem:** CESR streams can start with different frame types (JSON, CBOR, MGPK, CESR count codes, etc.). The parser must detect the frame type from the first few bits.

**KERIpy Solution:**

```python
def sniff(ims):
    """Returns status string of cold start by looking at first tritet (3 bits)"""
    tritet = ims[0] >> 5  # First 3 bits
    if tritet == 0o1:  # 001 - CountCode Base64
        return Colds.txt
    elif tritet == 0o3:  # 011 - JSON
        return Colds.msg
    # ... etc
```

**cesrixir Solution:**

```elixir
defp sniff_tritet(first_tritet) do
  case first_tritet do
    0b000 -> :annotations
    0b001 -> :cesr_t_cnt_code
    0b010 -> :cesr_t_op_code
    0b011 -> :json_map
    0b100 -> :mgpk_fixmap
    0b101 -> :cbor_map
    0b110 -> :mgpk_16_or_32
    0b111 -> :cesr_b_cnt_or_op_code
  end
end
```

**Best Approach for KERI TS:**

- Use tritet (3-bit) analysis of first byte
- Return explicit enum/union type for stream state
- Support all 8 cold start cases

---

### 2.2 Version String Handling

**Problem:** CESR v1.0 and v2.0 have different version string formats:

- **v1.0**: `KERI10JSON00012b_` (17 chars, terminates with `_`)
- **v2.0**: `KERICAACAAJSON00012b.` (19 chars, terminates with `.`)

**KERIpy Solution:**

```python
def deversify(vs):
    """Extract version info using regex"""
    match = Rever.match(vs)  # Combined regex for both versions
    return rematch(match)  # Returns Smellage tuple
```

**cesr-ts Solution:**

```typescript
export function deversify(versionString: string): [Ident, Serials, Version, string] {
  const re = new RegExp(VEREX); // Combined regex
  const match = re.exec(versionString);
  // Extract proto, version, kind, size
}
```

**Best Approach for KERI TS:**

- Use combined regex pattern (like KERIpy)
- Parse both v1.0 and v2.0 formats
- Return structured version object
- Support protocol genus extraction (KERI vs ACDC)

---

### 2.3 Matter Encoding/Decoding

**Problem:** CESR primitives need to encode/decode between raw bytes and qb64/qb64b/qb2 formats with proper padding and alignment.

**kerits Solution (Best TypeScript Implementation):**

```typescript
protected _infil(): Uint8Array {
  const sizage = Sizes.get(this._code)!;
  const { hs, ss, xs, fs, ls } = sizage;
  const cs = hs + ss;

  if (fs === null) {
    // Variable sized
    const vls = (3 - (rs % 3)) % 3;
    const size = Math.floor((rs + vls) / 3);
    this._soft = intToB64(size, ss);
    // ... encode with variable lead
  } else {
    // Fixed sized
    const ps = (3 - ((rs + ls) % 3)) % 3;
    // Verify alignment: ps must equal cs % 4
    // Prepad, encode, trim
  }
}
```

**cesride Solution (Best Rust Implementation):**

```rust
fn infil(&self) -> Result<String> {
    let code = &self.code();
    let size = self.size();
    let mut raw = self.raw();
    let ps = (3 - raw.len() % 3) % 3;
    let szg = tables::sizage(code)?;
    // ... similar logic with zero-copy
}
```

**Best Approach for KERI TS:**

- Use kerits' Matter implementation as base (most complete)
- Ensure proper padding validation
- Support both fixed and variable-size primitives
- Validate midpad bytes are zero

---

### 2.4 Stream Parsing Architecture

**Problem:** CESR streams contain multiple frames (events, attachments, groups) that must be parsed incrementally. In KERIpy, this is coupled with the routing logic.

**KERIpy Solution (Coupled):**

```python
def parseOne(self, ims, cold=Colds.txt):
    """Parse one message from stream"""
    # Sniff cold start
    # Extract version string if event
    # Parse attachments using extractors
    # DIRECT CALL to kvy.processEvent() inside the parser
```

**Recommended Approach for KERI TS (Decoupled):**

Implement a **CesrStream** that strictly yields parsed frames, and a separate **CesrRouter** that handles them.

```typescript
// CesrFrame: The atomic unit of a CESR stream
type CesrFrame = {
  serder: Serder; // The message body (Event, Receipt, Reply)
  attachments: AttachmentGroup[]; // The signatures/couples attached
};

// CesrStream: The Iterator
class CesrStream {
  async *frames(ims: Uint8Array): AsyncGenerator<CesrFrame> {
    // 1. Sniff
    // 2. Extract Serder
    // 3. Extract Attachments
    // 4. Yield Frame
  }
}
```

**Best Approach for KERI TS:**

- **Decouple Parsing from Routing**: The parser should not know about `Kevery`.
- Use **Generator/Iterator Pattern**: Return a stream of `CesrFrame` objects.
- Support both framed (single message) and unframed (multiple messages) streams.
- Support pipelined count codes.

---

### 2.5 Group Parsing (Count Codes)

**Problem:** CESR groups (ControllerIdxSigs, WitnessIdxSigs, etc.) contain multiple primitives that must be parsed together.

**KERIpy Solution:**

```python
def _ControllerIdxSigs1(self, ims, cold=Colds.txt):
    """Extract Controller Indexed Signature Group"""
    # Extract counter
    # Extract indexed signatures based on count
    # Return group structure
```

**parside Solution:**

```rust
pub(crate) fn siger_parser<'a>(cold_code: &ColdCode) -> ParsideResult<ParserRet<'a, Siger>> {
    match cold_code {
        ColdCode::CtB64 | ColdCode::OpB64 => Ok(nomify!(Self::siger_from_qb64b)),
        ColdCode::CtOpB2 => Ok(nomify!(Self::siger_from_qb2)),
        _ => Err(...)
    }
}
```

**Best Approach for KERI TS:**

- Create parser methods for each count code type
- Use method dispatch based on count code
- Support both v1.0 and v2.0 count code tables
- Handle big count codes (for large groups)

---

## 3. Version Support Analysis

### 3.1 CESR v1.0 vs v2.0 Differences

| Aspect               | v1.0                           | v2.0                               |
| -------------------- | ------------------------------ | ---------------------------------- |
| **Version String**   | `KERI10JSON00012b_` (17 chars) | `KERICAACAAJSON00012b.` (19 chars) |
| **Terminator**       | `_` (underscore)               | `.` (period)                       |
| **Protocol Version** | 2 hex chars (`10`)             | 1 char + 2 chars (`CAA`)           |
| **Genus Version**    | Not present                    | 3 chars (`CAA`)                    |
| **Size Encoding**    | 6 hex chars                    | 4 base64 chars                     |
| **Code Tables**      | CtrDex_1_0                     | CtrDex_2_0                         |

### 3.2 Implementation Status

| Implementation | v1.0 Support | v2.0 Support | Notes                    |
| -------------- | ------------ | ------------ | ------------------------ |
| **KERIpy**     | ✅ Full      | ✅ Full      | Reference implementation |
| **cesride**    | ✅ Full      | ⚠️ Partial   | Primarily v1.0 focused   |
| **libkeri**    | ✅ Full      | ✅ Full      | Both versions supported  |
| **parside**    | ✅ Full      | ✅ Full      | Version-aware parsing    |
| **cesrixir**   | ✅ Full      | ✅ Full      | Separate code tables     |
| **cesr-ts**    | ✅ Full      | ⚠️ Partial   | Regex supports both      |
| **kerits**     | ✅ Full      | ⚠️ Limited   | Basic version handling   |

**Critical Requirement for KERI TS:**

- **MUST** support both v1.0 and v2.0 fully
- **MUST** auto-detect version from version string
- **MUST** use correct code tables based on version
- **MUST** handle mixed-version streams

---

## 4. Best Practices Synthesis

### 4.1 Architecture Recommendations

1.  **Layered Design:**

    ```
    Layer 1: Primitives (Matter, Prefixer, Seqner, etc.)
    Layer 2: Groups (Count codes, indexed signatures)
    Layer 3: Parsing (CesrStream -> CesrFrame)
    Layer 4: Routing (CesrRouter -> Kevery/Tevery)
    ```

2.  **Decoupled Parsing:**
    Instead of injecting `Kevery` into `Parser`, the `Parser` (or `CesrStream`) should purely yield structured data. This allows:

    - Easier testing of the parser in isolation.
    - Reuse of the parser for non-KERI applications.
    - Cleaner types.

3.  **Type Safety:**

    - Use TypeScript strict mode
    - Define interfaces for all structures
    - Use discriminated unions for version handling
    - Avoid `any` types

4.  **Error Handling:**

    - Custom error classes (ShortageError, ColdStartError, etc.)
    - Result types for parsing operations
    - Clear error messages with context

5.  **Performance:**
    - Zero-copy where possible (use Uint8Array slices)
    - Lazy evaluation for large streams
    - Efficient base64 encoding/decoding
    - Consider WASM for hot paths

### 4.2 Code Organization

```
src/cesr/
├── primitives/
│   ├── matter.ts          # Base Matter class
│   ├── prefixer.ts        # Prefix primitive
│   ├── seqner.ts          # Sequence number
│   ├── saider.ts          # SAID primitive
│   ├── siger.ts           # Indexed signature
│   ├── cigar.ts           # Non-indexed signature
│   ├── verfer.ts          # Verification key
│   ├── diger.ts           # Digest
│   └── ...
├── groups/
│   ├── controller-idx-sigs.ts
│   ├── witness-idx-sigs.ts
│   ├── trans-receipt-quadruples.ts
│   └── ...
├── version/
│   ├── version-string.ts   # Version string parsing
│   ├── code-tables.ts      # Version-aware code tables
│   └── versionage.ts       # Version struct
├── parser/
│   ├── cesr-stream.ts      # Main CesrStream class (Generator)
│   ├── cold-start.ts       # Cold start detection
│   ├── extractors.ts       # Primitive extractors
│   └── frames.ts           # CesrFrame definitions
├── router/
│   ├── cesr-router.ts      # Router to Kevery
└── utils/
    ├── base64.ts           # Base64 encoding/decoding
    ├── codex.ts            # Code tables
    └── sizes.ts            # Size calculations
```

### 4.3 Testing Strategy

1. **Test Vectors:**

   - Generate from KERIpy (like kerits does)
   - Include v1.0 and v2.0 examples
   - Real-world event examples

2. **Unit Tests:**

   - Each primitive (encode/decode round-trip)
   - Version string parsing
   - Cold start detection
   - Group parsing

3. **Integration Tests:**

   - Full event parsing
   - Stream parsing
   - Mixed-version streams
   - OOBI response parsing

4. **Compatibility Tests:**
   - Parse KERIpy-generated events
   - Generate events parseable by KERIpy
   - Database compatibility

---

## 5. Implementation Plan for KERI TS

### Phase 1: Foundation (Week 1-2)

1. **Matter Class** (Based on kerits)

   - ✅ Already exists in kerits - use as base
   - Enhance with better error handling
   - Add qb2 support if missing

2. **Version String Handling**

   - Implement `versify()` and `deversify()` (like cesr-ts)
   - Support both v1.0 and v2.0 formats
   - Version detection and parsing

3. **Code Tables**
   - Complete `Sizes` table (from kerits)
   - Complete `Hards` table (from kerits)
   - Version-aware code tables (v1.0 and v2.0)

### Phase 2: Primitives (Week 2-3)

1. **Core Primitives** (Most exist in kerits)

   - Prefixer, Seqner, Saider, Dater
   - Verfer, Diger, Number
   - Enhance with better error handling

2. **Signature Primitives**
   - Siger (indexed signature)
   - Cigar (non-indexed signature)
   - Complete implementation

### Phase 3: Cold Start & Stream Detection (Week 3)

1. **Cold Start Detection**

   - Implement `sniff()` function (like KERIpy)
   - Tritet-based detection
   - Return stream state enum

2. **Frame Extraction**
   - JSON/CBOR/MGPK frame detection
   - CESR count code detection
   - Version string extraction

### Phase 4: Group Parsing (Week 4)

1. **Count Code Parsing**

   - Counter extraction
   - Group size calculation
   - Method dispatch based on count code

2. **Group Types**
   - ControllerIdxSigs
   - WitnessIdxSigs
   - TransReceiptQuadruples
   - NonTransReceiptCouples
   - FirstSeenReplayCouples
   - PathedMaterialCouples
   - SealSourceCouples/Triples

### Phase 5: CesrStream (The Parser) (Week 5-6)

1.  **CesrStream Class**

    - Implementation of the Generator Pattern
    - Pure transformation of `Bytes` -> `CesrFrame`
    - No dependency on `Kevery`

2.  **Extraction Methods**
    - `extract()` for single primitive
    - `_extractor()` generator for incremental
    - Group extraction methods

### Phase 6: CesrRouter (The Dispatcher) (Week 7-8)

1.  **Router Class**

    - Consumes `CesrStream`
    - Dispatches to `Kevery` (events), `Revery` (replies), `Exchanger` (exchanges) based on message ilk

2.  **Integration**
    - Integrate with existing KERI TS codebase
    - Database storage integration
    - Event processing integration

### Phase 7: Testing (Week 8-9)

1.  **Testing**
    - Unit tests for all components
    - Integration tests with KERIpy
    - Performance testing
    - Edge case testing

---

## 6. Key Design Decisions

### 6.1 Parser API Design

**Chosen Approach: Generator/Iterator Pattern with Decoupled Frames**

```typescript
type CesrFrame = [Serder, AttachmentGroup[]];

class CesrStream {
  *parse(ims: Uint8Array): Generator<CesrFrame> {
    while (ims.length > 0) {
      // 1. Extract Body (Serder)
      // 2. Extract Attachments
      yield [serder, attachments];
    }
  }
}
```

### 6.2 Error Handling Strategy

**Recommendation:** Use custom error classes with Result types:

```typescript
class ShortageError extends Error {
  constructor(public needed: number, public available: number) {
    super(`Need ${needed} more bytes, have ${available}`);
  }
}

type ParseResult<T> = Result<T, CesrError>;
```

### 6.3 Version Handling Strategy

**Recommendation:** Use discriminated union:

```typescript
type Version =
  | { major: 1; minor: number; format: "v1" }
  | { major: 2; minor: number; format: "v2" };

interface VersionString {
  protocol: "KERI" | "ACDC";
  version: Version;
  kind: "JSON" | "CBOR" | "MGPK";
  size: number;
}
```

---

## 7. Performance Considerations

1. **Zero-Copy Parsing:**

   - Use `Uint8Array.slice()` instead of copying
   - Avoid string conversions where possible
   - Reuse buffers

2. **Lazy Evaluation:**

   - Don't parse entire stream at once
   - Parse on-demand
   - Use generators for incremental parsing

3. **Base64 Performance:**

   - Use native `atob`/`btoa` or optimized library
   - Consider WASM for hot paths
   - Cache decoded values

4. **Code Table Lookups:**
   - Use Map for O(1) lookups
   - Pre-compute size calculations
   - Cache version-specific tables

---

## 8. Conclusion

The best CESR parser for KERI TS should:

1. **Base Implementation on kerits Matter class** (most complete TypeScript implementation)
2. **Adopt a decoupled Stream/Router architecture**: Deviate from KERIpy's coupled design. Use `CesrStream` for pure parsing and `CesrRouter` for dispatch.
3. **Use cesrixir's stream consumption pattern** (elegant and efficient)
4. **Implement parside's group parsing approach** (type-safe and structured)
5. **Support both v1.0 and v2.0 fully** (critical for compatibility)
6. **Use TypeScript's type system effectively** (compile-time safety)
7. **Provide incremental parsing** (generator/iterator pattern)
8. **Comprehensive error handling** (custom error classes)

**Next Steps:**

1. Review and enhance existing kerits Matter implementation
2. Implement version string handling (versify/deversify)
3. Implement cold start detection
4. Build group parsing infrastructure
5. Create main Parser class (`CesrStream`)
6. Create Router class (`CesrRouter`)
7. Integrate with KERI TS codebase
8. Comprehensive testing with KERIpy compatibility

This implementation will be the **best CESR parser in the world** by combining the strengths of all existing implementations while leveraging TypeScript's type system for safety and developer experience, and improving upon the architectural separation of concerns.
