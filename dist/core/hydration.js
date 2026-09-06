/**
 * Portable core — hydration text + payload discriminator.
 *
 * Authority: docs/CMV3_PORTABLE_ARCHITECTURE_FREEZE.md §7, §10.
 *
 * The new session receives ONLY a deterministic hydration text
 * derived from the MinimalHandoff. The text is trusted PICM
 * continuation state. It MUST NOT contain:
 *
 *   - the full Checkpoint
 *   - the old transcript
 *   - raw ToolResult payload
 *   - old file contents
 *   - old test output
 *   - raw historical diagnostics
 *
 * Errors / tool evidence appear ONLY as `recovery_refs`. The new
 * session can `picm_recover <ref>` to load a ref on demand.
 *
 * This module is pure: it takes a validated MinimalHandoff and
 * returns a deterministic text + a `recovery_refs` array. It
 * never imports Pi, never imports the store, never reads files.
 */
/**
 * Build a hydration text from a MinimalHandoff. The structure is
 * stable; the order of fields is fixed. The text begins with a
 * marker that the new session can grep for to confirm it received
 * the structured continuation rather than a transcript.
 */
export function buildHydrationPayload(handoff) {
    const refList = handoff.recovery_refs.length === 0
        ? "(none)"
        : handoff.recovery_refs.map((r) => `- kind=${r.kind} id=${r.id} uri=${r.uri}`).join("\n");
    const fileList = handoff.current_files.length === 0
        ? "(none)"
        : handoff.current_files.map((f) => `- ${f}`).join("\n");
    const decisionList = handoff.important_decisions.length === 0
        ? "(none)"
        : handoff.important_decisions.map((d) => `- ${d}`).join("\n");
    const constraintList = handoff.hard_constraints.length === 0
        ? "(none)"
        : handoff.hard_constraints.map((c) => `- ${c}`).join("\n");
    const blockerList = handoff.blockers.length === 0
        ? "(none)"
        : handoff.blockers.map((b) => `- ${b}`).join("\n");
    const errorList = handoff.active_errors.length === 0
        ? "(none)"
        : handoff.active_errors.map((e) => `- ${e}`).join("\n");
    const nextActionList = handoff.next_actions.length === 0
        ? "(none)"
        : handoff.next_actions.map((n) => `- ${n}`).join("\n");
    const gitBlock = handoff.git_state.repository
        ? [
            `Repository: ${handoff.git_state.repository}`,
            `Branch: ${handoff.git_state.branch ?? "(detached)"}`,
            `HEAD: ${handoff.git_state.head ?? "(none)"}`,
            `Dirty: ${handoff.git_state.dirty === null ? "(unknown)" : handoff.git_state.dirty ? "yes" : "no"}`,
        ].join("\n")
        : "(non-Git project)";
    const text = [
        "<!-- PICM:HYDRATION v1 -->",
        "<!-- source: minimal_handoff -->",
        "<!-- DO NOT EDIT THIS BLOCK; it is the durable continuation state. -->",
        "",
        "# Goal",
        handoff.goal,
        "",
        "# Work package",
        handoff.work_package,
        "",
        "# Status",
        handoff.status,
        "",
        "# Important decisions",
        decisionList,
        "",
        "# Hard constraints",
        constraintList,
        "",
        "# Current files",
        fileList,
        "",
        "# Blockers",
        blockerList,
        "",
        "# Active errors",
        errorList,
        "",
        "# Git state",
        gitBlock,
        "",
        "# Next actions",
        nextActionList,
        "",
        "# Recovery references",
        refList,
        "",
        "<!-- PICM:HYDRATION END -->",
        "",
        "PICM directive:",
        "- Continue the work package named above.",
        "- Use only the structured fields in this block as continuation state.",
        "- For older detail (transcripts, raw tool output, full checkpoints), call `picm_recover <ref>` with a recovery_ref.",
        "- Do not paste the prior conversation into the new context.",
    ].join("\n");
    return { text, recovery_refs: handoff.recovery_refs };
}
/**
 * Detect a payload that contains raw transcript-like text. The
 * orchestrator uses this to reject hand-crafted handoffs that
 * try to smuggle a transcript into the hydration. The check is
 * heuristic: it scans for the typical Pi system-prompt / user
 * turn markers.
 */
export function looksLikeTranscriptPayload(text) {
    const t = text.toLowerCase();
    if (t.includes("<user>") && t.includes("</user>"))
        return true;
    if (t.includes("<assistant>") && t.includes("</assistant>"))
        return true;
    if (t.includes("system:") && t.includes("user:"))
        return true;
    return false;
}
//# sourceMappingURL=hydration.js.map