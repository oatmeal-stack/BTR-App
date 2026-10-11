import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), path: "/", replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  usePathname: () => nav.path,
  useRouter: () => ({ push: vi.fn(), replace: nav.replace, back: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
      React.createElement("a", { href, ...rest }, children),
  };
});

import BookPage from "@/app/book/page";
import EditPage from "@/app/edit/page";
import { AppShell } from "@/components/layout/AppShell";
import { SkinProvider } from "@/components/theme/SkinProvider";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";
import { editFromBook } from "@/domain/bookActions";
import { LibraryProvider } from "@/hooks/useLibrary";
import { LocalBookRepository } from "@/repositories/LocalBookRepository";
import { memoryStorage } from "./helpers";

const dune = SAMPLE_BOOKS.find((b) => b.title === "Dune")!;
const road = SAMPLE_BOOKS.find((b) => b.title === "The Road")!;

const newRepo = () => new LocalBookRepository(memoryStorage(), SAMPLE_BOOKS);
const find = async (repo: LocalBookRepository, id: string) => (await repo.listBooks()).find((b) => b.id === id)!;

function renderApp(ui: ReactNode, repo = newRepo()) {
  return render(
    <SkinProvider>
      <LibraryProvider repository={repo}>
        <AppShell>{ui}</AppShell>
      </LibraryProvider>
    </SkinProvider>,
  );
}

function openEdit(id: string, repo = newRepo()) {
  nav.params = new URLSearchParams({ id });
  return renderApp(<EditPage />, repo);
}

afterEach(() => {
  vi.unstubAllGlobals();
  nav.replace.mockClear();
  nav.params = new URLSearchParams();
});

describe("the book page", () => {
  it("shows when it was published and how long it is, and links to Edit", async () => {
    const repo = newRepo();
    await repo.updateBook(dune.id, { ...editFromBook(dune), year: 1965, pageCount: 612 });
    nav.params = new URLSearchParams({ id: dune.id });
    renderApp(<BookPage />, repo);
    expect(await screen.findByText("Published 1965 · 612 pages")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit/ })).toHaveAttribute("href", `/edit?id=${dune.id}`);
  });

  it("shows nothing extra when neither is known", async () => {
    const repo = newRepo();
    await repo.updateBook(dune.id, { ...editFromBook(dune), year: undefined, pageCount: undefined });
    nav.params = new URLSearchParams({ id: dune.id });
    renderApp(<BookPage />, repo);
    await screen.findByRole("heading", { name: "Dune" });
    expect(screen.queryByText(/Published/)).toBeNull();
    expect(screen.queryByText(/pages/)).toBeNull();
  });
});

