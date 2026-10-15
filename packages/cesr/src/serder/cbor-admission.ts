import { CborAdmissionError, ResourceLimitError } from "../core/errors.ts";
import type { DecodedBodyBudget } from "./body-admission.ts";
import { cborWorkspaceBytes } from "./codec-workspace.ts";

/**
 * Admit base CBOR tokens before codec allocation, without a value tree or syntax/depth limit.
 * Flat inspection also charges trailing tokens; indefinite containers conservatively charge
 * each token as a potential entry. Special packed/record/shared/bundled expansion and codec
 * globals are separate owners, not bounded by this base-token gate.
 */
export function admitCbor(raw: Uint8Array, budget: DecodedBodyBudget): boolean {
  if (!Number.isSafeInteger(budget.decodedBytes) || budget.decodedBytes < 0) {
    throw new RangeError("Decoded credit must be a non-negative safe integer");
  }
  budget.admitStage?.(64);
  let remaining = budget.decodedBytes, offset = 0, pending = 1;
  let indefinite = false, tagged = false, boundaryFailure = false;
  while (offset < raw.length) {
    const token = raw[offset++], major = token >> 5, additional = token & 31;
    let size = additional, width = 0, payload = 0;
    // Potential indefinite map/Set/root-Map projection entries: reference16 +two fields16 each.
    let charge = 48;
    if (additional >= 28 && additional <= 30) {
      boundaryFailure = true;
      break;
    }
    if (additional === 31) {
      if (major === 4 || major === 5) {
        indefinite = true;
        charge += 64;
      } else if (major !== 7) {
        boundaryFailure = true; // The pinned codec rejects indefinite strings/other majors.
        break;
      }
      size = 0;
    } else {
      if (additional >= 24) width = 2 ** (additional - 24);
      if (width > raw.length - offset) {
        boundaryFailure = true;
        break;
      }
      size = width ? 0 : size;
      for (let index = 0; index < width; index++) {
        // Integer/float payloads are opaque; only length/tag declarations need numeric extent.
        if (major >= 2 && major <= 6) size = size * 256 + raw[offset];
        offset++;
      }
      if (!Number.isSafeInteger(size)) throw new ResourceLimitError("CBOR declaration exceeds safe accounting");
      if (major === 4 || major === 5) {
        charge += 64 + size * (major === 4 ? 16 : 48);
        pending += size * (major === 4 ? 1 : 2);
      } else if (major === 2) {
        // Binary view +possible typed-array view/DataView and unaligned/endian copy.
        charge += 3 * 64 + size;
        payload = size;
      } else if (major === 3) {
        charge += 2 * size;
        payload = size;
      } else if (major === 6) {
        admitTag(size);
        tagged = true;
        // Unknown Tag has two fields; this also bounds the standard Date record.
        charge += 64 + 2 * 16;
        pending++;
      } else {
        // Numeric property labels: binary64 number <=24 chars; uint64 BigInt <=21.
        charge += 8 + 2 * 24;
      }
    }
    if (charge > remaining) throw new ResourceLimitError("CBOR exceeds decoded tree credit");
    remaining -= charge;
    pending--;
    if (payload > raw.length - offset) {
      boundaryFailure = true;
      break;
    }
    offset += payload;
  }
  const working = cborWorkspaceBytes(raw.length);
  budget.admitStage?.(working);
  budget.admitStage?.(budget.decodedBytes - remaining);
  budget.decodedBytes = remaining;
  // Builtin/custom tag callbacks have independent failure provenance and expansion owners.
  return !tagged && (boundaryFailure || (!indefinite && pending !== 0));
}

/**
 * Refuse actual cbor-x-only expansion before codec entry, not unknown CBOR semantics.
 * Definitions are blocked and the private codec configures no tables/getShared, so
 * record IDs and 6/14/15 necessarily retain bounded Tag fallback on this path.
 * All six packed prefix/suffix ranges and the table export are actual allocating handlers.
 */
function admitTag(tag: number): void {
  if (
    tag === 27 || tag === 51 || tag === 105 || tag === 259
    || tag === 0xdff9 || tag === 0xdffe || tag === 0xdfff || tag === 0x53687264
    || (tag >= 225 && tag <= 255) || (tag >= 28704 && tag <= 32767)
    || (tag >= 1879052288 && tag <= 2147483647) || (tag >= 216 && tag <= 223)
    || (tag >= 27647 && tag <= 28671) || (tag >= 1811940352 && tag <= 1879048191)
  ) throw new CborAdmissionError(tag);
}
