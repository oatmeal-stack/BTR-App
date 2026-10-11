import type { SkinConfig } from "./skin.schema";

export const cozyCabin: SkinConfig = {
  id: "cozy-cabin",
  name: "Cozy Mountain Cabin",
  description: "Warm lantern light and snowy peaks at dusk",
  tokens: {
    color: {
      canvas: "#0E1730",
      surface: "#182843",
      surfaceRaised: "#23375A",
      text: "#F6EEDD",
      textMuted: "#BCC8DD",
      primary: "#F9D09A",
      onPrimary: "#1A1208",
      border: "#3B5380",
      focus: "#F9D09A",
    },
    font: { heading: "Georgia, 'Times New Roman', serif", body: "system-ui, sans-serif" },
    radius: { card: "16px", control: "12px", pill: "999px" },
    shadow: { card: "0 6px 24px rgba(0, 0, 0, 0.28)" },
  },
  artwork: {
    pickHero: "/skins/cozy-cabin/pick-hero.jpg",
    browseBanner: "/skins/cozy-cabin/browse-banner.jpg",
    emptyState: "/skins/cozy-cabin/empty-state.jpg",
    onboarding: "/skins/cozy-cabin/onboarding.jpg",
  },
  artworkPosition: { pickHero: "50% 50%" },
};
