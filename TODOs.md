# TODOs

Things to come back and do at some point:

## Architecture

- The current `Habery.kevery -> Hab.kevery` raw injection is an intentional
  first-pass cleanup that keeps local habitat processing close to the KERIpy
  mental model. Revisit a narrower habery-owned local-processing facade once
  local/runtime ownership and cue consumers settle further.
- Keep the dual cue-scope model honest: `Habery.kevery` owns local habitat cues
  while runtime hosts wire shared cues into `Reactor`, `Revery`, and the
  runtime-owned `Kevery`. Do not collapse those scopes without a stronger
  KERIpy-driven reason.

- Ensure all docs talking about bootstrap-only seams or partial impls are
  refactored once we have the full functionality implemented for a given
  feature.
  - We will likely have to come back to do a final documentation pass comparing
    all docs on all functions, classes, methods, constants, and so forth to
    their KERIpy equivalents to ensure everything is properly documented.
- make sure logging works properly including switching between levels.
- add an interop test on passcode properly working between KERIpy and keri-ts
- do a repo-wide pass over the remaining higher-level DB consumers beyond
  `Baser` to separate real upstream parity opportunities from false-cleanup
  temptations.
- consider changing the Habery impl. or otherwise to have functions like `saveOobi`
  rather than having something like processOobiJob reach down into the DB layer to
  call db.oobis.pin directly. That is something that should be hidden by an
  abstraction layer.
  - See the loc.ts for hby.db.locs.get and the like and consider Habery or Hab functions
    that abstract over DB shape so we can easily switch between LMDB and IndexedDB or other DB.
- Does it really make sense to use Reflection based method dispatch in the Router and
  Revery? This doesn't smell right for Typescript and should be refactored. It seems
  like there should be a compile-time stable dispatch map with a lookup based on
  reply message type.
- How closely is our Oobiery storing Obr records and the like in our LMDB?
  Have we made any divergences that are unjustified? We should use the KERIpy model unless
  we have a really good reason not to.
- look through the cues and determine whether they properly map to KERIpy cues.
  Build a cue mapping table and make sure that we are cue by cue compatible with KERIpy's mental model.
- Why is our reply construction function not doing both v1 and v2? It appears to only be v1 compatible.
- We need full instructions on how to use the new endpoint role addition and location scheme addition
- Reconsider the records.ts and dispatch.ts class and type names. Maybe they should be renamed or tweaked.
- Look at why cues are filtered in KERIpy and determine why they are filtered and what we
  need to mimic there, if at all.
- Make Komer type system simple as possible with as few generics as possible.
- Look at collapsing the types like PreSitShape and PreSit

## Missing interop tests

- delegation cross between kli and tufa and tufa and kli

## Missing

- explicit v2 support
- mailbox listener, exposed OOBI endpoint (cURLable), OOBI generate and resolve e2e flow

## Review Queue

- endpoint add
- endpoint generate
- reply message generate
- oobi generate
- oobi resolve
- agent server
- agent works as mailbox?
- eventing Kevery.processInception -> Where's the Kever?
- routing.ts
- Kever functions
  - constructor
  - reload
  - incept
  - config
  - update
  - logEvent
  - validateSignatures
- Manager (all functions)
- eventing.ts
- eventing.test.ts
- kever-decisions.ts
- Encrypter/Decrypter, CryptSignerSuber, and Manager integration
- all the graduated disclosure stuff in structor.ts
- querying.ts
  - eventing.ts
    - processReplyAddWatched
    - updateWatched
- router.addRoute("/watcher/{aid}/{action}", this, "AddWatched");
- Exchanger implementation (very lightly reviewed, needs a full read through and challenging of code)
- challenge response code
- exchange tufa command
- Authenticator & well known OOBIs
  - all these new OOBI functions. are they really justified and are they properly keri-ts native?
  - all the new Oobiery functions for multi OOBIs and well knowns
