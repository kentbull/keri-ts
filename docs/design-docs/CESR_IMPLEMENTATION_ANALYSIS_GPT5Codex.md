# CESR Implementation Analysis (GPT-5 Codex)

## Overview
This report surveys every CESR-capable codebase in the local workspace, anchors the analysis in the ToIP CESR draft specification, and distills concrete guidance for delivering a world-class TypeScript CESR parser inside `keri-ts`. It complements the existing `KLI_INIT_IMPLEMENTATION_PLAN.md` by mapping the mature KERIpy reference design to modern TypeScript practices while harvesting proven ideas from Rust, Elixir, JavaScript, and earlier TypeScript efforts.

## Source Material
- KERI TS roadmap: `docs/design-docs/KLI_INIT_IMPLEMENTATION_PLAN.md` for dependency sequencing and parser prerequisites.  
- Reference implementation: `keripy` (Python) as the functional gold standard for CESR parsing, serialization, and attachment handling.  
- Cross-language insights: `libkeri`, `kerits`, `cesr-ts`, `cesr-decoder`, `cesride`, `cesrixir`, `cesrox`, `keriox`, and `parside`, plus the `tswg-cesr-specification` repository for normative definitions.

## Implementation Snapshots

### KERIpy (Python)
**Scope:** Production-grade parser, serializer, and verifier covering KERI, TEL, EXN, and ACDC message families with full attachment routing.  
**Strengths:** Generator-driven streaming parser, precomputed counter→method dispatch tables, rigorous version gating, and exhaustive attachment support that downstream components (Kevery/Revery) rely on.  
**Weaknesses:** Heavy Python dynamism hampers static safety, and the monolithic class makes selective reuse difficult; performance-sensitive paths require porting.  
**Ideas to Adopt:** Mirror the counter-method lookup approach, preserve generator-style shortfall handling, and retain strict version-table validation to match KERIpy’s compatibility guarantees.

```30:108:keripy/src/keri/core/parsing.py
class Parser:
    """Parser is stream parser that processes an incoming message stream.
    """
    Methods = copy.deepcopy(Counter.Codes)
    for minor in Methods.values():
        for key in minor:
            minor[key] = {key: None for key in asdict(minor[key])}
    Methods[1][0][Codens.ControllerIdxSigs] = "_ControllerIdxSigs1"
    Methods[2][0][Codens.ControllerIdxSigs] = "_ControllerIdxSigs2"
    Methods[2][0][Codens.BigControllerIdxSigs] = "_ControllerIdxSigs2"
```

### libkeri (Rust)
**Scope:** Rust port of KERI with C ABI exposure, focused on parity with KERIpy naming and behaviour.  
**Strengths:** Stateless helpers for sniffing cold-start tritets, strict `Versionage` parsing and validation, and strongly typed CESR primitives ready for FFI reuse.  
**Weaknesses:** Still incomplete (Kevery integration, parser orchestration) and leans on heavy dependencies when targeting embedded or browser contexts.  
**Ideas to Adopt:** Reuse the minimal `sniff` and `Versionage` ergonomics to keep TypeScript validation concise while preserving precise error semantics.

```289:317:libkeri/src/cesr/mod.rs
pub fn sniff(ims: &[u8]) -> Result<&'static str, MatterError> {
    if ims.is_empty() {
        return Err(MatterError::ShortageError("Need more bytes.".to_string()));
    }
    let tritet = ims[0] >> 5;
    if tritet == cold_dex::JSON
        || tritet == cold_dex::MGPK1
        || tritet == cold_dex::CBOR
        || tritet == cold_dex::MGPK2
    {
        return Ok(COLDS.msg);
    }
    if tritet == cold_dex::CTB64 || tritet == cold_dex::OPB64 {
        return Ok(COLDS.txt);
    }
    if tritet == cold_dex::CTOPB2 {
        return Ok(COLDS.bny);
    }
    if tritet == cold_dex::ANB64 {
        return Ok(COLDS.ano);
    }
    Err(MatterError::ColdStartError(format!(
        "Unexpected tritet={} at stream start.",
        tritet
    )))
}
```

