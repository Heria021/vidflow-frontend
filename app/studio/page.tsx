"use client";



export default function StudioPage() {
  return (
    <>
      <div className="grid auto-rows-min gap-4 md:grid-cols-3">
        <div className="aspect-video rounded-xl bg-muted/50 flex items-center justify-center border border-dashed">
          <span className="text-muted-foreground">Total Channels Overview</span>
        </div>
        <div className="aspect-video rounded-xl bg-muted/50 flex items-center justify-center border border-dashed">
          <span className="text-muted-foreground">Recent Videos (Global)</span>
        </div>
        <div className="aspect-video rounded-xl bg-muted/50 flex items-center justify-center border border-dashed">
          <span className="text-muted-foreground">Storage Usage</span>
        </div>
      </div>
      <div className="min-h-[100vh] flex-1 rounded-xl bg-muted/50 md:min-h-min border border-dashed p-8">
        <h2 className="text-2xl font-bold mb-4">Welcome to Studio</h2>
        <p className="text-muted-foreground">
          This is your bird&apos;s eye view. Select a channel from the sidebar switcher to manage specific workflows.
        </p>
      </div>
    </>
  );
}
