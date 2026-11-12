---
"keri-ts": minor
"@keri-ts/tufa": patch
---

Add runtime-owned single-signature IPEX presentation to `keri-ts/runtime`. `present` is the user's one consent: it signs an Offer, Grant, Apply, Agree or Spurn (a Grant may anchor its presentation proof under the same consent), takes it into local intake and returns after local commit. `PresentationOperations.processOnce` delivers the signed bytes, retries a failed delivery and ends the operation at the Grant's original deadline; it never signs, and a restarted process reads `interrupted`. `presentationStatus` is a pure read that includes the peer's stored answer, `waitForPresentation` only observes, and `preparePresentation` returns the signed bytes for a host that files them. `tufa ipex offer|grant|apply|agree|spurn --acdc-v2` call the library with unchanged flags, output, wire order and error text; group identifiers keep their existing CLI branches.
