import { mutation }  from "./_generated/server";
import { v }         from "convex/values";

/**
 * generateUploadUrl
 * Returns a Convex storage upload URL for direct client uploads.
 * Used by useSceneMap for custom image uploads.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * getStorageUrl
 * Returns the serving URL for a storage object by ID.
 * After uploading a file, call this to get the public URL.
 */
export const getStorageUrl = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId);
  },
});
