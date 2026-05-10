import type { Metadata } from "next"
import "./globals.css"
import { cn } from "@/lib/utils"
import { Providers } from "@/providers/ConvexProvider"
import { Outfit } from "next/font/google";

const outfit = Outfit({subsets:['latin'],variable:'--font-sans'});

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
      className={cn("h-full antialiased dark", "font-sans", outfit.variable)}
    >
      <body className="min-h-full flex flex-col font-sans">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}