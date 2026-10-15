/** Every route string lives here, never in a skin. */
export const ROUTES = {
  home: "/",
  browse: "/browse",
  library: "/library",
  reading: "/reading",
  lists: "/lists",
  profile: "/profile",
  add: "/add",
  removed: "/removed",
  drafts: "/drafts",
  readImport: "/read-import",
  myList: (id: string) => `/mylist?id=${encodeURIComponent(id)}`,
  edit: (id: string) => `/edit?id=${encodeURIComponent(id)}`,
  book: (id: string) => `/book?id=${encodeURIComponent(id)}`,
  browseWith: (params: { q?: string; source?: string; genre?: string; mood?: string; list?: string }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/browse?${qs}` : "/browse";
  },
} as const;

export const NAV_TABS = [
  { key: "home", label: "Home", href: ROUTES.home },
  { key: "browse", label: "Browse", href: ROUTES.browse },
  { key: "reading", label: "Reading", href: ROUTES.reading },
  { key: "library", label: "Library", href: ROUTES.library },
  { key: "lists", label: "Lists", href: ROUTES.lists },
  { key: "profile", label: "Profile", href: ROUTES.profile },
] as const;
