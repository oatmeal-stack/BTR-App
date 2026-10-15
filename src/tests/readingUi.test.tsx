import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
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
import BrowsePage from "@/app/browse/page";
import ReadingPage from "@/app/reading/page";
import { AppShell } from "@/components/layout/AppShell";
import { SkinProvider } from "@/components/theme/SkinProvider";
import type { Book } from "@/domain/book";
import { todayLocal, dayLabel } from "@/domain/readingActions";
import { LibraryProvider } from "@/hooks/useLibrary";
import { LocalBookRepository } from "@/repositories/LocalBookRepository";
import { ROUTES } from "@/routes";
import { memoryStorage } from "./helpers";

const NOW = "2026-10-01T12:00:00.000Z";
const mk = (id: string, title: string, author: string, over: Partial<Book> = {}): Book => ({
  id,
  title,
  author,
  status: "want_to_read",
  favorite: false,
  genres: [],
  moods: [],
  sources: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

/** The four books to start with (no start dates, no source tags), plus a few on the shelf. */
const shelf = (): Book[] => [
  mk("hobbit", "The Hobbit", "J.R.R. Tolkien", { status: "reading" }),
  mk("gates", "The Gates of Midnight", "Helene Wecker", { status: "reading" }),
  mk("genesis", "Genesis", "Bernard Beckett", { status: "reading" }),
  mk("alchemist", "The Alchemist", "Paulo Coelho", { status: "reading" }),
  mk("dune", "Dune", "Frank Herbert", { sources: [{ source: "Man Book Club", rank: 3 }] }),
  mk("road", "The Road", "Cormac McCarthy", { sources: [{ source: "Tough Guy Book Club" }] }),
  mk("dove", "Lonesome Dove", "Larry McMurtry"),
];

const newRepo = () => new LocalBookRepository(memoryStorage(), shelf());

/** A shared library this device hasn't signed in to. */
class LockedRepo extends LocalBookRepository {
  readonly requiresPasscode: boolean = true;
  readonly storageLabel: string = "Shared library (Supabase)";
  constructor() {
    super(memoryStorage(), shelf());
  }
  hasPasscode() {
    return false;
  }
  async listMyData() {
    return { lists: [], items: [], inbox: [], next: [], takes: [] };
  }
}

function renderApp(ui: ReactNode, repo: LocalBookRepository = newRepo()) {
  return render(
    <SkinProvider>
      <LibraryProvider repository={repo}>
        <AppShell>{ui}</AppShell>
      </LibraryProvider>
    </SkinProvider>,
  );
}

afterEach(() => {
  nav.replace.mockClear();
  nav.params = new URLSearchParams();
  nav.path = "/";
});

const book = async (repo: LocalBookRepository, id: string) => (await repo.listBooks()).find((b) => b.id === id)!;
const section = (name: RegExp) => screen.getByRole("button", { name });

describe("the Reading tab: reading now", () => {
  it("opens with the four books, each with its own Start and Finish and the right author", async () => {
    renderApp(<ReadingPage />);
    const list = await screen.findByRole("list", { name: "Reading now" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(4);
    for (const [title, author] of [
      ["The Hobbit", "J.R.R. Tolkien"],
      ["The Gates of Midnight", "Helene Wecker"],
      ["Genesis", "Bernard Beckett"],
      ["The Alchemist", "Paulo Coelho"],
    ]) {
      const card = cards.find((c) => within(c).queryByRole("link", { name: title }))!;
      expect(card).toBeTruthy();
      expect(within(card).getByText(author)).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: `Start ${title}` })).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: `Finish ${title}` })).toBeInTheDocument();
      expect(within(card).getByText(/No source yet/)).toBeInTheDocument(); // blank, for you to fill in
    }
  });

  it("shows the counts on the three sections", async () => {
    renderApp(<ReadingPage />);
    expect(await screen.findByRole("button", { name: "Reading now (4)" })).toHaveAttribute("aria-pressed", "true");
    expect(section(/Next books \(0\)/)).toBeInTheDocument();
    expect(section(/Finished \(0\)/)).toBeInTheDocument();
  });

  it("Start records today's date for that book only, and the button goes away", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    renderApp(<ReadingPage />, repo);
    await user.click(await screen.findByRole("button", { name: "Start The Hobbit" }));
    expect(await screen.findByText(`Started ${dayLabel(todayLocal())}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start The Hobbit" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Genesis" })).toBeInTheDocument();
    expect((await book(repo, "hobbit")).startedOn).toBe(todayLocal());
    expect((await book(repo, "genesis")).startedOn).toBeUndefined();
  });

  it("nothing is dated until Start is pressed", async () => {
    const repo = newRepo();
    renderApp(<ReadingPage />, repo);
    await screen.findByRole("list", { name: "Reading now" });
    for (const id of ["hobbit", "gates", "genesis", "alchemist"]) {
      expect((await book(repo, id)).startedOn).toBeUndefined();
      expect((await book(repo, id)).finishedOn).toBeUndefined();
    }
  });

  it("Finish asks for a rating and a take, then moves just that book to Finished", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    renderApp(<ReadingPage />, repo);
    await user.click(await screen.findByRole("button", { name: "Start Genesis" }));
    await user.click(screen.getByRole("button", { name: "Finish Genesis" }));

    const dialog = await screen.findByRole("dialog", { name: "Finish Genesis" });
    await user.click(within(dialog).getByRole("button", { name: "4 stars" }));
    await user.type(within(dialog).getByLabelText(/My Take/), "Short, sharp and unsettling.");
    await user.click(within(dialog).getByRole("button", { name: "Finish book" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const list = screen.getByRole("list", { name: "Reading now" });
    expect(within(list).queryByRole("link", { name: "Genesis" })).not.toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Reading now (3)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finished (1)" })).toBeInTheDocument();

    const done = await book(repo, "genesis");
    expect(done).toMatchObject({ status: "read", startedOn: todayLocal(), finishedOn: todayLocal(), myRating: 4 });
    expect((await repo.listMyData()).takes[0]).toMatchObject({ bookId: "genesis", body: "Short, sharp and unsettling." });
    expect((await book(repo, "hobbit")).status).toBe("reading"); // the others carry on
  });

  it("Finish works with the rating and take left empty, and can be cancelled", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    renderApp(<ReadingPage />, repo);
    await user.click(await screen.findByRole("button", { name: "Finish The Alchemist" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect((await book(repo, "alchemist")).status).toBe("reading");

    await user.click(screen.getByRole("button", { name: "Finish The Alchemist" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Finish book" }));
    await waitFor(async () => expect((await book(repo, "alchemist")).status).toBe("read"));
    expect((await book(repo, "alchemist")).myRating).toBeUndefined();
    expect((await repo.listMyData()).takes).toEqual([]);
  });

  it("an empty section says what to do", async () => {
    const repo = new LocalBookRepository(memoryStorage(), [mk("dune", "Dune", "Frank Herbert")]);
    renderApp(<ReadingPage />, repo);
    expect(await screen.findByText("Nothing in progress")).toBeInTheDocument();
  });

  it("each card links to the book's page for its notes", async () => {
    renderApp(<ReadingPage />);
    const card = (await screen.findAllByRole("listitem")).find((c) => within(c).queryByRole("link", { name: "The Hobbit" }))!;
    expect(within(card).getByRole("link", { name: /Add notes/ })).toHaveAttribute("href", `${ROUTES.book("hobbit")}#notes`);
  });

  it("explains that the queue and takes are private until you sign in", async () => {
    renderApp(<ReadingPage />, new LockedRepo());
    expect(await screen.findByText(/queue, notes and takes are private/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Enter your passcode in Profile/ })).toHaveAttribute("href", ROUTES.profile);
  });
});

