import sodium from "npm:libsodium-wrappers-sumo@0.8.4";

// One initialized backend serves derivation and sealed boxes; no JS derived-secret cache is kept here.
// Existing primitive APIs remain synchronous after their module dependency has initialized.
await sodium.ready;
export default sodium;
