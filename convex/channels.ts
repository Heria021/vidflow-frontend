import { v }            from "convex/values";
import { ConvexError }  from "convex/values";
import {
  query,
  mutation,
  internalMutation,
}                        from "./_generated/server";
import {
  DEFAULT_VOICE_CONFIG,
  DEFAULT_RENDER_CONFIG,
}                        from "./schema";
import type {
  VoiceConfig,
  RenderConfig,
}                        from "./schema";
import type {
  MutationCtx,
  QueryCtx,
}                        from "./_generated/server";
import { Id }           from "./_generated/dataModel";

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATORS (re-used across args)
// ─────────────────────────────────────────────────────────────────────────────

const voiceConfigV = v.object({
  voiceName:    v.string(),
  voiceModel:   v.string(),
  languageCode: v.string(),
  speakingRate: v.number(),
  pitch:        v.number(),
  volumeGainDb: v.number(),
  encoding:     v.union(
    v.literal("MP3"),
    v.literal("LINEAR16"),
    v.literal("OGG_OPUS"),
  ),
});

const renderConfigV = v.object({
  resolution: v.union(v.literal("720p"), v.literal("1080p"), v.literal("4K")),
  fps:        v.union(v.literal(24), v.literal(30), v.literal(60)),
  format:     v.union(v.literal("mp4"), v.literal("webm")),
});


// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// These are plain TypeScript functions — not exported as Convex functions.
// Call them from within mutations/queries in this file only.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * slugify
 * Converts a human-readable name to a url-safe slug.
 *   "Tech Reviews"  → "tech-reviews"
 *   "  My  Channel" → "my-channel"
 *   "AI & ML 101"   → "ai-ml-101"
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")   // strip non-alphanumeric (keep spaces + hyphens)
    .replace(/[\s]+/g, "-")          // collapse whitespace → hyphens
    .replace(/-{2,}/g, "-")          // collapse multiple hyphens
    .replace(/^-+|-+$/g, "");        // trim leading/trailing hyphens
}

/**
 * assertSlugUnique
 * Throws a ConvexError if the slug is already taken by another channel.
 * Pass `excludeId` when updating to allow the channel to keep its own slug.
 */
async function assertSlugUnique(
  ctx:       QueryCtx | MutationCtx,
  slug:      string,
  excludeId?: Id<"channels">,
): Promise<void> {
  const existing = await ctx.db
    .query("channels")
    .withIndex("by_slug", q => q.eq("slug", slug))
    .first();

  if (existing && existing._id !== excludeId) {
    throw new ConvexError(`A channel with the slug "${slug}" already exists.`);
  }
}

/**
 * seedDefaultSettings
 * Called inside createChannel.
 * Inserts a "python_backend_url" row if the env var is set.
 * Add more seeds here as the app grows — keep the list authoritative.
 */
async function seedDefaultSettings(
  ctx:       MutationCtx,
  channelId: Id<"channels">,
): Promise<void> {
  const now = Date.now();

  // Pull from Convex env vars (set in the Convex dashboard → Settings → Env)
  const pythonUrl = process.env.PYTHON_BACKEND_URL;
  if (pythonUrl) {
    await ctx.db.insert("channelSettings", {
      channelId,
      key:       "python_backend_url",
      value:     pythonUrl,
      updatedAt: now,
    });
  }

  // Future seeds go here, e.g.:
  // const openaiKey = process.env.OPENAI_API_KEY;
  // if (openaiKey) { ... }
}


// ─────────────────────────────────────────────────────────────────────────────
// READS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * hasAnyChannel
 * The app-lifecycle gate. Returns true if at least one non-archived channel
 * exists. Used on first load to decide: "create first channel" vs dashboard.
 */
export const hasAnyChannel = query({
  args: {},
  handler: async (ctx) => {
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_created")
      .filter(q => q.eq(q.field("archivedAt"), undefined))
      .first();
    return channel !== null;
  },
});

/**
 * listChannels
 * All non-archived channels, sorted by createdAt ascending (oldest first).
 * Used to populate the sidebar / channel switcher.
 */
export const listChannels = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("channels")
      .withIndex("by_created")
      .filter(q => q.eq(q.field("archivedAt"), undefined))
      .order("asc")
      .collect();
  },
});

/**
 * getChannel
 * Single channel by _id. Returns null if not found.
 */
export const getChannel = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    return await ctx.db.get(channelId);
  },
});

/**
 * getChannelBySlug
 * Single channel by slug (used for URL routing: /channels/[slug]).
 * Returns null if not found.
 */
export const getChannelBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query("channels")
      .withIndex("by_slug", q => q.eq("slug", slug))
      .first();
  },
});

