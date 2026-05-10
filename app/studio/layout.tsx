"use client";

import { DashboardShell } from "@/components/dashboard-shell";
import { WorkspaceChannelProvider } from "@/providers/ChannelContext";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceChannelProvider>
      <DashboardShell>
        {children}
      </DashboardShell>
    </WorkspaceChannelProvider>
  );
}
