"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery }  from "convex/react";
import { api }       from "@/convex/_generated/api";
import type { Doc }  from "@/convex/_generated/dataModel";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type ChannelWithSettings = Doc<"channels"> & {
  settings: Record<string, string>;
};

export type ChannelContextValue =
  | { state: "loading"   }
  | { state: "not_found" }
  | { state: "ready"; channel: ChannelWithSettings };

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT
// One context, one source of truth.
// Never import ChannelContextProvider from a separate file —
// everything lives here.
// ─────────────────────────────────────────────────────────────────────────────

const ChannelContext = createContext<ChannelContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// WORKSPACE PROVIDER
// Mount in app/studio/layout.tsx
// No channel selected — sidebar renders in studio/overview mode.
// ─────────────────────────────────────────────────────────────────────────────

export function WorkspaceChannelProvider({ children }: { children: ReactNode }) {
  return (
    <ChannelContext.Provider value={{ state: "not_found" }}>
      {children}
    </ChannelContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL PROVIDER
// Mount in app/[slug]/layout.tsx
// Fetches channel + settings by slug once.
// All pages below read from context — never re-fetch.
// Convex keeps it reactive automatically.
// ─────────────────────────────────────────────────────────────────────────────

export function ChannelProvider({
  slug,
  children,
}: {
  slug:     string;
  children: ReactNode;
}) {
  const data = useQuery(api.channels.getChannelWithSettingsBySlug, { slug });

  const value = useMemo<ChannelContextValue>(() => {
    if (data === undefined) return { state: "loading"   };
    if (data === null)      return { state: "not_found" };
    return {
      state:   "ready",
      channel: data as ChannelWithSettings,
    };
  }, [data]);

  return (
    <ChannelContext.Provider value={value}>
      {children}
    </ChannelContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useChannelContext
 * Returns the full context value including loading/not_found states.
 * Use in layout components that need to handle all three states explicitly.
 */
export function useChannelContext(): ChannelContextValue {
  const ctx = useContext(ChannelContext);
  if (!ctx) {
    throw new Error(
      "useChannelContext must be used inside <ChannelProvider> or <WorkspaceChannelProvider>",
    );
  }
  return ctx;
}

/**
 * useChannel
 * Returns the channel doc directly — assumes state is "ready".
 * Safe inside any page under app/[slug]/ because the layout
 * only renders children after state === "ready".
 */
export function useChannel(): ChannelWithSettings {
  const ctx = useChannelContext();
  if (ctx.state !== "ready") {
    throw new Error(
      "useChannel() called before channel is ready. " +
      "Use useChannelContext() if you need to handle loading/not_found.",
    );
  }
  return ctx.channel;
}

/**
 * useChannelColor
 * Returns the channel accent hex color, with a safe indigo fallback.
 * Use anywhere you need the accent — sidebar stripe, badges, buttons.
 */
export function useChannelColor(): string {
  const ctx = useChannelContext();
  if (ctx.state !== "ready") return "#6366f1";
  return ctx.channel.color ?? "#6366f1";
}

/**
 * useChannelSetting
 * Reads a single key from channelSettings.
 * Returns undefined if not set or channel not yet loaded.
 * Used by useVoiceover (google_api_key) and useSceneMap (openai_api_key).
 */
export function useChannelSetting(key: string): string | undefined {
  const ctx = useChannelContext();
  if (ctx.state !== "ready") return undefined;
  return ctx.channel.settings[key];
}