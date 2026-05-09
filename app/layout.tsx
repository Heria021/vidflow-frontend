import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { cn } from "@/lib/utils"


export const metadata: Metadata = {
  title: "VidFlow — AI Video Generator",
  description: "Generate YouTube videos with Chirp 3 HD narration and AI scene mapping",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn("h-full antialiased")}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  )
}