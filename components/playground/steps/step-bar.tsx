import * as React from "react"

const STEPS = [
  { id: 1, label: "Configure" },
  { id: 2, label: "Review"    },
  { id: 3, label: "Upload"    },
  { id: 4, label: "Render"    },
]

export function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 select-none">
      {STEPS.map((step, idx) => {
        const done   = step.id < current
        const active = step.id === current

        return (
          <React.Fragment key={step.id}>
            <div className="flex items-center gap-1.5">
              <div
                className={[
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors duration-300",
                  done   ? "border-foreground bg-foreground text-background" : "",
                  active ? "border-foreground bg-background text-foreground" : "",
                  !done && !active ? "border-muted-foreground/40 text-muted-foreground/40" : "",
                ].join(" ")}
              >
                {done ? "✓" : step.id}
              </div>
              <span
                className={[
                  "text-xs font-medium transition-colors duration-300",
                  active ? "text-foreground" : "text-muted-foreground/50",
                ].join(" ")}
              >
                {step.label}
              </span>
            </div>

            {idx < STEPS.length - 1 && (
              <div
                className={[
                  "mx-2 h-px w-8 shrink-0 rounded-full transition-colors duration-500",
                  done ? "bg-foreground" : "bg-muted-foreground/20",
                ].join(" ")}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}