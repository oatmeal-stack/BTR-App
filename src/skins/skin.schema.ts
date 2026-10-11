/**
 * A skin is plain data: colors, fonts, radii, and artwork file paths.
 * It must never contain routes, callbacks, book data, or behavior.
 */
export type ArtworkSlot = "pickHero" | "browseBanner" | "emptyState" | "onboarding";

export const ARTWORK_SLOTS: ArtworkSlot[] = [
  "pickHero",
  "browseBanner",
  "emptyState",
  "onboarding",
];

export interface SkinConfig {
  id: string;
  name: string;
  description: string;
  tokens: {
    color: {
      canvas: string;
      surface: string;
      surfaceRaised: string;
      text: string;
      textMuted: string;
      primary: string;
      onPrimary: string;
      border: string;
      focus: string;
    };
    font: { heading: string; body: string };
    radius: { card: string; control: string; pill: string };
    shadow: { card: string };
  };
  /** Public file paths, or null while an image hasn't been added yet. */
  artwork: Record<ArtworkSlot, string | null>;
  /** CSS object-position per slot, e.g. "50% 45%". */
  artworkPosition?: Partial<Record<ArtworkSlot, string>>;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Returns a list of problems. Empty means the skin is safe to register. */
export function validateSkin(skin: unknown): string[] {
  const problems: string[] = [];
  const s = skin as Partial<SkinConfig> | null;
  if (!s || typeof s !== "object") return ["Skin is not an object"];
  for (const key of ["id", "name", "description"] as const) {
    if (typeof s[key] !== "string" || !s[key]) problems.push(`Missing ${key}`);
  }
  const color = s.tokens?.color as Record<string, unknown> | undefined;
  const names = [
    "canvas",
    "surface",
    "surfaceRaised",
    "text",
    "textMuted",
    "primary",
    "onPrimary",
    "border",
    "focus",
  ];
  for (const n of names) {
    const v = color?.[n];
    if (typeof v !== "string" || !HEX.test(v)) problems.push(`Bad color: ${n}`);
  }
  if (!s.tokens?.font?.heading || !s.tokens?.font?.body) problems.push("Missing fonts");
  const r = s.tokens?.radius;
  if (!r?.card || !r?.control || !r?.pill) problems.push("Missing radii");
  if (!s.tokens?.shadow?.card) problems.push("Missing shadow");
  if (!s.artwork) problems.push("Missing artwork map");
  return problems;
}

/** The CSS custom properties a skin sets. Every token is always set. */
export function skinToCssVars(skin: SkinConfig): Record<string, string> {
  const { color, font, radius, shadow } = skin.tokens;
  return {
    "--color-canvas": color.canvas,
    "--color-surface": color.surface,
    "--color-surface-raised": color.surfaceRaised,
    "--color-text": color.text,
    "--color-text-muted": color.textMuted,
    "--color-primary": color.primary,
    "--color-on-primary": color.onPrimary,
    "--color-border": color.border,
    "--color-focus": color.focus,
    "--font-heading": font.heading,
    "--font-body": font.body,
    "--radius-card": radius.card,
    "--radius-control": radius.control,
    "--radius-pill": radius.pill,
    "--shadow-card": shadow.card,
  };
}

/* ---------- contrast (WCAG) ---------- */

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The pairs every skin must keep at 4.5:1 or better. */
export function contrastProblems(skin: SkinConfig): string[] {
  const c = skin.tokens.color;
  const pairs: [string, string, string][] = [
    ["text on canvas", c.text, c.canvas],
    ["text on surface", c.text, c.surface],
    ["text on raised", c.text, c.surfaceRaised],
    ["muted text on canvas", c.textMuted, c.canvas],
    ["muted text on surface", c.textMuted, c.surface],
    ["muted text on raised", c.textMuted, c.surfaceRaised],
    ["button text on primary", c.onPrimary, c.primary],
    ["primary on canvas", c.primary, c.canvas],
    ["primary on surface", c.primary, c.surface],
  ];
  return pairs
    .filter(([, fg, bg]) => contrastRatio(fg, bg) < 4.5)
    .map(([label, fg, bg]) => `${label}: ${contrastRatio(fg, bg).toFixed(2)}:1`);
}