/**
 * getChannelWithSettings
 * Returns the channel doc + all its channelSettings rows merged into a flat
 * key→value map. One round-trip for the settings page.
 *
 * Shape:
 * {
 *   ...channelDoc,
 *   settings: { python_backend_url: "http://localhost:8000", ... }
 * }
 */
export const getChannelWithSettings = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) return null;

    const rows = await ctx.db
      .query("channelSettings")
      .withIndex("by_channel", q => q.eq("channelId", channelId))
      .collect();

    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    return { ...channel, settings };
  },
});

/**
 * getChannelWithSettingsBySlug
 * Returns the channel by slug + all its channelSettings rows merged into a flat
 * key→value map. Used for URL routing: /channels/[slug].
 *
 * Shape:
 * {
 *   ...channelDoc,
 *   settings: { python_backend_url: "http://localhost:8000", ... }
 * }
 */
export const getChannelWithSettingsBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_slug", q => q.eq("slug", slug))
      .first();

    if (!channel) return null;

    const rows = await ctx.db
      .query("channelSettings")
      .withIndex("by_channel", q => q.eq("channelId", channel._id))
      .collect();

    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    return { ...channel, settings };
  },
});


// ─────────────────────────────────────────────────────────────────────────────
// WRITES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createChannel
 * Validates slug uniqueness (auto-generates from name if not provided),
 * inserts the channel with default voice + render configs, and seeds
 * channelSettings from env vars.
 */
export const createChannel = mutation({
  args: {
    name:         v.string(),
    slug:         v.optional(v.string()),  // auto-derived from name if omitted
    description:  v.optional(v.string()),
    color:        v.optional(v.string()),
    defaultVoice: v.optional(voiceConfigV),
    defaultRender:v.optional(renderConfigV),
  },
  handler: async (ctx, args) => {
    const now  = Date.now();
    const slug = slugify(args.slug ?? args.name);

    if (!slug) {
      throw new ConvexError("Channel name must produce a valid slug.");
    }

    await assertSlugUnique(ctx, slug);

    const channelId = await ctx.db.insert("channels", {
      name:          args.name.trim(),
      slug,
      description:   args.description?.trim(),
      color:         args.color,
      defaultVoice:  args.defaultVoice  ?? DEFAULT_VOICE_CONFIG,
      defaultRender: args.defaultRender ?? DEFAULT_RENDER_CONFIG,
      createdAt:     now,
      updatedAt:     now,
    });

    await seedDefaultSettings(ctx, channelId);

    return channelId;
  },
});

/**
 * updateChannel
 * Updates name, slug, description, and/or color.
 * Re-validates slug uniqueness if the slug changed.
 */
export const updateChannel = mutation({
  args: {
    channelId:   v.id("channels"),
    name:        v.optional(v.string()),
    slug:        v.optional(v.string()),
    description: v.optional(v.string()),
    color:       v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new ConvexError("Channel not found.");

    const patch: Partial<typeof channel> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      patch.name = args.name.trim();
    }

    if (args.slug !== undefined) {
      const newSlug = slugify(args.slug);
      if (!newSlug) throw new ConvexError("Slug must not be empty.");
      if (newSlug !== channel.slug) {
        await assertSlugUnique(ctx, newSlug, args.channelId);
      }
      patch.slug = newSlug;
    }

    if (args.description !== undefined) {
      patch.description = args.description.trim() || undefined;
    }

    if (args.color !== undefined) {
      patch.color = args.color || undefined;
    }

    await ctx.db.patch(args.channelId, patch);
    return args.channelId;
  },
});

/**
 * updateChannelDefaults
 * Updates defaultVoice and/or defaultRender independently.
 * The settings page saves these with separate form submissions,
 * so we accept either or both.
 * Does NOT affect any existing project configs.
 */
export const updateChannelDefaults = mutation({
  args: {
    channelId:     v.id("channels"),
    defaultVoice:  v.optional(voiceConfigV),
    defaultRender: v.optional(renderConfigV),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new ConvexError("Channel not found.");

    if (!args.defaultVoice && !args.defaultRender) {
      throw new ConvexError("At least one of defaultVoice or defaultRender must be provided.");
    }

    const patch: Record<string, VoiceConfig | RenderConfig | number> = {
      updatedAt: Date.now(),
    };

    if (args.defaultVoice)  patch.defaultVoice  = args.defaultVoice;
    if (args.defaultRender) patch.defaultRender = args.defaultRender;

    await ctx.db.patch(args.channelId, patch);
    return args.channelId;
  },
});

/**
 * archiveChannel
 * Soft-deletes a channel by setting archivedAt.
 * Guard: refuses if the channel has any active (non-deleted) projects.
 */
