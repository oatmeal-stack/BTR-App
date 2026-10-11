import { useEffect, type ReactNode } from "react";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), path: "/" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  usePathname: () => nav.path,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
      React.createElement("a", { href, ...rest }, children),
  };
});

import BookPage from "@/app/book/page";
import BrowsePage from "@/app/browse/page";
import HomePage from "@/app/page";
import { AppShell } from "@/components/layout/AppShell";
import { SkinProvider } from "@/components/theme/SkinProvider";
import { SkinSelector } from "@/components/theme/SkinSelector";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";
import { LibraryProvider } from "@/hooks/useLibrary";
import { LocalBookRepository, STORAGE_KEY } from "@/repositories/LocalBookRepository";
import { NAV_TABS } from "@/routes";
import { SKINS } from "@/skins/registry";
import { failingStorage, memoryStorage } from "./helpers";

const DOVE = "bk-lonesome-dove-larry-mcmurtry";

function renderApp(ui: ReactNode, storage: Storage = memoryStorage()) {
  const repo = new LocalBookRepository(storage, SAMPLE_BOOKS);
  const view = render(
    <SkinProvider>
      <LibraryProvider repository={repo}>
        <AppShell>{ui}</AppShell>
      </LibraryProvider>
    </SkinProvider>,
  );
  return { ...view, storage };
}

const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name);
const tileHrefs = () => [...document.querySelectorAll<HTMLAnchorElement>("a.tile")].map((a) => a.getAttribute("href"));
const navHrefs = () => [...document.querySelectorAll<HTMLAnchorElement>("nav a")].map((a) => a.getAttribute("href"));

async function pickSkin(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("radio", { name: new RegExp(name) }));
}

describe("skin switching", () => {
  it("changes tokens but not routes, results, or saved books, and never remounts the app", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams();
    nav.path = "/browse/";
    let mounts = 0;
    function MountCounter() {
      useEffect(() => {
        mounts += 1;
      }, []);
      return null;
    }
    const { storage } = renderApp(
      <>
        <MountCounter />
        <SkinSelector />
        <BrowsePage />
      </>,
    );
    await waitFor(() => expect(tileHrefs().length).toBe(SAMPLE_BOOKS.length));
    await user.click(screen.getByRole("button", { name: "Spy" }));
    const results = tileHrefs();
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThan(SAMPLE_BOOKS.length);
    const links = navHrefs();
    expect(links).toEqual(NAV_TABS.map((t) => t.href));

    await pickSkin(user, "Forest Trail");
    const savedBefore = storage.getItem(STORAGE_KEY);
    const canvases: string[] = [];
    for (const skin of SKINS) {
      await pickSkin(user, skin.name);
      await waitFor(() => expect(rootVar("--color-canvas")).toBe(skin.tokens.color.canvas));
      canvases.push(rootVar("--color-canvas"));
      expect(rootVar("--font-heading")).toBe(skin.tokens.font.heading);
      expect(tileHrefs()).toEqual(results); // same book ids, same order, every skin
      expect(navHrefs()).toEqual(links); // same destinations
    }
    expect(new Set(canvases).size).toBe(SKINS.length);
    expect(storage.getItem(STORAGE_KEY)).toBe(savedBefore); // library untouched
    expect(mounts).toBe(1); // nothing was remounted
    await pickSkin(user, "Forest Trail");
  });

  it("keeps the chosen skin after a reload", async () => {
    const user = userEvent.setup();
    nav.path = "/";
    const first = renderApp(<SkinSelector />);
    await pickSkin(user, "Cozy Mountain Cabin");
    first.unmount();
    document.documentElement.removeAttribute("style");

    renderApp(<SkinSelector />);
    await waitFor(() => expect(rootVar("--color-canvas")).toBe("#0E1730"));
    expect(screen.getByRole("radio", { name: /Cozy Mountain Cabin/ })).toBeChecked();
    await pickSkin(user, "Forest Trail");
  });
});

describe("missing artwork", () => {
  it("shows a fallback and never hides a control", async () => {
    nav.path = "/";
    const skin = SKINS[0];
    skin.artwork.pickHero = "/skins/forest-trail/pick-hero.webp";
    try {
      const { container } = renderApp(<HomePage />);
      const img = await waitFor(() => {
        const el = container.querySelector<HTMLImageElement>("img.art__img");
        expect(el).not.toBeNull();
        return el!;
      });
      fireEvent.error(img); // the file is missing or broken
      await waitFor(() => expect(container.querySelector("img.art__img")).toBeNull());
      expect(container.querySelector('[data-slot="pickHero"]')).toHaveAttribute("data-has-art", "false");
      expect(screen.getByRole("heading", { name: "Your next read" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Shuffle/ })).toBeEnabled();
      expect(screen.getByRole("searchbox")).toBeEnabled();
    } finally {
      skin.artwork.pickHero = null;
    }
  });

  it("works with no artwork configured at all", async () => {
    nav.path = "/";
    renderApp(<HomePage />);
    expect(await screen.findByRole("button", { name: /Shuffle/ })).toBeInTheDocument();
    expect(document.querySelector("img.art__img")).toBeNull();
  });
});

