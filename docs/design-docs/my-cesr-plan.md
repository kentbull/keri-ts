# CESR parser and primitives impl high level plan

1. The Flow from cesrixir (Generators).
2. The Logic from keripy (Parsator mechanics).
3. The Types from parside (Discriminated Unions).
4. The Tables from cesr-decoder (Schema-driven).
5. The Speed from cesride (Zero-copy Matter).

## Design Goals

1. Use structured concurrency everywhere, frontend, backend, database, and
   throughout. This means Effection in KERI TS. We will use Effection patterns
   to wrap JavaScript Promises as needed.
2. Seamless 1:1 integration with the KERIpy keystore format. We will mimic as
   closely as possible the behavior of the KERIpy database layer so we have a 1
   to 1 ability to save and read data from a KERIpy LMDB keystore that can also
   be used by KERIpy seamlessly. This means we use LMDB for the Node/Deno server
   or local environment and mimic all of the Suber style classes and the key
   types that KERIpy uses.
3. IndexedDB for the browser's backing key value store.
4. Mimic or improve upon the KERIpy code tables and cryptographic primitive
   implementation, and use the best ideas from SignifyTS/CESR TS and kerits.
5. Be a full fledged KERI, ACDC, CESR, and did:webs implementation.
6. Structure each major protocol implementation as a separate package that
   builds one on the other. This means CESR at the bottom, the cryptographic
   primitives above that, then KERI next, ACDC next, and finally did:webs.
7. Support CESR 1.0 and 2.0 fully, with a full suite of test vectors.