export const archiveChannel = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError("Channel not found.");
    if (channel.archivedAt) throw new ConvexError("Channel is already archived.");

    // Guard: no active projects
    const activeProject = await ctx.db
      .query("projects")
      .withIndex("by_channel_active", q =>
        q.eq("channelId", channelId).eq("deletedAt", undefined),
      )
      .first();

    if (activeProject) {
      throw new ConvexError(
        "Cannot archive a channel with active projects. " +
        "Delete or move all projects first.",
      );
    }

    await ctx.db.patch(channelId, { archivedAt: Date.now(), updatedAt: Date.now() });
    return channelId;
  },
});

/**
 * restoreChannel
 * Clears archivedAt, making the channel active again.
 */
export const restoreChannel = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError("Channel not found.");
    if (!channel.archivedAt) throw new ConvexError("Channel is not archived.");

    await ctx.db.patch(channelId, {
      archivedAt: undefined,
      updatedAt:  Date.now(),
    });
    return channelId;
  },
});

/**
 * deleteChannel
 * HARD delete. Only allowed when:
 *   1. The channel is archived (archivedAt is set), AND
 *   2. Zero projects of any kind remain (including soft-deleted ones).
 *
 * Also hard-deletes all channelSettings rows for the channel.
 */
export const deleteChannel = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError("Channel not found.");

    // Belt: must be archived first
    if (!channel.archivedAt) {
      throw new ConvexError(
        "Channel must be archived before it can be permanently deleted.",
      );
    }

    // Suspenders: zero projects — including soft-deleted ones
    const anyProject = await ctx.db
      .query("projects")
      .withIndex("by_channel", q => q.eq("channelId", channelId))
      .first();

    if (anyProject) {
      throw new ConvexError(
        "Cannot permanently delete a channel that still has projects. " +
        "Hard-delete all projects first.",
      );
    }

    // Clean up channelSettings rows
    const settings = await ctx.db
      .query("channelSettings")
      .withIndex("by_channel", q => q.eq("channelId", channelId))
      .collect();

    for (const row of settings) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.delete(channelId);
    return channelId;
  },
});


// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * upsertChannelSetting
 * Insert or update a single key/value row for a channel.
 * Passing an empty string for value is valid (explicit clear without delete).
 */
export const upsertChannelSetting = mutation({
  args: {
    channelId: v.id("channels"),
    key:       v.string(),
    value:     v.string(),
  },
  handler: async (ctx, { channelId, key, value }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError("Channel not found.");

    const existing = await ctx.db
      .query("channelSettings")
      .withIndex("by_channel_and_key", q =>
        q.eq("channelId", channelId).eq("key", key),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { value, updatedAt: Date.now() });
      return existing._id;
    } else {
      return await ctx.db.insert("channelSettings", {
        channelId,
        key,
        value,
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * upsertChannelSettings
 * Batch version — saves the whole settings form in one mutation.
 * Entries is an array of { key, value } pairs.
 */
export const upsertChannelSettings = mutation({
  args: {
    channelId: v.id("channels"),
    entries:   v.array(v.object({ key: v.string(), value: v.string() })),
  },
  handler: async (ctx, { channelId, entries }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError("Channel not found.");

    const now = Date.now();

    for (const { key, value } of entries) {
      const existing = await ctx.db
        .query("channelSettings")
        .withIndex("by_channel_and_key", q =>
          q.eq("channelId", channelId).eq("key", key),
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, { value, updatedAt: now });
      } else {
        await ctx.db.insert("channelSettings", { channelId, key, value, updatedAt: now });
      }
    }

    return channelId;
  },
});

/**
 * getChannelSetting
 * Single key lookup. Returns the value string or null if the key doesn't exist.
 */
export const getChannelSetting = query({
  args: {
    channelId: v.id("channels"),
    key:       v.string(),
  },
  handler: async (ctx, { channelId, key }) => {
    const row = await ctx.db
      .query("channelSettings")
      .withIndex("by_channel_and_key", q =>
        q.eq("channelId", channelId).eq("key", key),
      )
      .first();
    return row?.value ?? null;
  },
});

/**
 * deleteChannelSetting
 * Removes a key/value row, effectively falling back to the env-var default.
 * Silently succeeds if the key didn't exist.
 */
export const deleteChannelSetting = mutation({
  args: {
    channelId: v.id("channels"),
    key:       v.string(),
  },
  handler: async (ctx, { channelId, key }) => {
    const row = await ctx.db
      .query("channelSettings")
      .withIndex("by_channel_and_key", q =>
        q.eq("channelId", channelId).eq("key", key),
      )
      .first();

    if (row) {
      await ctx.db.delete(row._id);
    }
    // Silent no-op if not found — idempotent
  },
});