describe("the Edit screen", () => {
  it("starts from the book as it is", async () => {
    openEdit(road.id);
    expect(await screen.findByLabelText("Title")).toHaveValue(road.title);
    expect(screen.getByLabelText("Author")).toHaveValue(road.author ?? "");
  });

  it("saves changes and goes back to the book", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    openEdit(dune.id, repo);
    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Dune (Deluxe)");
    await user.clear(screen.getByLabelText("Year published"));
    await user.type(screen.getByLabelText("Year published"), "1965");
    await user.clear(screen.getByLabelText("Pages"));
    await user.type(screen.getByLabelText("Pages"), "612");
    await user.type(screen.getByLabelText("Notes that came with the book"), "Read before the film");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/book?id=${encodeURIComponent(dune.id)}`));
    expect(await find(repo, dune.id)).toMatchObject({ title: "Dune (Deluxe)", year: 1965, pageCount: 612, sourceNote: "Read before the film" });
  });

  it("toggles genres, moods and lists, and can add a list", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    openEdit(dune.id, repo);
    await screen.findByLabelText("Title");
    const genres = screen.getByRole("group", { name: "Genres" });
    await user.click(genres.querySelector("button:not(.is-on)") as HTMLElement);
    await user.type(screen.getByLabelText("Another list name"), "Books to read with my wife");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("button", { name: "Books to read with my wife" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    const saved = await find(repo, dune.id);
    expect(saved.genres.length).toBe(dune.genres.length + 1);
    expect(saved.sources.map((s) => s.source)).toContain("Books to read with my wife");
  });

  it("explains a missing title, a bad year or page count, and no lists", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    openEdit(dune.id, repo);
    const title = await screen.findByLabelText("Title");

    await user.clear(title);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("A book needs a title.")).toBeInTheDocument();

    await user.type(title, "Dune");
    await user.clear(screen.getByLabelText("Year published"));
    await user.type(screen.getByLabelText("Year published"), "nineteen");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/year should be a number/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Year published"));
    await user.type(screen.getByLabelText("Pages"), "lots");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/Pages should be a number/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Pages"));
    for (const chip of screen.getByRole("group", { name: /Lists this book is on/ }).querySelectorAll("button.is-on")) await user.click(chip);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Pick at least one list for this book.")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
    expect((await find(repo, dune.id)).title).toBe("Dune"); // nothing was saved
  });

  it("clears a field you blank out", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.updateBook(dune.id, { ...editFromBook(dune), year: 1965, pageCount: 612 });
    openEdit(dune.id, repo);
    await user.clear(await screen.findByLabelText("Pages"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect((await find(repo, dune.id)).pageCount).toBeUndefined();
  });

  it("says so for a removed book instead of showing a form", async () => {
    const repo = newRepo();
    await repo.removeBook({ id: dune.id, title: dune.title, author: dune.author });
    openEdit(dune.id, repo);
    expect(await screen.findByText("This book was removed")).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).toBeNull();
  });
});

describe("a correction that matches a book you already have", () => {
  async function fillAsDune() {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.addNote(road.id, "From the road copy");
    openEdit(road.id, repo);
    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Dune");
    await user.clear(screen.getByLabelText("Author"));
    await user.type(screen.getByLabelText("Author"), "Frank Herbert");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    return { user, repo };
  }

  it("asks instead of silently making a duplicate", async () => {
    const { repo } = await fillAsDune();
    expect(await screen.findByRole("alert")).toHaveTextContent(/already in your library/);
    expect(nav.replace).not.toHaveBeenCalled();
    expect((await find(repo, road.id)).title).toBe(road.title); // nothing saved yet
  });

  it("merges: lists and notes move to the existing book and the extra copy is removed", async () => {
    const { user, repo } = await fillAsDune();
    await user.click(await screen.findByRole("button", { name: "Merge into that book" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/book?id=${encodeURIComponent(dune.id)}`));
    expect((await find(repo, road.id)).removedAt).toBeTruthy();
    expect((await repo.listNotes()).find((n) => n.body === "From the road copy")?.bookId).toBe(dune.id);
    expect((await find(repo, dune.id)).sources.length).toBeGreaterThanOrEqual(road.sources.length);
  });

  it("can still be saved as a separate book, or edited further", async () => {
    const { user, repo } = await fillAsDune();
    await user.click(await screen.findByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await user.click(await screen.findByRole("button", { name: "Save as a separate book" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect((await find(repo, road.id)).title).toBe("Dune");
    expect((await find(repo, dune.id)).removedAt).toBeUndefined();
  });
});

describe("Look up cover and details", () => {
  const found = {
    docs: [
      { title: "Dune", author_name: ["Frank Herbert"], cover_i: 42, edition_count: 500, first_publish_year: 1965, number_of_pages_median: 612 },
    ],
  };

  it("fills the cover, year and pages for you to review, without saving", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.updateBook(dune.id, { ...editFromBook(dune), year: undefined, pageCount: undefined }); // blanks get filled
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => found }) as Response));
    openEdit(dune.id, repo);
    await screen.findByLabelText("Title");
    await user.click(screen.getByRole("button", { name: "Look up cover and details" }));

    expect(await screen.findByText(/Found: cover, published 1965, 612 pages/)).toBeInTheDocument();
    expect(screen.getByLabelText("Cover image address (optional)")).toHaveValue("https://covers.openlibrary.org/b/id/42-M.jpg");
    expect(screen.getByLabelText("Year published")).toHaveValue("1965");
    expect(screen.getByLabelText("Pages")).toHaveValue("612");
    expect((await find(repo, dune.id)).pageCount).toBeUndefined(); // not saved until Save
  });

  it("never replaces a year or page count you already have, but says what Open Library thinks", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.updateBook(dune.id, { ...editFromBook(dune), year: 1966, pageCount: 500 });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => found }) as Response));
    openEdit(dune.id, repo);
    await screen.findByLabelText("Title");
    await user.click(screen.getByRole("button", { name: "Look up cover and details" }));

    expect(await screen.findByText(/Found: cover./)).toBeInTheDocument();
    expect(screen.getByText(/Kept what you had \(Open Library says published 1965; Open Library says 612 pages\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Year published")).toHaveValue("1966");
    expect(screen.getByLabelText("Pages")).toHaveValue("500");
  });

  it("says plainly when nothing matches, and changes nothing", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ docs: [] }) }) as Response));
    openEdit(dune.id);
    await screen.findByLabelText("Title");
    await user.click(screen.getByRole("button", { name: "Look up cover and details" }));
    expect(await screen.findByText(/Couldn't find a confident match/)).toBeInTheDocument();
    expect(screen.getByLabelText("Pages")).toHaveValue("");
  });
});
