"use client";

import { ChannelProvider } from "@/providers/ChannelContext";
import { DashboardShell } from "@/components/dashboard-shell";
import { use } from "react";

export default function ChannelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const unwrappedParams = use(params);
  const { slug } = unwrappedParams;

  return (
    <ChannelProvider slug={slug}>
      <DashboardShell>
        {children}
      </DashboardShell>
    </ChannelProvider>
  );
}
