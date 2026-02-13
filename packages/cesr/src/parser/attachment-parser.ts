import type { AttachmentGroup } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { parseCounterFromText } from "../primitives/counter.ts";
import {
  GroupSizeError,
  ShortageError,
  UnknownCodeError,
} from "../core/errors.ts";

function toText(input: Uint8Array): string {
  return String.fromCharCode(...input);
}

export function parseAttachmentGroup(
  input: Uint8Array,
  version: Versionage,
): { group: AttachmentGroup; consumed: number } {
  const counter = parseCounterFromText(input, version);

  if (counter.code !== "-V" && counter.code !== "--V") {
    throw new UnknownCodeError(
      `Only attached-material groups are accepted at top-level, got ${counter.code}`,
    );
  }

  const txt = toText(input);
  const totalChars = counter.fullSize + counter.count * 4;
  if (txt.length < totalChars) {
    throw new ShortageError(totalChars, txt.length);
  }

  const raw = input.slice(0, totalChars);
  const payload = txt.slice(counter.fullSize, totalChars);
  if (payload.length % 4 !== 0) {
    throw new GroupSizeError(
      "Attached material quadlets payload must align to quadlets",
    );
  }

  const items = payload.match(/.{1,4}/g) ?? [];

  return {
    group: {
      code: counter.code,
      name: counter.name,
      count: counter.count,
      raw,
      items,
    },
    consumed: totalChars,
  };
}
