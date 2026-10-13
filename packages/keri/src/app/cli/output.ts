/** Own stdout writes until completion or cancellation, including partial native writes. */
export async function writeStdout(text: string, signal: AbortSignal): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  /** The CLI owns stdout; closing it interrupts a blocked native write on scope cancellation. */
  const abort = () => {
    try {
      Deno.stdout.close();
    } catch { /* Already closed by the runtime. */ }
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (let offset = 0; offset < bytes.length;) {
      signal.throwIfAborted();
      offset += await Deno.stdout.write(bytes.subarray(offset));
    }
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
