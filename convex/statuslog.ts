import { v }                from "convex/values";
import { internalMutation, query } from "./_generated/server";

// ─────────────────────────────────────────────────────────────────────────────
// statusLog.ts
//
// Append-only log of every project pipeline state transition.
//
// RULES:
//   1. Never written by the client directly.
//   2. Never edited or deleted — append only.
//   3. The only writer is logTransition (internalMutation).
//      Call it from projects.ts, renderJobs.ts via ctx.runMutation().
//   4. Queries here are read-only and exposed to the UI for the
//      activity timeline / debug panel.
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL WRITE — the one and only writer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * logTransition
 * Appends one row to statusLog.
 * Called exclusively from transitionStatus() in projects.ts and
 * from renderJobs.ts status updates.
 *
 * durationMs is auto-calculated when fromStatus + a previous log row exist.
 * Pass metadata as a plain object — it will be JSON-stringified here so
 * callers never have to remember to stringify themselves.
 */
export const logTransition = internalMutation({
  args: {
    projectId:   v.id("projects"),
    fromStatus:  v.optional(v.string()),
    toStatus:    v.string(),
    triggeredBy: v.union(
      v.literal("user"),
      v.literal("system"),
      v.literal("renderer"),
    ),
    note:        v.optional(v.string()),
    metadata:    v.optional(v.any()),   // plain object — stringified below
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Auto-calculate durationMs: time since the last log row for this project.
    // This gives you "time spent in previous status" for free.
    let durationMs: number | undefined;
    if (args.fromStatus) {
      const lastRow = await ctx.db
        .query("statusLog")
        .withIndex("by_project_created", q => q.eq("projectId", args.projectId))
        .order("desc")
        .first();

      if (lastRow) {
        durationMs = now - lastRow.createdAt;
      }
    }

    await ctx.db.insert("statusLog", {
      projectId:   args.projectId,
      fromStatus:  args.fromStatus,
      toStatus:    args.toStatus,
      triggeredBy: args.triggeredBy,
      note:        args.note,
      durationMs,
      metadata:    args.metadata !== undefined
        ? JSON.stringify(args.metadata)
        : undefined,
      createdAt:   now,
    });
  },
});


// ─────────────────────────────────────────────────────────────────────────────
// READS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getProjectLog
 * Full transition history for a project, oldest → newest.
 * Used by the activity timeline / debug panel in the UI.
 */
export const getProjectLog = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("statusLog")
      .withIndex("by_project_created", q => q.eq("projectId", projectId))
      .order("asc")
      .collect();
  },
});

/**
 * getLatestTransition
 * Most recent log row for a project.
 * Useful for showing "last activity" in the project list without
 * fetching the full log.
 */
export const getLatestTransition = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("statusLog")
      .withIndex("by_project_created", q => q.eq("projectId", projectId))
      .order("desc")
      .first();
  },
});