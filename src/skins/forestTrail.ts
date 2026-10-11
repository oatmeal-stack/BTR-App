import type { SkinConfig } from "./skin.schema";

export const forestTrail: SkinConfig = {
  id: "forest-trail",
  name: "Forest Trail",
  description: "Dark green, calm, and earthy, with mountain views",
  tokens: {
    color: {
      canvas: "#071F1A",
      surface: "#10352C",
      surfaceRaised: "#194337",
      text: "#F7F1E4",
      textMuted: "#C0CFC4",
      primary: "#E7C98F",
      onPrimary: "#09251C",
      border: "#416358",
      focus: "#FFDCA4",
    },
    font: { heading: "Georgia, 'Times New Roman', serif", body: "system-ui, sans-serif" },
    radius: { card: "18px", control: "12px", pill: "999px" },
    shadow: { card: "0 6px 24px rgba(0, 0, 0, 0.18)" },
  },
  // Files arrive from the artwork brief (pick-hero, browse-banner, ...).
  // Set a path here once the file is in public/skins/forest-trail/.
  artwork: { pickHero: null, browseBanner: null, emptyState: null, onboarding: null },
  artworkPosition: { pickHero: "50% 45%" },
};
