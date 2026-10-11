import { cozyCabin } from "./cozyCabin";
import { forestTrail } from "./forestTrail";
import { minimalLibrary } from "./minimalLibrary";
import { skinToCssVars, validateSkin, type SkinConfig } from "./skin.schema";

export const DEFAULT_SKIN_ID = forestTrail.id;
export const SKIN_STORAGE_KEY = "book-archive:skin";

function register(candidates: SkinConfig[]): SkinConfig[] {
  const ok = candidates.filter((s) => {
    const problems = validateSkin(s);
    if (problems.length) {
      console.warn(`Skipping skin "${(s as SkinConfig)?.id}": ${problems.join(", ")}`);
      return false;
    }
    return true;
  });
  // The default must always exist, so the app can never be left without a skin.
  return ok.some((s) => s.id === DEFAULT_SKIN_ID) ? ok : [forestTrail, ...ok];
}

export const SKINS: SkinConfig[] = register([forestTrail, cozyCabin, minimalLibrary]);

export function getSkin(id: string | null | undefined): SkinConfig {
  return SKINS.find((s) => s.id === id) ?? SKINS.find((s) => s.id === DEFAULT_SKIN_ID)!;
}

/** Runs in <head> before first paint so a saved skin doesn't flash the default. */
export function skinBootScript(): string {
  const all = Object.fromEntries(SKINS.map((s) => [s.id, skinToCssVars(s)]));
  return (
    "(function(){try{var m=" +
    JSON.stringify(all) +
    ";var id=localStorage.getItem(" +
    JSON.stringify(SKIN_STORAGE_KEY) +
    ");var v=m[id]||m[" +
    JSON.stringify(DEFAULT_SKIN_ID) +
    "];var r=document.documentElement;for(var k in v){r.style.setProperty(k,v[k])}}catch(e){}})();"
  );
}
