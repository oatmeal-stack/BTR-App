import type { SkinConfig } from "./skin.schema";

export const minimalLibrary: SkinConfig = {
  id: "minimal-library",
  name: "Minimal Library",
  description: "Clean white pages and black ink",
  tokens: {
    color: {
      canvas: "#FAFAF8",
      surface: "#FFFFFF",
      surfaceRaised: "#F1F0EC",
      text: "#1C1C1A",
      textMuted: "#5F5E59",
      primary: "#1C1C1A",
      onPrimary: "#FFFFFF",
      border: "#D8D6CE",
      focus: "#2F5BEA",
    },
    font: { heading: "system-ui, sans-serif", body: "system-ui, sans-serif" },
    radius: { card: "8px", control: "6px", pill: "6px" },
    shadow: { card: "0 1px 2px rgba(0, 0, 0, 0.06)" },
  },
  artwork: { pickHero: null, browseBanner: null, emptyState: null, onboarding: null },
};
