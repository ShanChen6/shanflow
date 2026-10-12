import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { THEME_BOOT_SCRIPT } from "@/shared/ui/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shanflow",
  description: "Personal Task Management",
};

export const viewport: Viewport = {
  themeColor: [
    { color: "#070f26", media: "(prefers-color-scheme: dark)" },
    { color: "#f8fafc", media: "(prefers-color-scheme: light)" },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme is set by the boot script before React hydrates, hence suppressHydrationWarning.
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
