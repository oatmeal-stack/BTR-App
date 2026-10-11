"use client";

import { useState } from "react";
import { assetUrl } from "@/lib/assetUrl";
import type { ArtworkSlot } from "@/skins/skin.schema";
import { useSkin } from "./SkinProvider";

/**
 * Asks the active skin for artwork by slot. A missing or broken file leaves the
 * gradient fallback in place; it never hides or breaks any control.
 */
export function ThemeArtwork({
  slot,
  alt = "",
  decorative = true,
  className = "",
}: {
  slot: ArtworkSlot;
  alt?: string;
  decorative?: boolean;
  className?: string;
}) {
  const { skin } = useSkin();
  const path = skin.artwork[slot];
  const [failed, setFailed] = useState<string | null>(null);
  const show = Boolean(path) && failed !== path;

  return (
    <div className={`art art--${slot} ${className}`} data-slot={slot} data-has-art={show}>
      {show && path ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="art__img"
          src={assetUrl(path)}
          alt={decorative ? "" : alt}
          aria-hidden={decorative || undefined}
          style={{ objectPosition: skin.artworkPosition?.[slot] }}
          onError={() => setFailed(path)}
        />
      ) : null}
    </div>
  );
}