describe("the Reading tab: Next books", () => {
  async function withQueue() {
    const repo = newRepo();
    await repo.addToNext("dune");
    await repo.addToNext("road");
    await repo.addToNext("dove");
    return repo;
  }
  const openNext = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: /Next books \(/ }));
    return screen.findByRole("list", { name: "Next books, in order" });
  };

  it("shows the queue in rank order with each book's source tag", async () => {
    const user = userEvent.setup();
    renderApp(<ReadingPage />, await withQueue());
    const list = await openNext(user);
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".row__title")?.textContent)).toEqual(["Dune", "The Road", "Lonesome Dove"]);
    expect(within(rows[0]).getByText("Man Book Club")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Tough Guy Book Club")).toBeInTheDocument();
  });

  it("moves a book up or down and saves the new order", async () => {
    const user = userEvent.setup();
    const repo = await withQueue();
    renderApp(<ReadingPage />, repo);
    await openNext(user);
    await user.click(screen.getByRole("button", { name: "Move Lonesome Dove up" }));
    await user.click(screen.getByRole("button", { name: "Move Lonesome Dove up" }));
    const order = () => within(screen.getByRole("list", { name: "Next books, in order" })).getAllByRole("listitem").map((r) => r.querySelector(".row__title")?.textContent);
    expect(order()).toEqual(["Lonesome Dove", "Dune", "The Road"]);
    await user.click(screen.getByRole("button", { name: "Move Dune down" }));
    expect(order()).toEqual(["Lonesome Dove", "The Road", "Dune"]);
    expect((await repo.listMyData()).next.sort((a, b) => a.position - b.position).map((n) => n.bookId)).toEqual(["dove", "road", "dune"]);
  });

  it("can't move the first book up or the last one down", async () => {
    const user = userEvent.setup();
    renderApp(<ReadingPage />, await withQueue());
    await openNext(user);
    expect(screen.getByRole("button", { name: "Move Dune up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Lonesome Dove down" })).toBeDisabled();
  });

  it("the order is still there after closing and reopening the app", async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    const first = new LocalBookRepository(storage, shelf());
    await first.addToNext("dune");
    await first.addToNext("road");
    renderApp(<ReadingPage />, first);
    await openNext(user);
    await user.click(screen.getByRole("button", { name: "Move The Road up" }));
    document.body.innerHTML = "";

    const user2 = userEvent.setup();
    renderApp(<ReadingPage />, new LocalBookRepository(storage, shelf()));
    const list = await openNext(user2);
    expect(within(list).getAllByRole("listitem").map((r) => r.querySelector(".row__title")?.textContent)).toEqual(["The Road", "Dune"]);
  });

  it("moves a queued book into Reading now, undated until Start", async () => {
    const user = userEvent.setup();
    const repo = await withQueue();
    renderApp(<ReadingPage />, repo);
    await openNext(user);
    await user.click(screen.getByRole("button", { name: "Move Dune to Reading now" }));
    expect(screen.getByRole("button", { name: "Next books (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reading now (5)" })).toBeInTheDocument();
    expect((await book(repo, "dune")).status).toBe("reading");
    expect((await book(repo, "dune")).startedOn).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Reading now (5)" }));
    expect(within(await screen.findByRole("list", { name: "Reading now" })).getByRole("button", { name: "Start Dune" })).toBeInTheDocument();
    // Several books are active at once: the original four plus this one.
    expect(within(screen.getByRole("list", { name: "Reading now" })).getAllByRole("listitem")).toHaveLength(5);
  });

  it("takes a book off the queue without losing it", async () => {
    const user = userEvent.setup();
    const repo = await withQueue();
    renderApp(<ReadingPage />, repo);
    await openNext(user);
    await user.click(screen.getByRole("button", { name: "Take The Road off Next books" }));
    expect(screen.getByRole("button", { name: "Next books (2)" })).toBeInTheDocument();
    expect((await book(repo, "road")).status).toBe("want_to_read");
  });

  it("an empty queue points at Browse", async () => {
    const user = userEvent.setup();
    renderApp(<ReadingPage />);
    await openNext(user).catch(() => null);
    expect(await screen.findByText("Your queue is empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse books" })).toHaveAttribute("href", ROUTES.browse);
  });

  it("can be opened straight from a link", async () => {
    nav.params = new URLSearchParams({ tab: "next" });
    renderApp(<ReadingPage />, await withQueue());
    expect(await screen.findByRole("button", { name: "Next books (3)" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("adding to Next books from Browse and from a book's page", () => {
  it("a button on each unread book's cover lines it up, and lights up when it is queued", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    renderApp(<BrowsePage />, repo);
    const add = await screen.findByRole("button", { name: "Add Dune to Next books" });
    expect(add).toHaveAttribute("aria-pressed", "false");
    await user.click(add);
    const on = await screen.findByRole("button", { name: "Take Dune off Next books" });
    expect(on).toHaveAttribute("aria-pressed", "true");
    expect((await repo.listMyData()).next.map((n) => n.bookId)).toEqual(["dune"]);
    await user.click(on);
    expect((await repo.listMyData()).next).toEqual([]);
  });

  it("books already being read have no queue button on their cover", async () => {
    renderApp(<BrowsePage />);
    await screen.findByRole("button", { name: "Add Dune to Next books" });
    expect(screen.queryByRole("button", { name: /The Hobbit to Next books/ })).not.toBeInTheDocument();
  });

  it("browse still finds and filters books as before", async () => {
    const user = userEvent.setup();
    renderApp(<BrowsePage />);
    await screen.findByRole("button", { name: "Add Dune to Next books" });
    expect(screen.getByText("7 books")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("List"), "Man Book Club");
    // "1 book · Clear" is split across text nodes and a button, so match the whole line.
    expect(screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").startsWith("1 book"))).toBeInTheDocument();
  });

  it("the book page has an Add to Next books toggle that follows the queue", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: "dune" });
    const repo = newRepo();
    renderApp(<BookPage />, repo);
    await user.click(await screen.findByRole("button", { name: /Add to Next books/ }));
    expect(await screen.findByRole("button", { name: /In Next books/ })).toHaveAttribute("aria-pressed", "true");
    expect((await repo.listMyData()).next.map((n) => n.bookId)).toEqual(["dune"]);
    await user.click(screen.getByRole("button", { name: /In Next books/ }));
    expect(await screen.findByRole("button", { name: /Add to Next books/ })).toBeInTheDocument();
  });

  it("setting a queued book to Reading from its page takes it off the queue", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: "dune" });
    const repo = newRepo();
    await repo.addToNext("dune");
    renderApp(<BookPage />, repo);
    await user.click(await screen.findByRole("button", { name: "Reading" }));
    await waitFor(async () => expect((await repo.listMyData()).next).toEqual([]));
    expect(screen.queryByRole("button", { name: /Next books/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Reading now" })).toBeInTheDocument();
  });
});

describe("a finished book's page holds everything in one place", () => {
  async function finishedGenesis() {
    const repo = newRepo();
    await repo.updateBook("genesis", {
      title: "Genesis",
      author: "Bernard Beckett",
      pageCount: 150,
      year: 2006,
      genres: [],
      moods: [],
      sources: ["NYT Spy Novels"],
    });
    await repo.startReading("genesis", "2026-10-01");
    await repo.addNote("genesis", "Great opening. Map: https://example.com/map", "Ch. 1");
    await repo.addNote("genesis", "The twist lands", "Ch. 9");
    await repo.finishReading("genesis", { on: "2026-10-20", rating: 5, take: "Brilliant." });
    return repo;
  }

  it("shows the book, its source tag, both dates, the rating, the take, and every note", async () => {
    nav.params = new URLSearchParams({ id: "genesis" });
    renderApp(<BookPage />, await finishedGenesis());
    expect(await screen.findByRole("heading", { name: "Genesis" })).toBeInTheDocument();
    expect(screen.getByText("Bernard Beckett")).toBeInTheDocument();
    expect(screen.getByText(/150 pages/)).toBeInTheDocument();
    expect(screen.getByText("NYT Spy Novels")).toBeInTheDocument();
    expect(screen.getByText("Oct 1, 2026")).toBeInTheDocument(); // started
    expect(screen.getByLabelText("Date finished (optional)")).toHaveValue("2026-10-20");
    expect(screen.getByRole("button", { name: "5 stars" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("My Take")).toHaveValue("Brilliant.");
    expect(screen.getByRole("heading", { name: "Private notes (2)" })).toBeInTheDocument();
  });

  it("lists the notes oldest first with their chapters, and the link opens in a new tab", async () => {
    nav.params = new URLSearchParams({ id: "genesis" });
    renderApp(<BookPage />, await finishedGenesis());
    await screen.findByRole("heading", { name: "Private notes (2)" });
    const notes = screen.getByRole("region", { name: /Private notes/ });
    const text = notes.textContent ?? "";
    expect(text.indexOf("Great opening")).toBeLessThan(text.indexOf("The twist lands"));
    expect(within(notes).getAllByLabelText("Chapter", { selector: "span" }).map((c) => c.textContent)).toEqual(["Ch. 1", "Ch. 9"]);
    const link = within(notes).getByRole("link", { name: "https://example.com/map" });
    expect(link).toHaveAttribute("href", "https://example.com/map");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("appears under Finished on the Reading tab, newest first, and opens as that page", async () => {
    const user = userEvent.setup();
    const repo = await finishedGenesis();
    await repo.startReading("hobbit", "2026-09-01");
    await repo.finishReading("hobbit", { on: "2026-10-25", rating: 3 });
    renderApp(<ReadingPage />, repo);
    await user.click(await screen.findByRole("button", { name: /Finished \(2\)/ }));
    const rows = within(await screen.findByRole("list", { name: "Finished books" })).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".row__title")?.textContent)).toEqual(["The Hobbit", "Genesis"]);
    expect(rows[1]).toHaveTextContent("Finished Oct 20, 2026");
    expect(rows[1]).toHaveTextContent("★★★★★");
    expect(within(rows[1]).getByRole("link")).toHaveAttribute("href", ROUTES.book("genesis"));
  });

  it("My Take can be edited later", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: "genesis" });
    const repo = await finishedGenesis();
    renderApp(<BookPage />, repo);
    const box = await screen.findByLabelText("My Take");
    await user.clear(box);
    await user.type(box, "Better the second time.");
    await user.click(screen.getByRole("button", { name: "Save my take" }));
    await waitFor(async () => expect((await repo.listMyData()).takes[0].body).toBe("Better the second time."));
  });

  it("a book being read shows Start and Finish on its own page too", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: "hobbit" });
    const repo = newRepo();
    renderApp(<BookPage />, repo);
    await user.click(await screen.findByRole("button", { name: "Start The Hobbit" }));
    expect(await screen.findByText(`Started ${dayLabel(todayLocal())}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish The Hobbit" })).toBeInTheDocument();
  });
});

describe("notes while reading", () => {
  it("saves a note with a chapter and the time it was written, and clears the boxes", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: "hobbit" });
    const repo = newRepo();
    renderApp(<BookPage />, repo);
    await user.type(await screen.findByLabelText("Chapter (optional)"), "Ch. 3");
    await user.type(screen.getByLabelText("Add a note"), "Riddles in the dark - watch https://www.youtube.com/watch?v=xyz");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    const link = await screen.findByRole("link", { name: "https://www.youtube.com/watch?v=xyz" });
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=xyz");
    expect(screen.getByLabelText("Chapter (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Add a note")).toHaveValue("");
    const [saved] = await repo.listNotes();
    expect(saved).toMatchObject({ bookId: "hobbit", chapter: "Ch. 3" });
    expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false); // stamped automatically
  });

  it("a note without a chapter is fine", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: "hobbit" });
    const repo = newRepo();
    renderApp(<BookPage />, repo);
    await user.type(await screen.findByLabelText("Add a note"), "Just a thought");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    await screen.findByText("Just a thought");
    expect((await repo.listNotes())[0].chapter).toBeUndefined();
  });

  it("keeps each note with its own book", async () => {
    nav.params = new URLSearchParams({ id: "hobbit" });
    const repo = newRepo();
    await repo.addNote("genesis", "Belongs to Genesis");
    await repo.addNote("hobbit", "Belongs to the Hobbit");
    renderApp(<BookPage />, repo);
    expect(await screen.findByText("Belongs to the Hobbit")).toBeInTheDocument();
    expect(screen.queryByText("Belongs to Genesis")).not.toBeInTheDocument();
  });

  it("editing a note can change its chapter", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: "hobbit" });
    const repo = newRepo();
    await repo.addNote("hobbit", "First pass", "Ch. 1");
    renderApp(<BookPage />, repo);
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const chapter = screen.getAllByLabelText("Chapter (optional)")[0];
    await user.clear(chapter);
    await user.type(chapter, "Ch. 2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await repo.listNotes())[0].chapter).toBe("Ch. 2"));
  });
});

describe("the tab bar", () => {
  it("has a Reading tab between Browse and Library", async () => {
    nav.path = ROUTES.reading;
    renderApp(<ReadingPage />);
    const tabs = within(await screen.findByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(tabs.map((t) => t.textContent)).toEqual(["Home", "Browse", "Reading", "Library", "Lists", "Profile"]);
    expect(tabs[2]).toHaveAttribute("aria-current", "page");
  });
});