### kerits (TypeScript)
**Scope:** Broad TypeScript rewrite of KERI primitives, storage, and CLI that already targets Bun runtimes.  
**Strengths:** Modern utilities for URL-safe Base64, binary domain conversions, and runtime guards that enforce CESR alignment invariants (e.g., pad/lead checks in `Matter._infil`).  
**Weaknesses:** Parser pipeline is unfinished, and the project currently mixes application concerns with low-level primitives, complicating extraction for `keri-ts`.  
**Ideas to Adopt:** Lift the `Matter` implementation—including its alignment assertions and typed utility layer—to seed the `keri-ts` core CESR library.

```172:208:kerits/src/cesr/matter.ts
protected _infil(): Uint8Array {
  const sizage = Sizes.get(this._code)!;
  const { hs, ss, xs, fs, ls } = sizage;
  const cs = hs + ss;
  const both = this.both;
  const rs = this._raw.length;
  if (fs === null) {
    const vls = (3 - (rs % 3)) % 3;
    const size = Math.floor((rs + vls) / 3);
    this._soft = intToB64(size, ss);
    const code = this._code + this._soft;
    const prepadded = concatBytes(new Uint8Array(vls), this._raw);
    const encoded = encodeB64(prepadded);
    return textToBytes(code + encoded);
  } else {
    const ps = (3 - ((rs + ls) % 3)) % 3;
    if (ps !== (cs % 4)) {
      throw new Error(
        `Misaligned code: ps=${ps} != cs%4=${cs % 4} for code ${this._code}`
      );
    }
    const prepadded = concatBytes(new Uint8Array(ps + ls), this._raw);
    const encoded = encodeB64(prepadded);
    const trimmed = encoded.slice(ps);
    return textToBytes(both + trimmed);
  }
}
```

### cesr-ts (TypeScript)
**Scope:** Earlier pure TypeScript port of CESR primitives that mirrors Python logic closely.  
**Strengths:** Straightforward translation with exhaustive code tables that cover fixed-size primitives; useful as a regression oracle when rewriting logic.  
**Weaknesses:** Relies on Node’s `Buffer`, lacks strict alignment checks, and does not account for CESR v2 code tables.  
**Ideas to Adopt:** Use as a reference for test fixtures and code-table coverage, but modernize the runtime away from Node-specific APIs.

```1:42:cesr-ts/src/matter.ts
import { EmptyMaterialError } from './kering';
import { intToB64, readInt } from './core';
import { b, d } from './core';
import { Buffer } from 'buffer';

export class Codex {
    has(prop: string): boolean {
        const m = new Map(
            Array.from(Object.entries(this), (v) => [v[1], v[0]])
        );
        return m.has(prop);
    }
}
```

### cesr-decoder (JavaScript)
**Scope:** Browser-based CESR visualization tool with auto-generated tables from KERIpy.  
**Strengths:** Implements ColdDex tritet sniffing and CountCode parsing in plain JS, providing rapid feedback for mixed JSON/CESR streams and teaching aids.  
**Weaknesses:** Focused on visualization rather than embeddable parsing, and many TODO paths (binary frames, grouped seals) remain unimplemented.  
**Ideas to Adopt:** Incorporate its interactive test vectors into TypeScript integration tests and reuse its clean separation between protocol tables and parsing logic.

```151:170:cesr-decoder/docs/assets/common/modules/cesr-parser.js
export function getCesrFrame(protocol, input) {
  if ("string" === typeof input) {
    input = Utf8.encode(input);
  } else if (input instanceof Uint8Array) {
    // nothing
  } else {
    throw new TypeError(`expected input "string" or "Uint8Array"`);
  }
  const tritet = input[0] >> 5;
  switch (tritet) {
    case ColdDex.CtB64:
      return getTextFrame(protocol, input);
    case ColdDex.JSON:
      return getJsonFrame(input);
    default:
      throw new UnknownCodeError(`getCesrFrame`, input[0]);
  }
}
```

### cesride (Rust)
**Scope:** High-performance Rust library delivering CESR primitives, signing support, and WASM bindings.  
**Strengths:** Table-driven sizage lookup, exhaustive codex definitions, and support for multiple digest/signature algorithms tuned for different security tiers.  
**Weaknesses:** Focused on primitives rather than full parser orchestration, and some components (e.g., streaming abstractions) remain TODOs.  
**Ideas to Adopt:** Use its table-driven approach for code/size metadata and emulate the tier-aware hashing/signing abstraction in the TypeScript cryptographic facade.

