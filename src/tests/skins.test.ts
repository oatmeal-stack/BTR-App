import { describe, expect, it, vi } from "vitest";
import { NAV_TABS, ROUTES } from "@/routes";
import { DEFAULT_SKIN_ID, getSkin, SKINS, skinBootScript } from "@/skins/registry";
import {
  ARTWORK_SLOTS,
  contrastProblems,
  contrastRatio,
  skinToCssVars,
  validateSkin,
  type SkinConfig,
} from "@/skins/skin.schema";

describe("skin registry", () => {
  it("registers Forest Trail, Cozy Mountain Cabin and Minimal Library", () => {
    expect(SKINS.map((s) => s.id)).toEqual(["forest-trail", "cozy-cabin", "minimal-library"]);
    expect(DEFAULT_SKIN_ID).toBe("forest-trail");
  });

  it("every registered skin passes validation", () => {
    for (const s of SKINS) expect(validateSkin(s)).toEqual([]);
  });

  it("falls back to the default for an unknown or missing skin", () => {
    expect(getSkin("does-not-exist").id).toBe(DEFAULT_SKIN_ID);
    expect(getSkin(null).id).toBe(DEFAULT_SKIN_ID);
  });

  it("rejects a broken skin instead of letting it crash a view", () => {
    const broken = { ...SKINS[0], tokens: { ...SKINS[0].tokens, color: { ...SKINS[0].tokens.color, primary: "gold" } } };
    expect(validateSkin(broken)).toContain("Bad color: primary");
    expect(validateSkin(null)).not.toEqual([]);
    expect(validateSkin({})).not.toEqual([]);
  });

  it("boot script carries every skin and the default", () => {
    const script = skinBootScript();
    for (const s of SKINS) expect(script).toContain(s.id);
    expect(script).toContain("localStorage");
  });
});

describe("skins are presentation only", () => {
  it("are serializable: no functions, nothing lost in a JSON round trip", () => {
    for (const s of SKINS) expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("contain no routes, book ids or behavior", () => {
    const staticRoutes = Object.values(ROUTES).filter((v) => typeof v === "string") as string[];
    const routeStrings = [...staticRoutes, ...NAV_TABS.map((t) => t.href as string)].filter((r) => r !== "/");
    for (const s of SKINS) {
      const text = JSON.stringify(s);
      for (const r of routeStrings) expect(text).not.toContain(`"${r}`);
      expect(text).not.toMatch(/bk-|book\?id|=>|function/);
    }
  });

  it("set exactly the same CSS variables, so a skin can't leave a gap", () => {
    const keys = Object.keys(skinToCssVars(SKINS[0])).sort();
    for (const s of SKINS) expect(Object.keys(skinToCssVars(s)).sort()).toEqual(keys);
    expect(keys.length).toBeGreaterThanOrEqual(15);
  });

  it("actually differ in color from one another", () => {
    const canvases = SKINS.map((s) => s.tokens.color.canvas);
    expect(new Set(canvases).size).toBe(SKINS.length);
  });

  it("declare every artwork slot (null is fine until the file exists)", () => {
    for (const s of SKINS) expect(Object.keys(s.artwork).sort()).toEqual([...ARTWORK_SLOTS].sort());
  });
});

describe("contrast", () => {
  it("computes WCAG ratios correctly", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it.each(SKINS.map((s) => [s.name, s] as const))("%s meets 4.5:1 for text, muted text and buttons", (_name, skin) => {
    expect(contrastProblems(skin)).toEqual([]);
  });

  it("flags a skin that fails", () => {
    const bad: SkinConfig = {
      ...SKINS[0],
      tokens: { ...SKINS[0].tokens, color: { ...SKINS[0].tokens.color, textMuted: "#2A5547" } },
    };
    expect(contrastProblems(bad).length).toBeGreaterThan(0);
  });
});

describe("registry safety", () => {
  it("always keeps the default skin available", async () => {
    vi.resetModules();
    const mod = await import("@/skins/registry");
    expect(mod.SKINS.some((s) => s.id === mod.DEFAULT_SKIN_ID)).toBe(true);
  });
});
