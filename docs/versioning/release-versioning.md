# Versioning and release process

Package manifests own versions independently for cesr-ts, keri-ts and @keri-ts/tufa.
`manifest:sync` updates Deno mirrors and npm workspace-lock versions;
`manifest:check` rejects drift. `release:version` applies Changesets, synchronizes
manifests and generates runtime version modules. Ordinary generation is deterministic;
release builds explicitly add `build.<run>.<sha>` metadata.

## Prepare an authorized release

1. Work from reviewed, clean source on a topic branch. Add package Changesets for
   publishable changes; documentation/tooling-only PRs use an empty changeset.
2. Apply `deno task release:version`, then `deno task manifest:check` and
   `deno task version:check`. Inspect package dependencies and generated changes.
3. Follow the [qualification standard](../plans/qualification/QUALIFICATION_PLAN.md).
   Record exact source, reference imports, native environment and test inventory.
   Scoped PR checks are not full release qualification.
4. Build and smoke the exact packed artifacts, including strict declarations,
   >16 MiB LMDB read/reopen and owned bytes, crypto, TCP and Tufa CLI/HTTP.
   Exercise Node 20.3 and the selected current runtime. Install compiler tools
   after runtime checks so they cannot mask missing runtime dependencies.
5. Commit only explicit release paths, with an explanatory body, and merge after
   exact-head checks pass. Never stage unrelated work or publish from a dirty tree.
6. With publication authorization, create annotated `cesr-v<VERSION>`,
   `keri-v<VERSION>` and/or `tufa-v<VERSION>` tags at the verified release commit.
   Push each selected tag explicitly in dependency order CESR → KERI → Tufa,
   waiting for dependencies to become available. Do not use an unqualified
   `--follow-tags` command or rewrite a published tag.

## Workflow and artifact ownership

The three package tag workflows call
[shared npm release](../../.github/workflows/npm-release.yml). It performs
package-owned checks, builds and smokes the primary artifact, publishes that
uploaded tarball to npm, then creates the GitHub release using registry bytes.
Tufa builds supporting dependency artifacts for smoke and verifies its declared
CESR/KERI versions are already published. The shared workflow does not itself
repeat the full interoperability/manual qualification battery.

Verify every selected version's registry metadata, internal dependencies,
workflow/npm/GitHub tarball equality and final registry-only installs. A merged
version PR, built tarball or successful source test is not publication evidence.
Changesets record version intent; the Changesets version-PR workflow does not
replace the package tag publication workflows.

Publication and GitHub release creation can fail separately. Inspect which side
effects completed before recovery. Existing exact versions are skipped by the
publish helper; preserve artifact identity and original tag provenance. If a
workflow-only repair runs at another commit, record both source identities and
verify package/manifests/build inputs rather than relabeling the tag.

## Recorded baseline

The [1.0.0 qualification report](../reports/parity/CLEANUP_RELEASE_2026-10-16.md)
records the three publications, Tufa's fixture-only recovery and installed checks.
It separately records post-release Tevery ownership; those later source changes
are not included in the published packages. Future releases need fresh evidence.