```1:69:cesride/src/core/matter/tables.rs
pub(crate) const SMALL_VRZ_DEX: [char; 3] = ['4', '5', '6'];
pub(crate) const LARGE_VRZ_DEX: [char; 3] = ['7', '8', '9'];
#[derive(Debug, PartialEq)]
pub(crate) struct Sizage {
    pub hs: u32,
    pub ss: u32,
    pub ls: u32,
    pub fs: u32,
}
pub(crate) fn sizage(s: &str) -> Result<Sizage> {
    Ok(match s {
        "A" => Sizage { hs: 1, ss: 0, fs: 44, ls: 0 },
        "B" => Sizage { hs: 1, ss: 0, fs: 44, ls: 0 },
        "C" => Sizage { hs: 1, ss: 0, fs: 44, ls: 0 },
        "D" => Sizage { hs: 1, ss: 0, fs: 44, ls: 0 },
        "E" => Sizage { hs: 1, ss: 0, fs: 44, ls: 0 },
        "F" => Sizage { hs: 1, ss: 0, fs: 44, ls: 0 },
        "G" => Sizage { hs: 1, ss: 0, fs: 44, ls: 0 },
        "H" => Sizage { hs: 1, ss: 0, fs: 44, ls: 0 },
        "I" => Sizage { hs: 1, ss: 0, fs: 44, ls: 0 },
        "J" => Sizage { hs: 1, ss: 0, fs: 44, ls: 0 },
        "K" => Sizage { hs: 1, ss: 0, fs: 76, ls: 0 },
        "L" => Sizage { hs: 1, ss: 0, fs: 76, ls: 0 },
        "M" => Sizage { hs: 1, ss: 0, fs: 4, ls: 0 },
        "N" => Sizage { hs: 1, ss: 0, fs: 12, ls: 0 },
        ...
        "9AAB" => Sizage { hs: 4, ss: 4, fs: u32::MAX, ls: 2 },
        _ => return err!(Error::UnknownSizage(s.to_string())),
    })
}
```

### cesrixir (Elixir)
**Scope:** Elixir/BEAM implementation focused on encoder/decoder tooling with ordered map handling for field maps.  
**Strengths:** Clean separation between stream sniffing, version switching, and encoded element production; pragmatic support for annotations and protocol-genus switching.  
**Weaknesses:** Relies on ordmap library patches and lacks true streaming optimizations; some features remain “work in progress.”  
**Ideas to Adopt:** Borrow its clear API division (`consume_stream`, `produce_text_stream`, `consume_primitive_T`) when shaping the TypeScript public surface.

```21:124:cesrixir/lib/cesr.ex
@doc """
Consumes well-formed cesr-stream.
"""
def consume_stream(stream, protocol_genus \\ :keri_aaabaa), do: _consume_stream(stream, [], 0, protocol_genus)
defp _consume_stream(stream, acc, current_byte, protocol_genus) do
  case consume_element(stream, protocol_genus) do
    {:protocol_genus_switch, new_protocol_genus, rest} -> 
      _consume_stream(rest, [new_protocol_genus | acc], byte_size(stream) - byte_size(rest) + current_byte, new_protocol_genus)
    {:ok, element, rest} ->
      _consume_stream(rest, [element | acc], byte_size(stream) - byte_size(rest) + current_byte, protocol_genus)
    {:error, message} -> {:error, message}
  end
end
def produce_text_stream(list_of_cesr_elements) when is_list(list_of_cesr_elements) do
  _produce_stream(list_of_cesr_elements, :text, [])
end
def produce_binary_stream(list_of_cesr_elements) when is_list(list_of_cesr_elements) do
  _produce_stream(list_of_cesr_elements, :binary, [])
end
def consume_element(cesr_stream, protocol_genus \\ :keri_aaabaa)
def consume_element(cesr_stream, protocol_genus) when byte_size(cesr_stream) >= 1 do
  << first_tritet::3, _::bitstring >> = cesr_stream
  case sniff_tritet(first_tritet) do
    :annotations -> process_annotations(cesr_stream)
    :cesr_t_cnt_code -> process_T_cnt_code(cesr_stream, protocol_genus)
    :cesr_t_op_code -> process_T_op_code(cesr_stream)
    :json_map -> process_json_map(cesr_stream)
    :mgpk_fixmap -> process_mgpk_fixmap(cesr_stream)
    :cbor_map -> process_cbor_map(cesr_stream)
    :mgpk_16_or_32 -> process_mgpk_16_or_32_map(cesr_stream)
    :cesr_b_cnt_or_op_code -> process_B_cnt_or_op_code(cesr_stream, protocol_genus)
  end
end
```

