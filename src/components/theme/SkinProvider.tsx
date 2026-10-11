"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  DEFAULT_SKIN_ID,
  getSkin,
  SKIN_STORAGE_KEY,
  SKINS,
} from "@/skins/registry";
import { skinToCssVars, type SkinConfig } from "@/skins/skin.schema";

/* The chosen skin lives in localStorage, read through useSyncExternalStore so
   the first client render matches the server and there are no hydration errors. */
const listeners = new Set<() => void>();
let memorySkin: string | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function getSnapshot(): string {
  if (memorySkin) return memorySkin;
  try {
    return window.localStorage.getItem(SKIN_STORAGE_KEY) ?? DEFAULT_SKIN_ID;
  } catch {
    return DEFAULT_SKIN_ID;
  }
}

function getServerSnapshot(): string {
  return DEFAULT_SKIN_ID;
}

interface SkinContextValue {
  skin: SkinConfig;
  skins: SkinConfig[];
  setSkinId: (id: string) => void;
}

const SkinContext = createContext<SkinContextValue | null>(null);

export function SkinProvider({ children }: { children: ReactNode }) {
  const id = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const skin = getSkin(id);

  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(skinToCssVars(skin))) root.style.setProperty(k, v);
  }, [skin]);

  const setSkinId = useCallback((next: string) => {
    memorySkin = getSkin(next).id;
    try {
      window.localStorage.setItem(SKIN_STORAGE_KEY, memorySkin);
    } catch {
      /* keep the choice for this visit even if storage is blocked */
    }
    listeners.forEach((l) => l());
  }, []);

  const value = useMemo(() => ({ skin, skins: SKINS, setSkinId }), [skin, setSkinId]);
  return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>;
}

export function useSkin(): SkinContextValue {
  const ctx = useContext(SkinContext);
  if (!ctx) throw new Error("useSkin must be used inside SkinProvider");
  return ctx;
}
