/**
 * Generate runtime version modules from package manifest versions.
 *
 * Usage:
 *   deno run -A scripts/generate_versions.ts
 *   deno run -A scripts/generate_versions.ts --check
 *   deno run -A scripts/generate_versions.ts --only keri
 *   deno run -A scripts/generate_versions.ts --only cesr
 *   deno run -A scripts/generate_versions.ts --ci-build-metadata
 */ const TARGETS = [
  {
    name: "keri",
    packagePath: new URL("../packages/keri/package.json", import.meta.url),
    outputPath: new URL("../packages/keri/src/app/version.ts", import.meta.url),
    envOverrideKey: "KERI_TS_BUILD_METADATA"
  },
  {
    name: "cesr",
    packagePath: new URL("../packages/cesr/package.json", import.meta.url),
    outputPath: new URL("../packages/cesr/src/version.ts", import.meta.url),
    envOverrideKey: "CESR_TS_BUILD_METADATA"
  },
  {
    name: "tufa",
    packagePath: new URL("../packages/tufa/package.json", import.meta.url),
    outputPath: new URL("../packages/tufa/src/version.ts", import.meta.url),
    envOverrideKey: "TUFA_BUILD_METADATA"
  }
];
// Accept the manifest version shape this repo publishes: strict numeric
// major/minor/patch with an optional dot-separated prerelease suffix.
const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
// Build metadata is dot-separated alphanumeric/hyphen identifiers; `+` is not
// included because DISPLAY_VERSION adds the plus separator itself.
const BUILD_METADATA_REGEX = /^[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/;
const VERSION_MODULE_TEMPLATE = await Deno.readTextFile(new URL("./templates/version-module.template.ts", import.meta.url));
function parseArgs(args) {
  let check = false;
  let only = "all";
  let ciBuildMetadata = false;
  for(let i = 0; i < args.length; i++){
    const arg = args[i];
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--ci-build-metadata") {
      ciBuildMetadata = true;
      continue;
    }
    if (arg === "--only") {
      const next = args[i + 1];
      if (next !== "keri" && next !== "cesr" && next !== "tufa") {
        throw new Error("--only must be 'keri', 'cesr', or 'tufa'");
      }
      only = next;
      i++;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return {
    check,
    only,
    ciBuildMetadata
  };
}
function normalizeBuildMetadata(input) {
  // Replace any unsupported metadata character run with a hyphen, collapse
  // repeated dots into one separator, then trim hyphen padding introduced at
  // either edge by the first replacement.
  const cleaned = input.trim().replace(/[^0-9A-Za-z.-]+/g, "-").replace(/\.{2,}/g, ".").replace(/^-+|-+$/g, "");
  if (!cleaned) {
    return "";
  }
  if (!BUILD_METADATA_REGEX.test(cleaned)) {
    throw new Error(`Invalid build metadata: ${input}`);
  }
  return cleaned;
}
function computeDefaultBuildMetadata() {
  const run = Deno.env.get("GITHUB_RUN_NUMBER") ?? Deno.env.get("GITHUB_RUN_ID");
  const sha = Deno.env.get("GITHUB_SHA")?.slice(0, 8);
  if (run && sha) {
    return `build.${run}.${sha}`;
  }
  if (run) {
    return `build.${run}`;
  }
  if (sha) {
    return `build.${sha}`;
  }
  return "";
}
function getBuildMetadata(target, ciBuildMetadata) {
  const explicit = Deno.env.get(target.envOverrideKey) ?? Deno.env.get("BUILD_METADATA");
  if (explicit) {
    return normalizeBuildMetadata(explicit);
  }
  return ciBuildMetadata ? computeDefaultBuildMetadata() : "";
}
async function readPackageVersion(path) {
  const raw = await Deno.readTextFile(path);
  const pkg = JSON.parse(raw);
  const version = pkg.version?.trim();
  if (!version) {
    throw new Error(`Missing version in ${path}`);
  }
  if (!SEMVER_REGEX.test(version)) {
    throw new Error(`Invalid semver in ${path}: ${version}. Expected x.y.z or x.y.z-prerelease.`);
  }
  return version;
}
function renderVersionModule(version, buildMetadata) {
  const escapedVersion = JSON.stringify(version);
  const escapedMetadata = JSON.stringify(buildMetadata);
  return VERSION_MODULE_TEMPLATE.replace(JSON.stringify("__PACKAGE_VERSION__"), escapedVersion).replace(JSON.stringify("__BUILD_METADATA__"), escapedMetadata);
}
async function ensureVersionModule(target, check, ciBuildMetadata) {
  const packageVersion = await readPackageVersion(target.packagePath);
  const buildMetadata = getBuildMetadata(target, ciBuildMetadata);
  const expected = renderVersionModule(packageVersion, buildMetadata);
  let current = "";
  try {
    current = await Deno.readTextFile(target.outputPath);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
  if (current === expected) {
    return;
  }
  if (check) {
    throw new Error(`Version module out of date: ${target.outputPath}. Run deno task version:generate.`);
  }
  await Deno.writeTextFile(target.outputPath, expected);
}
async function main() {
  const { check, only, ciBuildMetadata } = parseArgs(Deno.args);
  const targets = only === "all" ? TARGETS : TARGETS.filter((target)=>target.name === only);
  for (const target of targets){
    await ensureVersionModule(target, check, ciBuildMetadata);
  }
}
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`version generation failed: ${message}`);
    Deno.exit(1);
  }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImZpbGU6Ly8vaG9tZS9ydW5uZXIvd29yay9rZXJpLXRzL2tlcmktdHMvc2NyaXB0cy9nZW5lcmF0ZV92ZXJzaW9ucy50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEdlbmVyYXRlIHJ1bnRpbWUgdmVyc2lvbiBtb2R1bGVzIGZyb20gcGFja2FnZSBtYW5pZmVzdCB2ZXJzaW9ucy5cbiAqXG4gKiBVc2FnZTpcbiAqICAgZGVubyBydW4gLUEgc2NyaXB0cy9nZW5lcmF0ZV92ZXJzaW9ucy50c1xuICogICBkZW5vIHJ1biAtQSBzY3JpcHRzL2dlbmVyYXRlX3ZlcnNpb25zLnRzIC0tY2hlY2tcbiAqICAgZGVubyBydW4gLUEgc2NyaXB0cy9nZW5lcmF0ZV92ZXJzaW9ucy50cyAtLW9ubHkga2VyaVxuICogICBkZW5vIHJ1biAtQSBzY3JpcHRzL2dlbmVyYXRlX3ZlcnNpb25zLnRzIC0tb25seSBjZXNyXG4gKiAgIGRlbm8gcnVuIC1BIHNjcmlwdHMvZ2VuZXJhdGVfdmVyc2lvbnMudHMgLS1jaS1idWlsZC1tZXRhZGF0YVxuICovXG5cbmludGVyZmFjZSBHZW5lcmF0ZVRhcmdldCB7XG4gIG5hbWU6IFwia2VyaVwiIHwgXCJjZXNyXCIgfCBcInR1ZmFcIjtcbiAgcGFja2FnZVBhdGg6IFVSTDtcbiAgb3V0cHV0UGF0aDogVVJMO1xuICBlbnZPdmVycmlkZUtleTogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgUGFja2FnZU1hbmlmZXN0IHtcbiAgdmVyc2lvbj86IHN0cmluZztcbn1cblxuY29uc3QgVEFSR0VUUzogR2VuZXJhdGVUYXJnZXRbXSA9IFtcbiAge1xuICAgIG5hbWU6IFwia2VyaVwiLFxuICAgIHBhY2thZ2VQYXRoOiBuZXcgVVJMKFwiLi4vcGFja2FnZXMva2VyaS9wYWNrYWdlLmpzb25cIiwgaW1wb3J0Lm1ldGEudXJsKSxcbiAgICBvdXRwdXRQYXRoOiBuZXcgVVJMKFwiLi4vcGFja2FnZXMva2VyaS9zcmMvYXBwL3ZlcnNpb24udHNcIiwgaW1wb3J0Lm1ldGEudXJsKSxcbiAgICBlbnZPdmVycmlkZUtleTogXCJLRVJJX1RTX0JVSUxEX01FVEFEQVRBXCIsXG4gIH0sXG4gIHtcbiAgICBuYW1lOiBcImNlc3JcIixcbiAgICBwYWNrYWdlUGF0aDogbmV3IFVSTChcIi4uL3BhY2thZ2VzL2Nlc3IvcGFja2FnZS5qc29uXCIsIGltcG9ydC5tZXRhLnVybCksXG4gICAgb3V0cHV0UGF0aDogbmV3IFVSTChcIi4uL3BhY2thZ2VzL2Nlc3Ivc3JjL3ZlcnNpb24udHNcIiwgaW1wb3J0Lm1ldGEudXJsKSxcbiAgICBlbnZPdmVycmlkZUtleTogXCJDRVNSX1RTX0JVSUxEX01FVEFEQVRBXCIsXG4gIH0sXG4gIHtcbiAgICBuYW1lOiBcInR1ZmFcIixcbiAgICBwYWNrYWdlUGF0aDogbmV3IFVSTChcIi4uL3BhY2thZ2VzL3R1ZmEvcGFja2FnZS5qc29uXCIsIGltcG9ydC5tZXRhLnVybCksXG4gICAgb3V0cHV0UGF0aDogbmV3IFVSTChcIi4uL3BhY2thZ2VzL3R1ZmEvc3JjL3ZlcnNpb24udHNcIiwgaW1wb3J0Lm1ldGEudXJsKSxcbiAgICBlbnZPdmVycmlkZUtleTogXCJUVUZBX0JVSUxEX01FVEFEQVRBXCIsXG4gIH0sXG5dO1xuXG4vLyBBY2NlcHQgdGhlIG1hbmlmZXN0IHZlcnNpb24gc2hhcGUgdGhpcyByZXBvIHB1Ymxpc2hlczogc3RyaWN0IG51bWVyaWNcbi8vIG1ham9yL21pbm9yL3BhdGNoIHdpdGggYW4gb3B0aW9uYWwgZG90LXNlcGFyYXRlZCBwcmVyZWxlYXNlIHN1ZmZpeC5cbmNvbnN0IFNFTVZFUl9SRUdFWCA9IC9eKDB8WzEtOV1cXGQqKVxcLigwfFsxLTldXFxkKilcXC4oMHxbMS05XVxcZCopKD86LVswLTlBLVphLXotXSsoPzpcXC5bMC05QS1aYS16LV0rKSopPyQvO1xuLy8gQnVpbGQgbWV0YWRhdGEgaXMgZG90LXNlcGFyYXRlZCBhbHBoYW51bWVyaWMvaHlwaGVuIGlkZW50aWZpZXJzOyBgK2AgaXMgbm90XG4vLyBpbmNsdWRlZCBiZWNhdXNlIERJU1BMQVlfVkVSU0lPTiBhZGRzIHRoZSBwbHVzIHNlcGFyYXRvciBpdHNlbGYuXG5jb25zdCBCVUlMRF9NRVRBREFUQV9SRUdFWCA9IC9eWzAtOUEtWmEtei1dKyg/OlxcLlswLTlBLVphLXotXSspKiQvO1xuY29uc3QgVkVSU0lPTl9NT0RVTEVfVEVNUExBVEUgPSBhd2FpdCBEZW5vLnJlYWRUZXh0RmlsZShcbiAgbmV3IFVSTChcIi4vdGVtcGxhdGVzL3ZlcnNpb24tbW9kdWxlLnRlbXBsYXRlLnRzXCIsIGltcG9ydC5tZXRhLnVybCksXG4pO1xuXG5mdW5jdGlvbiBwYXJzZUFyZ3MoYXJnczogc3RyaW5nW10pIHtcbiAgbGV0IGNoZWNrID0gZmFsc2U7XG4gIGxldCBvbmx5OiBcImFsbFwiIHwgXCJrZXJpXCIgfCBcImNlc3JcIiB8IFwidHVmYVwiID0gXCJhbGxcIjtcbiAgbGV0IGNpQnVpbGRNZXRhZGF0YSA9IGZhbHNlO1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGFyZyA9IGFyZ3NbaV07XG4gICAgaWYgKGFyZyA9PT0gXCItLWNoZWNrXCIpIHtcbiAgICAgIGNoZWNrID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChhcmcgPT09IFwiLS1jaS1idWlsZC1tZXRhZGF0YVwiKSB7XG4gICAgICBjaUJ1aWxkTWV0YWRhdGEgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGFyZyA9PT0gXCItLW9ubHlcIikge1xuICAgICAgY29uc3QgbmV4dCA9IGFyZ3NbaSArIDFdO1xuICAgICAgaWYgKG5leHQgIT09IFwia2VyaVwiICYmIG5leHQgIT09IFwiY2VzclwiICYmIG5leHQgIT09IFwidHVmYVwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIi0tb25seSBtdXN0IGJlICdrZXJpJywgJ2Nlc3InLCBvciAndHVmYSdcIik7XG4gICAgICB9XG4gICAgICBvbmx5ID0gbmV4dDtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBhcmd1bWVudDogJHthcmd9YCk7XG4gIH1cblxuICByZXR1cm4geyBjaGVjaywgb25seSwgY2lCdWlsZE1ldGFkYXRhIH07XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUJ1aWxkTWV0YWRhdGEoaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIC8vIFJlcGxhY2UgYW55IHVuc3VwcG9ydGVkIG1ldGFkYXRhIGNoYXJhY3RlciBydW4gd2l0aCBhIGh5cGhlbiwgY29sbGFwc2VcbiAgLy8gcmVwZWF0ZWQgZG90cyBpbnRvIG9uZSBzZXBhcmF0b3IsIHRoZW4gdHJpbSBoeXBoZW4gcGFkZGluZyBpbnRyb2R1Y2VkIGF0XG4gIC8vIGVpdGhlciBlZGdlIGJ5IHRoZSBmaXJzdCByZXBsYWNlbWVudC5cbiAgY29uc3QgY2xlYW5lZCA9IGlucHV0LnRyaW0oKS5yZXBsYWNlKC9bXjAtOUEtWmEtei4tXSsvZywgXCItXCIpLnJlcGxhY2UoXG4gICAgL1xcLnsyLH0vZyxcbiAgICBcIi5cIixcbiAgKS5yZXBsYWNlKC9eLSt8LSskL2csIFwiXCIpO1xuXG4gIGlmICghY2xlYW5lZCkge1xuICAgIHJldHVybiBcIlwiO1xuICB9XG5cbiAgaWYgKCFCVUlMRF9NRVRBREFUQV9SRUdFWC50ZXN0KGNsZWFuZWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGJ1aWxkIG1ldGFkYXRhOiAke2lucHV0fWApO1xuICB9XG5cbiAgcmV0dXJuIGNsZWFuZWQ7XG59XG5cbmZ1bmN0aW9uIGNvbXB1dGVEZWZhdWx0QnVpbGRNZXRhZGF0YSgpOiBzdHJpbmcge1xuICBjb25zdCBydW4gPSBEZW5vLmVudi5nZXQoXCJHSVRIVUJfUlVOX05VTUJFUlwiKVxuICAgID8/IERlbm8uZW52LmdldChcIkdJVEhVQl9SVU5fSURcIik7XG4gIGNvbnN0IHNoYSA9IERlbm8uZW52LmdldChcIkdJVEhVQl9TSEFcIik/LnNsaWNlKDAsIDgpO1xuXG4gIGlmIChydW4gJiYgc2hhKSB7XG4gICAgcmV0dXJuIGBidWlsZC4ke3J1bn0uJHtzaGF9YDtcbiAgfVxuXG4gIGlmIChydW4pIHtcbiAgICByZXR1cm4gYGJ1aWxkLiR7cnVufWA7XG4gIH1cblxuICBpZiAoc2hhKSB7XG4gICAgcmV0dXJuIGBidWlsZC4ke3NoYX1gO1xuICB9XG5cbiAgcmV0dXJuIFwiXCI7XG59XG5cbmZ1bmN0aW9uIGdldEJ1aWxkTWV0YWRhdGEoXG4gIHRhcmdldDogR2VuZXJhdGVUYXJnZXQsXG4gIGNpQnVpbGRNZXRhZGF0YTogYm9vbGVhbixcbik6IHN0cmluZyB7XG4gIGNvbnN0IGV4cGxpY2l0ID0gRGVuby5lbnYuZ2V0KHRhcmdldC5lbnZPdmVycmlkZUtleSlcbiAgICA/PyBEZW5vLmVudi5nZXQoXCJCVUlMRF9NRVRBREFUQVwiKTtcbiAgaWYgKGV4cGxpY2l0KSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZUJ1aWxkTWV0YWRhdGEoZXhwbGljaXQpO1xuICB9XG5cbiAgcmV0dXJuIGNpQnVpbGRNZXRhZGF0YSA/IGNvbXB1dGVEZWZhdWx0QnVpbGRNZXRhZGF0YSgpIDogXCJcIjtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVhZFBhY2thZ2VWZXJzaW9uKHBhdGg6IFVSTCk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHJhdyA9IGF3YWl0IERlbm8ucmVhZFRleHRGaWxlKHBhdGgpO1xuICBjb25zdCBwa2cgPSBKU09OLnBhcnNlKHJhdykgYXMgUGFja2FnZU1hbmlmZXN0O1xuICBjb25zdCB2ZXJzaW9uID0gcGtnLnZlcnNpb24/LnRyaW0oKTtcblxuICBpZiAoIXZlcnNpb24pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgdmVyc2lvbiBpbiAke3BhdGh9YCk7XG4gIH1cblxuICBpZiAoIVNFTVZFUl9SRUdFWC50ZXN0KHZlcnNpb24pKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYEludmFsaWQgc2VtdmVyIGluICR7cGF0aH06ICR7dmVyc2lvbn0uIEV4cGVjdGVkIHgueS56IG9yIHgueS56LXByZXJlbGVhc2UuYCxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHZlcnNpb247XG59XG5cbmZ1bmN0aW9uIHJlbmRlclZlcnNpb25Nb2R1bGUodmVyc2lvbjogc3RyaW5nLCBidWlsZE1ldGFkYXRhOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBlc2NhcGVkVmVyc2lvbiA9IEpTT04uc3RyaW5naWZ5KHZlcnNpb24pO1xuICBjb25zdCBlc2NhcGVkTWV0YWRhdGEgPSBKU09OLnN0cmluZ2lmeShidWlsZE1ldGFkYXRhKTtcblxuICByZXR1cm4gVkVSU0lPTl9NT0RVTEVfVEVNUExBVEVcbiAgICAucmVwbGFjZShKU09OLnN0cmluZ2lmeShcIl9fUEFDS0FHRV9WRVJTSU9OX19cIiksIGVzY2FwZWRWZXJzaW9uKVxuICAgIC5yZXBsYWNlKEpTT04uc3RyaW5naWZ5KFwiX19CVUlMRF9NRVRBREFUQV9fXCIpLCBlc2NhcGVkTWV0YWRhdGEpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBlbnN1cmVWZXJzaW9uTW9kdWxlKFxuICB0YXJnZXQ6IEdlbmVyYXRlVGFyZ2V0LFxuICBjaGVjazogYm9vbGVhbixcbiAgY2lCdWlsZE1ldGFkYXRhOiBib29sZWFuLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHBhY2thZ2VWZXJzaW9uID0gYXdhaXQgcmVhZFBhY2thZ2VWZXJzaW9uKHRhcmdldC5wYWNrYWdlUGF0aCk7XG4gIGNvbnN0IGJ1aWxkTWV0YWRhdGEgPSBnZXRCdWlsZE1ldGFkYXRhKHRhcmdldCwgY2lCdWlsZE1ldGFkYXRhKTtcbiAgY29uc3QgZXhwZWN0ZWQgPSByZW5kZXJWZXJzaW9uTW9kdWxlKHBhY2thZ2VWZXJzaW9uLCBidWlsZE1ldGFkYXRhKTtcblxuICBsZXQgY3VycmVudCA9IFwiXCI7XG4gIHRyeSB7XG4gICAgY3VycmVudCA9IGF3YWl0IERlbm8ucmVhZFRleHRGaWxlKHRhcmdldC5vdXRwdXRQYXRoKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIERlbm8uZXJyb3JzLk5vdEZvdW5kKSkge1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgaWYgKGN1cnJlbnQgPT09IGV4cGVjdGVkKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKGNoZWNrKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYFZlcnNpb24gbW9kdWxlIG91dCBvZiBkYXRlOiAke3RhcmdldC5vdXRwdXRQYXRofS4gUnVuIGRlbm8gdGFzayB2ZXJzaW9uOmdlbmVyYXRlLmAsXG4gICAgKTtcbiAgfVxuXG4gIGF3YWl0IERlbm8ud3JpdGVUZXh0RmlsZSh0YXJnZXQub3V0cHV0UGF0aCwgZXhwZWN0ZWQpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBtYWluKCkge1xuICBjb25zdCB7IGNoZWNrLCBvbmx5LCBjaUJ1aWxkTWV0YWRhdGEgfSA9IHBhcnNlQXJncyhEZW5vLmFyZ3MpO1xuICBjb25zdCB0YXJnZXRzID0gb25seSA9PT0gXCJhbGxcIlxuICAgID8gVEFSR0VUU1xuICAgIDogVEFSR0VUUy5maWx0ZXIoKHRhcmdldCkgPT4gdGFyZ2V0Lm5hbWUgPT09IG9ubHkpO1xuXG4gIGZvciAoY29uc3QgdGFyZ2V0IG9mIHRhcmdldHMpIHtcbiAgICBhd2FpdCBlbnN1cmVWZXJzaW9uTW9kdWxlKHRhcmdldCwgY2hlY2ssIGNpQnVpbGRNZXRhZGF0YSk7XG4gIH1cbn1cblxuaWYgKGltcG9ydC5tZXRhLm1haW4pIHtcbiAgdHJ5IHtcbiAgICBhd2FpdCBtYWluKCk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICBjb25zb2xlLmVycm9yKGB2ZXJzaW9uIGdlbmVyYXRpb24gZmFpbGVkOiAke21lc3NhZ2V9YCk7XG4gICAgRGVuby5leGl0KDEpO1xuICB9XG59XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7OztDQVNDLEdBYUQsTUFBTSxVQUE0QjtFQUNoQztJQUNFLE1BQU07SUFDTixhQUFhLElBQUksSUFBSSxpQ0FBaUMsWUFBWSxHQUFHO0lBQ3JFLFlBQVksSUFBSSxJQUFJLHVDQUF1QyxZQUFZLEdBQUc7SUFDMUUsZ0JBQWdCO0VBQ2xCO0VBQ0E7SUFDRSxNQUFNO0lBQ04sYUFBYSxJQUFJLElBQUksaUNBQWlDLFlBQVksR0FBRztJQUNyRSxZQUFZLElBQUksSUFBSSxtQ0FBbUMsWUFBWSxHQUFHO0lBQ3RFLGdCQUFnQjtFQUNsQjtFQUNBO0lBQ0UsTUFBTTtJQUNOLGFBQWEsSUFBSSxJQUFJLGlDQUFpQyxZQUFZLEdBQUc7SUFDckUsWUFBWSxJQUFJLElBQUksbUNBQW1DLFlBQVksR0FBRztJQUN0RSxnQkFBZ0I7RUFDbEI7Q0FDRDtBQUVELHdFQUF3RTtBQUN4RSxzRUFBc0U7QUFDdEUsTUFBTSxlQUFlO0FBQ3JCLDhFQUE4RTtBQUM5RSxtRUFBbUU7QUFDbkUsTUFBTSx1QkFBdUI7QUFDN0IsTUFBTSwwQkFBMEIsTUFBTSxLQUFLLFlBQVksQ0FDckQsSUFBSSxJQUFJLDBDQUEwQyxZQUFZLEdBQUc7QUFHbkUsU0FBUyxVQUFVLElBQWM7RUFDL0IsSUFBSSxRQUFRO0VBQ1osSUFBSSxPQUF5QztFQUM3QyxJQUFJLGtCQUFrQjtFQUV0QixJQUFLLElBQUksSUFBSSxHQUFHLElBQUksS0FBSyxNQUFNLEVBQUUsSUFBSztJQUNwQyxNQUFNLE1BQU0sSUFBSSxDQUFDLEVBQUU7SUFDbkIsSUFBSSxRQUFRLFdBQVc7TUFDckIsUUFBUTtNQUNSO0lBQ0Y7SUFFQSxJQUFJLFFBQVEsdUJBQXVCO01BQ2pDLGtCQUFrQjtNQUNsQjtJQUNGO0lBRUEsSUFBSSxRQUFRLFVBQVU7TUFDcEIsTUFBTSxPQUFPLElBQUksQ0FBQyxJQUFJLEVBQUU7TUFD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
// denoCacheMetadata=1178219177748363722,9414402255847805272