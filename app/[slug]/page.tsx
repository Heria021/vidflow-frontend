"use client";


import { useChannelContext } from "@/providers/ChannelContext";


export default function ChannelPage() {
  const context = useChannelContext();

  if (context.state === "loading") {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-muted-foreground">Loading channel...</div>
      </div>
    );
  }

  if (context.state === "not_found") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <h1 className="text-4xl font-bold text-destructive">404</h1>
        <p className="text-muted-foreground">Channel not found</p>
      </div>
    );
  }

  const { channel } = context;

  return (
    <>
      <div className="grid auto-rows-min gap-4 md:grid-cols-3">
        <div className="aspect-video rounded-xl bg-muted/50 border flex flex-col items-center justify-center p-6 text-center">
           <div className="size-4 rounded-full mb-2" style={{ backgroundColor: channel.color || "#6366f1" }} />
           <div className="font-semibold">{channel.name}</div>
           <div className="text-xs text-muted-foreground">Active Channel</div>
        </div>
        <div className="aspect-video rounded-xl bg-muted/50 border flex items-center justify-center">
          <span className="text-muted-foreground">Channel Metrics</span>
        </div>
        <div className="aspect-video rounded-xl bg-muted/50 border flex items-center justify-center">
          <span className="text-muted-foreground">Video Queue</span>
        </div>
      </div>
      <div className="min-h-[100vh] flex-1 rounded-xl bg-muted/50 md:min-h-min border p-8">
        <h2 className="text-2xl font-bold mb-2">Channel Workflow: {channel.name}</h2>
        <p className="text-muted-foreground mb-6">
          Slug: <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{channel.slug}</span>
        </p>
        
        <div className="grid gap-4">
          <div className="p-4 border rounded-lg bg-background/50">
             <h3 className="font-medium mb-1">Channel Settings</h3>
             <pre className="text-xs bg-muted p-2 rounded overflow-auto">
               {JSON.stringify(channel.settings || {}, null, 2)}
             </pre>
          </div>
        </div>
      </div>
    </>
  );
}
