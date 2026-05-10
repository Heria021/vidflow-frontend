"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import { ChannelSwitcher } from "@/components/channel-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"

import { 
  LayoutDashboardIcon, 
  VideoIcon, 
  UsersIcon, 
  Settings2Icon, 
  ScissorsIcon, 
  FileVideoIcon,
  TrendingUpIcon,
  BotIcon
} from "lucide-react"
import { useChannelContext } from "@/providers/ChannelContext"

// Define navigation sets

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const context = useChannelContext()
  const isStudio = context.state === "not_found"
  const isReady = context.state === "ready"
  const isLoading = context.state === "loading"
  const slug = context.state === "ready" ? context.channel.slug : ""
  const pathname = usePathname()

  const isItemActive = (url: string) => {
    if (url === "#") return false
    if (pathname === url) return true
    if (url !== "/" && pathname.startsWith(url + "/")) return true
    return false
  }

  const studioNav = [
    {
      title: "Overview",
      url: "/studio",
      icon: <LayoutDashboardIcon />,
      isActive: isItemActive("/studio"),
    },
    {
      title: "All Content",
      url: "#",
      icon: <VideoIcon />,
      items: [
        { title: "Processed", url: "#" },
        { title: "Drafts", url: "#" },
        { title: "Archived", url: "#" },
      ],
    },
    {
      title: "Management",
      url: "#",
      icon: <UsersIcon />,
      items: [
        { title: "Channels list", url: "/studio" },
        { title: "Create New", url: "/channels/new" },
      ],
    },
    {
      title: "Settings",
      url: "#",
      icon: <Settings2Icon />,
      items: [
        { title: "Billing", url: "#" },
        { title: "API Keys", url: "#" },
      ],
    },
  ]

  const channelNav = [
    {
      title: "Dashboard",
      url: `/${slug}`,
      icon: <LayoutDashboardIcon />,
      isActive: isItemActive(`/${slug}`) && !pathname.includes('/projects') && !pathname.includes('/playground'),
    },
    {
      title: "Projects",
      url: `/${slug}/projects`,
      icon: <VideoIcon />,
      isActive: isItemActive(`/${slug}/projects`),
    },
    {
      title: "Studio",
      url: `/${slug}/playground`,
      icon: <BotIcon />,
      isActive: isItemActive(`/${slug}/playground`),
    },
    {
      title: "Workflows",
      url: "#",
      icon: <VideoIcon />,
      items: [
        { title: "Auto-Clips",url: `/${slug}/playground`, },
        { title: "Subtitles", url: "#" },
        { title: "B-Roll Gen", url: "#" },
      ],
    },
    {
      title: "Assets",
      url: "#",
      icon: <FileVideoIcon />,
      items: [
        { title: "Raw Footage", url: "#" },
        { title: "Generated Assets", url: "#" },
      ],
    },
    {
      title: "Editor",
      url: "#",
      icon: <ScissorsIcon />,
    },
    {
      title: "Channel Settings",
      url: "#",
      icon: <Settings2Icon />,
    },
  ]

  const projectsItems = [
    { name: "Support", url: "#", icon: <BotIcon /> },
    { name: "Roadmap", url: "#", icon: <TrendingUpIcon /> },
  ]

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <ChannelSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {isLoading ? (
          <div className="p-4 space-y-4">
             <div className="h-4 w-3/4 bg-sidebar-accent/50 animate-pulse rounded-md" />
             <div className="h-4 w-1/2 bg-sidebar-accent/50 animate-pulse rounded-md" />
             <div className="h-4 w-2/3 bg-sidebar-accent/50 animate-pulse rounded-md" />
             <div className="h-4 w-1/3 bg-sidebar-accent/50 animate-pulse rounded-md" />
          </div>
        ) : (
          <>
            <NavMain 
              items={isStudio ? studioNav : (isReady ? channelNav : [])} 
              label={isStudio ? "Studio" : "Channel"}
            />
            <NavProjects projects={projectsItems} />
          </>
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ name: "Vido User", email: "solo@vido.ai", avatar: "" }} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
