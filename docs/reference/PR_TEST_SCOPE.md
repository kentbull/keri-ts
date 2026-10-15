# PR test scope

Use one `keri-ci` JSON block in a same-repository PR description to select the
checks relevant to its change. Static checks and changeset validation always run.
Without a block, the existing changed-path defaults apply. Fork descriptions
cannot reduce those defaults.

After the relevant unit tests pass locally on the exact committed source:

````markdown
```keri-ci
{"unit":{"local":"REPLACE_WITH_40_CHARACTER_PR_HEAD_SHA"},"interop":[],"package":false}
```
````

The local field attests that the selected change's unit checks passed; describe
commands, results and environment in the PR's validation prose. A new head needs
fresh applicable local validation and an updated SHA. Stale credit fails the
selection job. Keep interop or package checks when the change needs them.

To run selected maintained owners in CI instead:

````markdown
```keri-ci
{"unit":["core-fast-a","tufa"],"interop":["interop-delegation"],"package":false}
```
````

Unit choices are the existing `required` owners in
[suite inventory](../../scripts/ci/keri-test-suites.ts), plus `ci` (all KERI
required owners), `tufa`, `cesr` and `ci-tools` (the scope contract tests). Interop choices are the concrete owners in
`extended-interop`. No new inventory, arbitrary command or test-name filtering is
introduced. Existing suite isolation and participant topology remain in force.
Empty arrays explicitly select no owners for that lane.

For the periodic broad run, use:

````markdown
```keri-ci
{"full":true}
```
````

Full mode runs all required KERI owners, Tufa, CESR, every maintained extended
interop owner and installed-package smoke tests. Interop owners run in separate
jobs with their existing 25-minute PR cap. This is the broad PR battery; manual
endurance and final clean-source release qualification remain separate gates.
During the cleanup goal, select full mode about every 20 implementation PRs,
and fix regressions before proceeding. This cadence does not replace relevant
checks on each PR or the full final release qualification.

The selector reads the current PR description through the API on every run.
After editing only the block, rerun the workflow with `gh run rerun RUN_ID` or
GitHub's Re-run all jobs button. Ordinary description edits do not trigger or
cancel tests. Source pushes still trigger fresh checks. Marking a draft ready does
not rerun an unchanged head; explicitly rerun when its scope or validation needs
to change. A rerun whose PR head
has moved is refused; use the current source run. See GitHub's
[rerun behavior](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).
The selection job records the exact head and resolved scope in its summary.
A skipped lane is scoped validation, never a claim that its tests ran.