describe("book page", () => {
  it("opens by deep link without visiting Home first, and shows the score only here", async () => {
    nav.params = new URLSearchParams({ id: DOVE });
    renderApp(<BookPage />);
    expect(await screen.findByRole("heading", { name: "Lonesome Dove" })).toBeInTheDocument();
    expect(screen.getByText("9.0 / 10")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Find on Amazon/ })).toHaveAttribute(
      "href",
      "https://www.amazon.com/s?k=Lonesome+Dove+Larry+McMurtry",
    );
  });

  it("never shows scores on the browse grid", async () => {
    nav.params = new URLSearchParams();
    renderApp(<BrowsePage />);
    await waitFor(() => expect(tileHrefs().length).toBe(SAMPLE_BOOKS.length));
    expect(screen.queryByText(/\/ 10/)).toBeNull();
  });

  it("shows a not-found state for an unknown id", async () => {
    nav.params = new URLSearchParams({ id: "nope" });
    renderApp(<BookPage />);
    expect(await screen.findByText("Book not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Browse books/ })).toHaveAttribute("href", "/browse");
  });

  it("renders readable details for a book with no cover art", async () => {
    nav.params = new URLSearchParams({ id: DOVE });
    renderApp(<BookPage />);
    await screen.findByRole("heading", { name: "Lonesome Dove" });
    expect(SAMPLE_BOOKS.find((b) => b.id === DOVE)!.coverUrl).toBeUndefined();
    expect(screen.getByRole("img", { name: "Cover of Lonesome Dove" })).toBeInTheDocument();
    expect(screen.getByText("Larry McMurtry")).toBeInTheDocument();
    expect(screen.getByText("Published 1985")).toBeInTheDocument();
  });

  it("changes status and favorite without changing the book", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: DOVE });
    renderApp(<BookPage />);
    await screen.findByRole("heading", { name: "Lonesome Dove" });
    await user.click(screen.getByRole("button", { name: "Read" }));
    expect(screen.getByRole("button", { name: "Read" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Want to read" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "Lonesome Dove" })).toBeInTheDocument();
  });

  it("adds, edits and deletes private notes, and rejects an empty one", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: DOVE });
    const { storage } = renderApp(<BookPage />);
    await screen.findByRole("heading", { name: "Lonesome Dove" });

    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(screen.getByText("Write something first.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Add a note"), "Camp book candidate");
    expect(screen.queryByText("Write something first.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByText("Camp book candidate")).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(storage.getItem(STORAGE_KEY)!).notes).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Edit note");
    await user.clear(box);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/can't be empty/)).toBeInTheDocument();
    await user.type(box, "Reread in spring");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Reread in spring")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Reread in spring")).toBeNull());
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).notes).toHaveLength(0);
  });

  it("undoes the change and says so when saving fails", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: DOVE });
    renderApp(<BookPage />, failingStorage());
    await screen.findByRole("heading", { name: "Lonesome Dove" });
    await user.click(screen.getByRole("button", { name: "Read" }));
    const status = await screen.findByRole("status");
    expect(within(status).getByText(/Couldn't save that/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Want to read" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Read" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("navigation", () => {
  it("has five real tabs with a single active one", () => {
    nav.params = new URLSearchParams();
    nav.path = "/library/";
    renderApp(<div />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(NAV_TABS.map((t) => t.href));
    expect(links.filter((l) => l.getAttribute("aria-current") === "page")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
  });

  it("highlights Browse on a book page", () => {
    nav.path = "/book/";
    renderApp(<div />);
    expect(screen.getByRole("link", { name: "Browse" })).toHaveAttribute("aria-current", "page");
  });
});

describe("home", () => {
  it("shuffle gives a different book each time", async () => {
    const user = userEvent.setup();
    nav.path = "/";
    renderApp(<HomePage />);
    const title = () => screen.getByRole("region", { name: "Random pick" }).querySelector("h2")!.textContent;
    await screen.findByRole("region", { name: "Random pick" });
    let previous = title();
    for (let i = 0; i < 8; i++) {
      await user.click(screen.getByRole("button", { name: /Shuffle/ }));
      const now = title();
      expect(now).not.toBe(previous);
      previous = now;
    }
  });
});
