/**
 * Portable CMV3 — top-level public surface.
 *
 * S01 exports the portable core, the Pi runtime no-op entrypoint,
 * and the project adapters. Runtime behavior is intentionally NOT
 * implemented in S01; this WP validates packaging only.
 */

export * as core from "./core/index.js";
export * as pi from "./pi/index.js";
export * as adapters from "./adapters/index.js";
