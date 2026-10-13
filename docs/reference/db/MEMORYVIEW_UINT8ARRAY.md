# Python memoryview and JavaScript byte ownership

A Uint8Array type does not establish zero-copy database access. In the current
LMDBer implementation, getVal calls the binding's get and then copyDbBytes;
the row has already been materialized before higher-level length checks.
The former claim of default equivalence to Python buffers=True was incorrect.

| Operation                    | Ownership effect                                   |
| ---------------------------- | -------------------------------------------------- |
| Uint8Array.subarray          | Borrows the original backing allocation            |
| new Uint8Array(existingView) | Copies the visible bytes                           |
| TextDecoder.decode           | Produces text; does not retain byte-view semantics |
| TextEncoder.encode           | Allocates encoded bytes                            |

Python memoryview can borrow mapped/transaction-owned bytes when requested by
the binding. Its lifetime rules do not automatically transfer to a JavaScript
binding. Inspect the actual accessor and transaction contract before retaining a
view. A small subarray can pin a large allocation; Uint8Array is not intrinsically
read-only. Read-only borrowed payloads are an application contract.

Copy when ownership or mutation requires it, reserve before copying and release
borrowed access before its owner closes. Do not add copies merely from a type name.
Whole-row pre-allocation admission remains open in the
[storage plan](../../plans/db/STORAGE_RECOVERY_PLAN.md), coordinated with shared
runtime accounting. See the [DB contract](../../design-docs/db/db-architecture.md).
