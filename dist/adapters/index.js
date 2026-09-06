/**
 * Project adapters — generic discovery.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §2.D, §11.
 *
 * A `ProjectAdapter` returns a frozen `ProjectInfo` snapshot. It is
 * not a destructive Git wrapper. It does not execute writes. A
 * non-Git project is fully representable.
 *
 * S01: contracts only. No destructive operations. No Git mandatory.
 */
export {};
//# sourceMappingURL=index.js.map