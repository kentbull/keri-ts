---
"cesr-ts": minor
"keri-ts": minor
---

Name the parsed body-plus-attachments payload CesrFrame and the frame/error
event union ParseEvent. Rename PrimitiveTuple and isPrimitiveTuple to GroupTuple
and isGroupTuple. Update KERI reexports and consumers without changing parsing
behavior. Consumers must migrate the old CesrFrame event type to ParseEvent;
the CesrFrame name now denotes the payload, so no legacy alias is provided.
