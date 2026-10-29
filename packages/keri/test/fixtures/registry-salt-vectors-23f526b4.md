# Registry-salt reference vectors

The adjacent JSON is an unchanged standalone synthetic fixture from workspace commit
`e5b47d2dff4711ab91a69a2331b43658ac5a8999`,
`tests/fixtures/registry-salt-23f526b4/vectors/vectors.json`.
Its SHA-256 is `96e71c217ccb595a8bc3dd46f87db016c52d429d0e06010482255126b3e86309`.
Python core is `23f526b49be5d9b03606f1563ad59958c5ab1adc`.

The generator uses public RFC 7748 DH secrets, explicit synthetic Ed25519 seeds,
fixed timestamps and RIP UUID. Actual Python Parser, Revery signature acceptance
and the historical archive verifier authenticated all twelve replies; the RIP
anchor and cipher decryption also passed. Cipher_Salt is randomized and captured
once: verify decryption and commitment, not fresh ciphertext equality.

These are valid signed local-profile wire fixtures, distinct from the intentionally
invalid reply bytes in the primitive-only KDF vector. Exact body bytes are
normative for derivation. No product or test imports the workspace or Dolly.
All fixture keys and roots are public test material, never real credential keys.
