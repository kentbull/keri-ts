import { b64ToInt } from "../core/bytes.ts";
import { DeserializeError, UnknownCodeError } from "../core/errors.ts";
import {
  COUNTER_CODE_NAMES,
  COUNTER_SIZES_V1,
  COUNTER_SIZES_V2,
} from "../tables/counter.tables.generated.ts";
import type { Versionage } from "../tables/table-types.ts";

export interface Counter {
  code: string;
  count: number;
  fullSize: number;
  qb64: string;
  name: string;
}

export function parseCounterFromText(
  input: Uint8Array,
  version: Versionage,
): Counter {
  const txt = String.fromCharCode(...input);
  if (txt.length < 4 || txt[0] !== "-") {
    throw new DeserializeError("Invalid counter text input");
  }

  let code = txt.slice(0, 2);
  let table = version.major >= 2 ? COUNTER_SIZES_V2 : COUNTER_SIZES_V1;
  let sizage = table.get(code);

  if (!sizage) {
    code = txt.slice(0, 3);
    sizage = table.get(code);
  }
  if (!sizage) {
    code = txt.slice(0, 5);
    sizage = table.get(code);
  }
  if (!sizage) {
    throw new UnknownCodeError(
      `Unsupported counter code at stream: ${txt.slice(0, 5)}`,
    );
  }

  if (txt.length < sizage.fs) {
    throw new DeserializeError(`Need ${sizage.fs} chars for counter`);
  }

  const count = b64ToInt(txt.slice(sizage.hs, sizage.hs + sizage.ss));
  const name = COUNTER_CODE_NAMES[code as keyof typeof COUNTER_CODE_NAMES] ??
    "UnknownCounter";

  return {
    code,
    count,
    fullSize: sizage.fs,
    qb64: txt.slice(0, sizage.fs),
    name,
  };
}
