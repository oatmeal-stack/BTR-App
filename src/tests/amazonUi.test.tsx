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

import AddPage from "@/app/add/page";
import BookPage from "@/app/book/page";
import { AppShell } from "@/components/layout/AppShell";
import { SkinProvider } from "@/components/theme/SkinProvider";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";
import { LibraryProvider } from "@/hooks/useLibrary";
import type { AmazonFunctionResult } from "@/lib/amazon";
import { LocalBookRepository } from "@/repositories/LocalBookRepository";
import { memoryStorage } from "./helpers";

const dune = SAMPLE_BOOKS.find((b) => b.title === "Dune")!;

/** A shared library signed in, with the server-side helper available. */
class HelperRepo extends LocalBookRepository {
  calls: string[] = [];
  constructor(private readonly answer: AmazonFunctionResult | null) {
    super(memoryStorage(), SAMPLE_BOOKS);
  }
  async readAmazonLink(url: string) {
    this.calls.push(url);
    return this.answer;
  }
}

const newRepo = () => new LocalBookRepository(memoryStorage(), SAMPLE_BOOKS);

function renderApp(ui: ReactNode, repo: LocalBookRepository = newRepo()) {
  return render(
    <SkinProvider>
      <LibraryProvider repository={repo}>
        <AppShell>{ui}</AppShell>
      </LibraryProvider>
    </SkinProvider>,
  );
}

/** Open Library's by-ISBN answer. */
const olIsbn = (isbn: string, rec: object) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ [`ISBN:${isbn}`]: rec }) }) as Response));

const GATSBY: AmazonFunctionResult = {
  asin: "0743273567",
  title: "The Great Gatsby: The Only Authorized Edition",
  author: "F. Scott Fitzgerald",
  pages: 180,
  coverUrl: "https://m.media-amazon.com/images/I/81T4dS6IkaL._SL1500_.jpg",
  isbn13: "9780743273565",
};

afterEach(() => {
  vi.unstubAllGlobals();
  nav.params = new URLSearchParams();
});

async function fill(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(await screen.findByLabelText("Amazon link"), text);
  await user.click(screen.getByRole("button", { name: "Fill in" }));
}

