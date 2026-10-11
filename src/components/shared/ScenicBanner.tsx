import type { ReactNode } from "react";
import type { ArtworkSlot } from "@/skins/skin.schema";
import { ThemeArtwork } from "@/components/theme/ThemeArtwork";

/**
 * Scenic art in a contained header. The title sits on its own scrim, never
 * baked into the picture, and any control gets a solid background.
 */
export function ScenicBanner({
  slot,
  title,
  subtitle,
  action,
}: {
  slot: ArtworkSlot;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className={`banner banner--${slot}`}>
      <ThemeArtwork slot={slot} className="banner__art" />
      <div className="banner__scrim" aria-hidden="true" />
      {action ? <div className="banner__action">{action}</div> : null}
      <div className="banner__text">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
    </header>
  );
}
