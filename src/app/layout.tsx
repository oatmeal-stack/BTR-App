import type { CSSProperties } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";
import { SkinProvider } from "@/components/theme/SkinProvider";
import { LibraryProvider } from "@/hooks/useLibrary";
import { DEFAULT_SKIN_ID, getSkin, skinBootScript } from "@/skins/registry";
import { skinToCssVars } from "@/skins/skin.schema";

export const metadata: Metadata = {
  title: "Book Archive",
  description: "A personal library of books worth reading.",
  applicationName: "Book Archive",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: getSkin(DEFAULT_SKIN_ID).tokens.color.canvas,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Default skin is baked into the HTML; the boot script swaps in a saved
  // choice before first paint, so suppressHydrationWarning covers that one edit.
  const defaultVars = skinToCssVars(getSkin(DEFAULT_SKIN_ID)) as CSSProperties;
  return (
    <html lang="en" style={defaultVars} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: skinBootScript() }} />
      </head>
      <body>
        <SkinProvider>
          <LibraryProvider>
            <AppShell>{children}</AppShell>
          </LibraryProvider>
        </SkinProvider>
      </body>
    </html>
  );
}