### cesrox (Rust)
**Scope:** Minimal Rust crate specialising in CESR derivation codes and prefix handling for cryptographic operations.  
**Strengths:** Modular derivation enums covering multiple hash families, clean trait abstractions for code length/derivative length, and reusable digest utilities.  
**Weaknesses:** Narrow focus on derivations (no parser) and pending ergonomic polish for optional keyed hashing paths.  
**Ideas to Adopt:** Use its enum-based dispatch model for TypeScript digest selection, ensuring multi-algorithm support without sprawling conditionals.

```1:173:cesrox/src/derivation/self_addressing.rs
#[derive(Debug, PartialEq, Clone, Hash)]
pub enum SelfAddressing {
    Blake3_256,
    Blake2B256(Vec<u8>),
    Blake2S256(Vec<u8>),
    SHA3_256,
    SHA2_256,
    Blake3_512,
    SHA3_512,
    Blake2B512,
    SHA2_512,
}
impl SelfAddressing {
    pub fn digest(&self, data: &[u8]) -> Vec<u8> {
        match self {
            Self::Blake3_256 => blake3_256_digest(data),
            Self::Blake2B256(key) => blake2b_256_digest(data, key),
            Self::Blake2S256(key) => blake2s_256_digest(data, key),
            Self::SHA3_256 => sha3_256_digest(data),
            Self::SHA2_256 => sha2_256_digest(data),
            Self::Blake3_512 => blake3_512_digest(data),
            Self::SHA3_512 => sha3_512_digest(data),
            Self::Blake2B512 => blake2b_512_digest(data),
            Self::SHA2_512 => sha2_512_digest(data),
        }
    }
    pub fn derive(&self, data: &[u8]) -> SelfAddressingPrefix {
        SelfAddressingPrefix::new(self.to_owned(), self.digest(data))
    }
}
```

### keriox (Rust)
**Scope:** Ambitious Rust implementation of the entire KERI stack, including parsers, processors, storage backends, and optional async features.  
**Strengths:** Parser combinators (`nom`) that simultaneously decode JSON, CBOR, and MsgPack payloads, assemble attachments, and feed typed event enums with test coverage lifted from KERIpy.  
**Weaknesses:** Complex feature flags and partial feature completion raise the integration bar; heavier dependencies may not align with TypeScript runtime constraints.  
**Ideas to Adopt:** Emulate the layered parsing strategy that separates payload decoding from attachment folding, and port its test vectors to TypeScript to validate parity.

```1:114:keriox/src/event_parsing/message.rs
fn json_message<'a, D: Deserialize<'a> + Digestible>(
    s: &'a [u8],
) -> nom::IResult<&[u8], EventMessage<D>> {
    let mut stream = serde_json::Deserializer::from_slice(s).into_iter::<EventMessage<D>>();
    match stream.next() {
        Some(Ok(event)) => Ok((&s[stream.byte_offset()..], event)),
        _ => Err(nom::Err::Error((s, ErrorKind::IsNot))),
    }
}
pub fn message<'a, D: Deserialize<'a> + Digestible>(
    s: &'a [u8],
) -> nom::IResult<&[u8], EventMessage<D>> {
    alt((json_message::<D>, cbor_message::<D>, mgpk_message::<D>))(s)
}
pub fn signed_message(s: &[u8]) -> nom::IResult<&[u8], SignedEventData> {
    let (rest, event) = alt((key_event_message, receipt_message))(s)?;
    let (rest, attachments): (&[u8], Vec<Attachment>) =
        fold_many0(attachment, vec![], |mut acc: Vec<_>, item| {
            acc.push(item);
            acc
        })(rest)?;
    Ok((
        rest,
        SignedEventData {
            deserialized_event: event,
            attachments,
        },
    ))
}
```

