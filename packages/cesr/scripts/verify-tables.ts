import { buildGeneratedArtifacts } from "./generate-tables.ts";

async function main(): Promise<void> {
  const artifacts = await buildGeneratedArtifacts();
  const mismatches: string[] = [];

  for (const [path, expected] of Object.entries(artifacts)) {
    const actual = await Deno.readTextFile(path);
    if (actual !== expected) {
      mismatches.push(path);
    }
  }

  if (mismatches.length > 0) {
    console.error("CESR generated tables are out of date:");
    for (const path of mismatches) {
      console.error(`- ${path}`);
    }
    Deno.exit(1);
  }

  console.log("verify-tables: generated CESR tables match KERIpy baseline.");
}

if (import.meta.main) {
  await main();
}
