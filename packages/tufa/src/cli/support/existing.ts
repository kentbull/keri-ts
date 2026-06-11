/**
 * Re-export of the canonical Habery/keeper CLI startup helpers.
 *
 * The single source of truth lives under the keri package transitional CLI
 * common layer. This shim removes the prior near-duplicate copy while
 * preserving the import sites used by tufa command modules.
 */
export { type EnsuredHabery, ensureHby, setupHby } from "../../../../keri/src/app/cli/common/existing.ts";