### parside (Rust)
**Scope:** CESR parser and verifier used to validate ACDC credentials and transaction events backed by persistent stores.  
**Strengths:** Deep integration between parsed attachments, state verification, and store lookups that mirror “Kevery + escrow + OOBI” flows; demonstrates end-to-end validation logic independent of KERIpy.  
**Weaknesses:** Opinionated store contracts and domain-specific error handling make direct reuse tricky; streaming interface is still evolving.  
**Ideas to Adopt:** Study its escrow handling and verification sequencing to guide TypeScript Kevery/Revery integration once the parser delivers attachments.

```145:284:parside/src/message/message.rs
fn verify_key_event(&self, serder: &Serder, quadlets: &AttachedMaterialQuadlets, deep: Option<bool>) -> Result<bool> {
    let pre = serder.pre()?;
    let ked = serder.ked();
    let sn = serder.sn()?;
    let ilk = ked["t"].to_string()?;
    let said = serder.said()?;
    let mut verified_indices = vec![0u32; 0];
    for group in quadlets.value() {
        match group {
            CesrGroup::ControllerIdxSigsVariant { value } => {
                for controller_idx_sig in value.value() {
                    let siger = &controller_idx_sig.siger;
                    if siger.index() as usize > verfers.len() {
                        return err!(Error::Verification);
                    }
                    if verfers[siger.index() as usize].verify(&siger.raw(), &serder.raw())? {
                        verified_indices.push(siger.index());
                    }
                }
            }
            _ => return err!(Error::Decoding)
        }
    }
    if !tholder.satisfy(&verified_indices)? {
        return err!(Error::Verification);
    }
    ...
}
```

## Comparative Observations
- Stream sniffing converges on tritet analysis plus version-string decoding; implementing this once in TypeScript (with switchable genus tables) unlocks parity across languages.  
- Table-driven sizage/codex metadata (Rust, TypeScript, Elixir ports) outperforms ad-hoc conditionals—JSON definitions or generated TypeScript maps should seed the parser.  
- Attachment handling consistently folds into counter-specific extractors; preserving KERIpy’s counter→handler pattern prevents combinatorial explosion.  
- End-to-end tests across repositories rely on KERIpy vector exports; curating a shared fixture set will anchor cross-language equivalence.

## Proposed KERI TS CESR Plan
- Phase 0 – Consolidate primitives: import/modernize `kerits` Matter, Counter, Number, Prefixer, and utility modules, backed by cesride-style codex tables and jest-style fixtures from `cesr-ts`.  
- Phase 1 – Build parser core: implement cold-start sniffing, version detection, counter decoding, and attachment routing mirroring KERIpy’s generator API while remaining streaming-friendly.  
- Phase 2 – Integrate Serder: port KERIpy field validation rules (icp/rot/ixn etc.), support JSON/CBOR/MsgPack bodies, and compute SAIDs with configurable digest enums inspired by `cesrox`.  
- Phase 3 – Attachments & escrows: deliver Revery/Kevery-ready hooks by reproducing counter handlers (signatures, receipts, replies) and staging escrow queues akin to parside.  
- Phase 4 – Compatibility & tooling: add binary domain conversion, auto-generated code tables (leveraging cesr-decoder’s schema approach), and alignment with ToIP spec updates (v1/v2).  
- Phase 5 – Testing & docs: assemble cross-language conformance suite using KERIpy exports, `cesr-decoder` samples, and keriox stream tests; document public APIs following cesrixir’s clarity.

## Immediate Next Actions
- Extract and adapters: copy `kerits/src/cesr` primitives into `keri-ts`, refactor for pure ESM/Bun compliance, and add unit tests that mirror `cesr-ts` expectations.  
- Prototype parser skeleton: host a new `Parser` class with tritet sniffing, counter decoding, and method dispatch, backed by fixtures from `cesr-decoder` and KERIpy.  
- Align with spec: generate TypeScript codex metadata directly from `tswg-cesr-specification` JSON to ensure the parser stays current without manual table edits.  
- Schedule integration: plan Kevery/Revery refactors to consume the new parser output once primitives and attachments reach parity with KERIpy.

