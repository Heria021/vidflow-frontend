"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";


import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  ChevronsUpDownIcon,
  PlusIcon,
  LayoutDashboardIcon,
  RadioIcon,
  CheckIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useChannelColor, useChannelContext } from "@/providers/ChannelContext";

export function ChannelSwitcher() {
  const router = useRouter();
  const { isMobile } = useSidebar();
  const channels = useQuery(api.channels.listChannels) ?? [];
  const context = useChannelContext();
  const accentColor = useChannelColor();

  const isStudio = context.state === "not_found";
  const isLoading = context.state === "loading";
  const activeChannel = context.state === "ready" ? context.channel : null;

  const handleSwitch = (slug: string | null) => {
    if (slug) {
      localStorage.setItem("lastChannel", slug);
      router.push(`/${slug}`);
    } else {
      router.push("/studio");
    }
  };

  // Keyboard shortcuts ⌘1–⌘9
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !isNaN(Number(e.key))) {
        const index = Number(e.key) - 1;
        if (index >= 0 && index < channels.length) {
          e.preventDefault();
          handleSwitch(channels[index].slug);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [channels]);

  if (isLoading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div className="flex items-center gap-3 p-2">
            <div className="h-8 w-8 rounded-lg bg-sidebar-accent/50 animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-16 bg-sidebar-accent/50 animate-pulse rounded" />
              <div className="h-2 w-24 bg-sidebar-accent/50 animate-pulse rounded" />
            </div>
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  {isStudio ? (
                    <LayoutDashboardIcon className="size-4" />
                  ) : (
                    <RadioIcon className="size-4" />
                  )}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold uppercase tracking-tight">
                      {isStudio ? "Studio" : activeChannel?.name}
                    </span>
                    {!isStudio && (
                      <div 
                        className="size-2 rounded-full shrink-0" 
                        style={{ backgroundColor: accentColor }}
                      />
                    )}
                  </div>
                  <span className="truncate text-[10px] text-muted-foreground font-medium">
                    {isStudio ? "Personal AI Studio" : "Channel Mode"}
                  </span>
                </div>
                <ChevronsUpDownIcon className="ml-auto size-4 opacity-50" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuItem
              onClick={() => handleSwitch(null)}
              className="gap-2 p-2"
            >
              <div className={cn(
                "flex size-6 items-center justify-center rounded-md border",
                isStudio ? "bg-accent text-accent-foreground" : "bg-background"
              )}>
                <LayoutDashboardIcon className="size-4" />
              </div>
              <span className="font-medium">Studio</span>
              {isStudio && <CheckIcon className="ml-auto size-4" />}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 py-1.5 text-xs text-muted-foreground font-medium">
                Your Channels
              </DropdownMenuLabel>
              {channels.map((channel, index) => (
                <DropdownMenuItem
                  key={channel._id}
                  onClick={() => handleSwitch(channel.slug)}
                  className="gap-2 p-2"
                >
                  <div 
                    className="size-2 rounded-full shrink-0" 
                    style={{ backgroundColor: channel.color || "#6366f1" }}
                  />
                  <span className="flex-1 truncate">{channel.name}</span>
                  {index < 9 && (
                    <DropdownMenuShortcut className="ml-1 text-[10px] opacity-70">
                      ⌘{index + 1}
                    </DropdownMenuShortcut>
                  )}
                  {activeChannel?._id === channel._id && (
                    <div 
                      className="size-2 rounded-full ml-1" 
                      style={{ backgroundColor: channel.color || "#6366f1" }}
                    />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuItem 
              onClick={() => router.push("/channels/new")}
              className="gap-2 p-2 text-muted-foreground"
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <PlusIcon className="size-4" />
              </div>
              <div className="font-medium">New Channel</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
