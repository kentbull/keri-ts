/** Evidence channel: cases report what an engine actually did; the runner prints it per engine. */

/** Record one observation. In the browser it reaches the runner; elsewhere it goes to the console. */
export function note(line: string): void {
  const sink = (globalThis as unknown as { keriBrowserNotes?: string[] }).keriBrowserNotes;
  if (sink) sink.push(line);
  else console.log(line);
}
