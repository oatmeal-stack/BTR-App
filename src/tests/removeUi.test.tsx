import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
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

import AddPage from "@/app/add/page";
import BookPage from "@/app/book/page";
import BrowsePage from "@/app/browse/page";
import HomePage from "@/app/page";
import ProfilePage from "@/app/profile/page";
import RemovedPage from "@/app/removed/page";
import { AppShell } from "@/components/layout/AppShell";
import { SkinProvider } from "@/components/theme/SkinProvider";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";
import { LibraryProvider, UNDO_MS } from "@/hooks/useLibrary";
import { LocalBookRepository } from "@/repositories/LocalBookRepository";
import { memoryStorage } from "./helpers";

const dune = SAMPLE_BOOKS.find((b) => b.title === "Dune")!;
const asRef = (b: { id: string; title: string; author?: string }) => ({ id: b.id, title: b.title, author: b.author });

function newRepo() {
  return new LocalBookRepository(memoryStorage(), SAMPLE_BOOKS);
}

function renderApp(ui: ReactNode, repo = newRepo()) {
  return render(
    <SkinProvider>
      <LibraryProvider repository={repo}>
        <AppShell>{ui}</AppShell>
      </LibraryProvider>
    </SkinProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  nav.replace.mockClear();
  nav.params = new URLSearchParams();
});

describe("Remove on the book page", () => {
  it("removes the book, goes back to Browse, and offers Undo", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: dune.id });
    const repo = newRepo();
    renderApp(<BookPage />, repo);
    await screen.findByRole("heading", { name: "Dune" });

    await user.click(screen.getByRole("button", { name: "Remove this book" }));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/browse"));
    const bar = await screen.findByRole("status");
    expect(bar).toHaveTextContent("Removed Dune");
    expect((await repo.listBooks()).find((b) => b.id === dune.id)?.removedAt).toBeTruthy(); // saved

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await repo.listBooks()).find((b) => b.id === dune.id)?.removedAt).toBeUndefined());
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(await screen.findByRole("heading", { name: "Dune" })).toBeInTheDocument(); // the page is back
  });

  it("lets the Undo bar go away by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    nav.params = new URLSearchParams({ id: dune.id });
    renderApp(<BookPage />);
    await screen.findByRole("heading", { name: "Dune" });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Remove this book" }));
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS + 50);
    });
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("opens a removed book's link to say so, and Restore brings it back", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.removeBook(asRef(dune));
    nav.params = new URLSearchParams({ id: dune.id });
    renderApp(<BookPage />, repo);

    expect(await screen.findByText("This book was removed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove this book" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Restore this book/ }));
    expect(await screen.findByRole("heading", { name: "Dune" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove this book" })).toBeInTheDocument();
  });
});

describe("a removed book is hidden everywhere you look", () => {
  it("is not in Browse, not even when you search for it", async () => {
    const repo = newRepo();
    await repo.removeBook(asRef(dune));
    nav.params = new URLSearchParams();
    renderApp(<BrowsePage />, repo);
    await screen.findByText(`${SAMPLE_BOOKS.length - 1} books`);
    expect(screen.queryByText("Dune")).toBeNull();

    nav.params = new URLSearchParams({ q: "dune" });
    renderApp(<BrowsePage />, repo);
    await waitFor(() => expect(screen.getAllByText(/No books match|0 books/).length).toBeGreaterThan(0));
    expect(screen.queryByText("Dune")).toBeNull();
  });

  it("is never the Home pick, however many times you shuffle", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    for (const b of SAMPLE_BOOKS) if (b.id !== dune.id) await repo.removeBook(asRef(b)); // only Dune left
    renderApp(<HomePage />, repo);
    expect(await screen.findByRole("heading", { name: "Dune" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Shuffle/ }));
    expect(await screen.findByRole("heading", { name: "Dune" })).toBeInTheDocument(); // nothing else it could pick
  });

  it("keeps its notes out of the notes list until it is restored", async () => {
    const repo = newRepo();
    await repo.addNote(dune.id, "Read before the film");
    const first = renderApp(<ProfilePage />, repo);
    expect(await screen.findByText("Read before the film")).toBeInTheDocument();
    first.unmount();

    await repo.removeBook(asRef(dune));
    renderApp(<ProfilePage />, repo);
    await screen.findByText(/See removed books \(1\)/);
    expect(screen.queryByText("Read before the film")).toBeNull();
    expect(screen.getByText("All notes (0)")).toBeInTheDocument();
  });
});

describe("the Removed books screen", () => {
  it("says so when nothing has been removed", async () => {
    renderApp(<RemovedPage />);
    expect(await screen.findByText("Nothing removed")).toBeInTheDocument();
  });

  it("lists removed books, and Restore puts one back", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.removeBook(asRef(dune));
    renderApp(<RemovedPage />, repo);

    expect(await screen.findByText("Dune", { selector: ".row__title" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore Dune" }));
    expect(await screen.findByText("Nothing removed")).toBeInTheDocument();
    expect((await repo.listBooks()).find((b) => b.id === dune.id)?.removedAt).toBeUndefined();
  });
});

describe("adding a book you removed earlier", () => {
  it("doesn't add it again, and offers to restore it", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.removeBook(asRef(dune));
    renderApp(<AddPage />, repo);

    await user.type(screen.getByLabelText("Title"), "Dune");
    await user.type(screen.getByLabelText(/Author/), "Frank Herbert");
    await user.click(screen.getByRole("button", { name: "Add book" }));

    expect(await screen.findByText(/You removed/)).toBeInTheDocument();
    expect((await repo.listBooks()).filter((b) => b.title === "Dune")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Restore it" }));
    await waitFor(async () => expect((await repo.listBooks()).find((b) => b.id === dune.id)?.removedAt).toBeUndefined());
    expect(screen.queryByText(/You removed/)).toBeNull();
  });
});