describe("Add from an Amazon link", () => {
  it("fills the form from an ISBN for you to check, then adds the book with its pages, cover and Amazon id", async () => {
    olIsbn("9780743273565", { title: "The Great Gatsby", authors: [{ name: "F. Scott Fitzgerald" }], number_of_pages: 180, cover: { medium: "https://covers.openlibrary.org/b/id/1-M.jpg" } });
    const user = userEvent.setup();
    const repo = newRepo();
    renderApp(<AddPage />, repo);
    await fill(user, "978-0-7432-7356-5");

    expect(await screen.findByText(/Found The Great Gatsby by F\. Scott Fitzgerald \(180 pages, a cover\)\. Check it, then Add\./)).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("The Great Gatsby");
    expect(screen.getByLabelText(/Author/)).toHaveValue("F. Scott Fitzgerald");
    expect(screen.getByLabelText(/Pages/)).toHaveValue("180");
    expect(screen.getByLabelText("Cover found")).toBeInTheDocument();
    expect((await repo.listBooks()).some((b) => b.title === "The Great Gatsby")).toBe(false); // nothing saved yet

    await user.click(screen.getByRole("button", { name: "Add book" }));
    await screen.findByText(/to your library/);
    const added = (await repo.listBooks()).find((b) => b.title === "The Great Gatsby")!;
    expect(added).toMatchObject({ author: "F. Scott Fitzgerald", pageCount: 180, coverUrl: "https://covers.openlibrary.org/b/id/1-M.jpg", asin: "0743273567" });
    expect(screen.getByLabelText("Amazon link")).toHaveValue(""); // ready for the next one
  });

  it("lets you correct anything before adding", async () => {
    olIsbn("9780743273565", { title: "The Great Gatsby", authors: [{ name: "F. Scott Fitzgerald" }], number_of_pages: 180 });
    const user = userEvent.setup();
    const repo = newRepo();
    renderApp(<AddPage />, repo);
    await fill(user, "0743273567");
    await screen.findByText(/Check it, then Add/);
    await user.clear(screen.getByLabelText(/Pages/));
    await user.type(screen.getByLabelText(/Pages/), "208");
    await user.click(screen.getByRole("button", { name: "Add book" }));
    await screen.findByText(/to your library/);
    expect((await repo.listBooks()).find((b) => b.title === "The Great Gatsby")?.pageCount).toBe(208);
  });

  it("reads a product link through the server-side helper, and offers the full title", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ docs: [] }) }) as Response));
    const user = userEvent.setup();
    const repo = new HelperRepo(GATSBY);
    renderApp(<AddPage />, repo);
    await fill(user, "https://www.amazon.com/dp/0743273567?tag=abc");
    await screen.findByText(/Check it, then Add/);
    expect(repo.calls).toEqual(["https://www.amazon.com/dp/0743273567?tag=abc"]);
    expect(screen.getByLabelText("Title")).toHaveValue("The Great Gatsby");
    expect(screen.getByText(/Amazon calls it/)).toHaveTextContent("The Great Gatsby: The Only Authorized Edition");

    await user.click(screen.getByRole("button", { name: "Use the full title" }));
    expect(screen.getByLabelText("Title")).toHaveValue("The Great Gatsby: The Only Authorized Edition");
  });

  it("takes a short share link when the helper is available", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ docs: [] }) }) as Response));
    const user = userEvent.setup();
    const repo = new HelperRepo({ asin: "0812974611", title: "Pompeii: A Novel", author: "Robert Harris", pages: 304, coverUrl: "https://m.media-amazon.com/images/I/61WHiS5vrRL._SL1195_.jpg" });
    renderApp(<AddPage />, repo);
    await fill(user, "https://a.co/d/0cU1u8Y5");
    expect(await screen.findByText(/Found Pompeii by Robert Harris \(304 pages, a cover\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add book" }));
    await screen.findByText(/to your library/);
    expect((await repo.listBooks()).find((b) => b.title === "Pompeii")).toMatchObject({ asin: "0812974611", pageCount: 304 });
  });

  it("explains that a short link needs the shared library and your passcode when there's no helper", async () => {
    const user = userEvent.setup();
    renderApp(<AddPage />);
    await fill(user, "https://a.co/d/0cU1u8Y5");
    expect(await screen.findByText(/Short Amazon share links need your passcode/)).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("says plainly when it can't read what was pasted, or can't find the book", async () => {
    const user = userEvent.setup();
    renderApp(<AddPage />);
    await fill(user, "The Great Gatsby");
    expect(await screen.findByText(/I couldn't read that/)).toBeInTheDocument();

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
    await user.clear(screen.getByLabelText("Amazon link"));
    await user.type(screen.getByLabelText("Amazon link"), "0743273567");
    await user.click(screen.getByRole("button", { name: "Fill in" }));
    expect(await screen.findByText(/couldn't find that book/)).toBeInTheDocument();
  });

  it("only enables Fill in when there's something to read", async () => {
    renderApp(<AddPage />);
    expect(await screen.findByRole("button", { name: "Fill in" })).toBeDisabled();
  });

  it("gives a book you already have only what it was missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ docs: [] }) }) as Response));
    const user = userEvent.setup();
    const repo = new HelperRepo({ asin: "0441172717", title: "Dune", author: "Frank Herbert", pages: 999, coverUrl: "https://m.media-amazon.com/images/I/new.jpg" });
    await repo.updateBook(dune.id, { title: dune.title, author: dune.author, pageCount: 612, genres: dune.genres, moods: dune.moods, sources: dune.sources.map((s) => s.source), coverUrl: undefined });
    renderApp(<AddPage />, repo);
    await fill(user, "https://www.amazon.com/dp/0441172717");
    await screen.findByText(/Check it, then Add/);
    await user.click(screen.getByRole("button", { name: "Add book" }));
    await screen.findByText(/already in your library/);
    const after = (await repo.listBooks()).find((b) => b.id === dune.id)!;
    expect(after.pageCount).toBe(612); // kept
    expect(after.coverUrl).toBe("https://m.media-amazon.com/images/I/new.jpg"); // filled
    expect(after.asin).toBe("0441172717");
    expect((await repo.listBooks()).filter((b) => b.title === "Dune")).toHaveLength(1);
  });
});

describe("the Amazon button on a book page", () => {
  it("goes straight to a book added from a link", async () => {
    const repo = newRepo();
    await repo.addBook({ title: "Zebra Tales", author: "Anna Smith", asin: "0743273567" });
    const id = (await repo.listBooks()).find((b) => b.title === "Zebra Tales")!.id;
    nav.params = new URLSearchParams({ id });
    renderApp(<BookPage />, repo);
    const link = await screen.findByRole("link", { name: /Find on Amazon/ });
    expect(link).toHaveAttribute("href", "https://www.amazon.com/dp/0743273567");
  });

  it("is still a plain search for a book without one", async () => {
    nav.params = new URLSearchParams({ id: dune.id });
    renderApp(<BookPage />);
    const link = await screen.findByRole("link", { name: /Find on Amazon/ });
    expect(link.getAttribute("href")).toMatch(/^https:\/\/www\.amazon\.com\/s\?k=Dune/);
    await waitFor(() => expect(link).toHaveAttribute("rel", "noopener noreferrer"));
  });
});
