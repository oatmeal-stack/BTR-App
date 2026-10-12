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
import HomePage from "@/app/page";
import MyListPage from "@/app/mylist/page";
import ProfilePage from "@/app/profile/page";
import ReadImportPage from "@/app/read-import/page";
import { AppShell } from "@/components/layout/AppShell";
import { SkinProvider } from "@/components/theme/SkinProvider";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";
import { LibraryProvider } from "@/hooks/useLibrary";
import { setIncludeRead } from "@/lib/prefs";
import { LocalBookRepository } from "@/repositories/LocalBookRepository";
import { memoryStorage } from "./helpers";

const dune = SAMPLE_BOOKS.find((b) => b.title === "Dune")!;
const road = SAMPLE_BOOKS.find((b) => b.title === "The Road")!;
const dove = SAMPLE_BOOKS.find((b) => b.title === "Lonesome Dove")!;
const ref = (b: { id: string; title: string; author?: string }) => ({ id: b.id, title: b.title, author: b.author });

const newRepo = () => new LocalBookRepository(memoryStorage(), SAMPLE_BOOKS);
/** Books the sample library already has as read (The Road, Station Eleven). */
const ALREADY_READ = SAMPLE_BOOKS.filter((b) => b.status === "read").length;

class LockedRepo extends LocalBookRepository {
  readonly requiresPasscode: boolean = true;
  readonly storageLabel: string = "Shared library (Supabase)";
  constructor() {
    super(memoryStorage(), SAMPLE_BOOKS);
  }
  hasPasscode() {
    return false;
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

const find = async (repo: LocalBookRepository, id: string) => (await repo.listBooks()).find((b) => b.id === id)!;

afterEach(() => {
  vi.unstubAllGlobals();
  setIncludeRead(false);
  nav.replace.mockClear();
  nav.params = new URLSearchParams();
  nav.path = "/";
});

describe("marking a book read", () => {
  const open = (repo = newRepo(), id = dune.id) => {
    nav.params = new URLSearchParams({ id });
    return renderApp(<BookPage />, repo);
  };

  it("toggles read with one button, and the reading card appears only while it's read", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    open(repo);
    await screen.findByRole("heading", { name: "Dune" });
    expect(screen.queryByRole("region", { name: "Your reading" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Mark as read" }));
    expect(screen.getByRole("button", { name: "Mark as read" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByLabelText("Date finished (optional)")).toBeInTheDocument();
    expect((await find(repo, dune.id)).status).toBe("read");

    await user.click(screen.getByRole("button", { name: "Mark as read" }));
    expect(screen.queryByLabelText("Date finished (optional)")).toBeNull();
    expect((await find(repo, dune.id)).status).toBe("want_to_read");
  });

  it("saves the date you finished", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.setStatus(dune.id, "read");
    open(repo);
    const date = await screen.findByLabelText("Date finished (optional)");
    await user.type(date, "2024-05-17");
    await waitFor(async () => expect((await find(repo, dune.id)).finishedOn).toBe("2024-05-17"));
  });

  it("takes a 1-5 star rating, and tapping the same star clears it", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.setStatus(dune.id, "read");
    open(repo);
    const stars = await screen.findByRole("group", { name: "Your rating" });
    await user.click(within(stars).getByRole("button", { name: "4 stars" }));
    expect(within(stars).getByRole("button", { name: "4 stars" })).toHaveAttribute("aria-pressed", "true");
    expect((await find(repo, dune.id)).myRating).toBe(4);
    await user.click(within(stars).getByRole("button", { name: "5 stars" }));
    expect((await find(repo, dune.id)).myRating).toBe(5);
    await user.click(within(stars).getByRole("button", { name: "5 stars" }));
    expect((await find(repo, dune.id)).myRating).toBeUndefined();
    expect(within(stars).getByRole("button", { name: "1 star" })).toBeInTheDocument();
  });

  it("changing the rating keeps the date, and the date keeps the rating", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.setStatus(dune.id, "read");
    await repo.setReadDetails(dune.id, { finishedOn: "2023-03-04", myRating: 3 });
    open(repo);
    const stars = await screen.findByRole("group", { name: "Your rating" });
    await user.click(within(stars).getByRole("button", { name: "5 stars" }));
    expect(await find(repo, dune.id)).toMatchObject({ finishedOn: "2023-03-04", myRating: 5 });
  });

  it("keeps them if you un-mark it and mark it again", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.setStatus(dune.id, "read");
    await repo.setReadDetails(dune.id, { finishedOn: "2023-03-04", myRating: 3 });
    open(repo);
    await user.click(await screen.findByRole("button", { name: "Mark as read" }));
    await user.click(screen.getByRole("button", { name: "Mark as read" }));
    expect(await screen.findByLabelText("Date finished (optional)")).toHaveValue("2023-03-04");
  });
});

describe("read books in the lists", () => {
  it("get a Read badge on their cover", async () => {
    const repo = newRepo();
    await repo.setStatus(dune.id, "read");
    renderApp(<BrowsePage />, repo);
    await screen.findByText(`${SAMPLE_BOOKS.length} books`);
    expect(document.querySelectorAll('.tile [aria-label="Read"]')).toHaveLength(ALREADY_READ + 1);
  });

  it("can be hidden in Browse when you're looking for something new", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.setStatus(dune.id, "read");
    renderApp(<BrowsePage />, repo);
    await screen.findByText(`${SAMPLE_BOOKS.length} books`);
    expect(screen.getByText("Dune", { selector: ".tile__title" })).toBeInTheDocument();

    await user.click(screen.getByLabelText("Read books"));
    expect(await screen.findByText(new RegExp(`^${SAMPLE_BOOKS.length - ALREADY_READ - 1} books`))).toBeInTheDocument();
    expect(screen.queryByText("Dune", { selector: ".tile__title" })).toBeNull();
    expect(screen.queryByText("The Road", { selector: ".tile__title" })).toBeNull();
    expect(screen.getByLabelText("Read books")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Read books")).toHaveTextContent("Hiding read");

    await user.click(screen.getByLabelText("Read books"));
    expect(await screen.findByText(`${SAMPLE_BOOKS.length} books`)).toBeInTheDocument();
  });
});

describe("random picks skip what you've read", () => {
  async function allReadExcept(...keep: string[]) {
    const repo = newRepo();
    for (const b of SAMPLE_BOOKS) if (!keep.includes(b.id)) await repo.setStatus(b.id, "read");
    return repo;
  }

  it("never offers a read book on Home, however often you shuffle", async () => {
    const user = userEvent.setup();
    const repo = await allReadExcept(dune.id, dove.id);
    renderApp(<HomePage />, repo);
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const pick = await screen.findByRole("region", { name: "Random pick" });
      seen.add(within(pick).getByRole("heading").textContent ?? "");
      await user.click(screen.getByRole("button", { name: /Shuffle/ }));
    }
    expect([...seen].every((t) => t === dune.title || t === dove.title)).toBe(true);
  });

  it("says so when everything is read, instead of calling the library empty", async () => {
    const repo = await allReadExcept();
    renderApp(<HomePage />, repo);
    expect(await screen.findByText("Nothing unread to pick")).toBeInTheDocument();
    expect(screen.queryByText("Your library is empty")).toBeNull();
  });

  it("drops the book you've just finished from the Home screen", async () => {
    const user = userEvent.setup();
    const repo = await allReadExcept(dune.id, dove.id);
    nav.params = new URLSearchParams({ id: dune.id });
    renderApp(<BookPage />, repo);
    await screen.findByRole("heading", { name: "Dune" });
    await user.click(screen.getByRole("button", { name: "Mark as read" }));
    expect((await find(repo, dune.id)).status).toBe("read");
  });

  it("can include read books, from Profile", async () => {
    const user = userEvent.setup();
    const repo = await allReadExcept();
    const profile = renderApp(<ProfilePage />, repo);
    const box = await screen.findByRole("checkbox", { name: /Include books I've read/ });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
    profile.unmount();

    renderApp(<HomePage />, repo);
    expect(await screen.findByRole("region", { name: "Random pick" })).toBeInTheDocument();
    expect(screen.queryByText("Nothing unread to pick")).toBeNull();
  });

  it("applies to 'Pick one for me' on a list too", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.createList({ id: "l1", name: "Couples" });
    await repo.addToList("l1", dune.id);
    await repo.addToList("l1", dove.id);
    await repo.setStatus(dune.id, "read");
    nav.params = new URLSearchParams({ id: "l1" });
    renderApp(<MyListPage />, repo);
    await screen.findByRole("heading", { name: "Couples" });
    for (let i = 0; i < 6; i++) {
      await user.click(screen.getByRole("button", { name: /Pick one for me/ }));
      const pick = await screen.findByRole("region", { name: "Your pick" });
      expect(within(pick).getByText(dove.title, { selector: ".tile__title" })).toBeInTheDocument();
    }
  });

  it("tells you when you've read everything on a list", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.createList({ id: "l1", name: "Couples" });
    await repo.addToList("l1", dune.id);
    await repo.setStatus(dune.id, "read");
    nav.params = new URLSearchParams({ id: "l1" });
    renderApp(<MyListPage />, repo);
    await user.click(await screen.findByRole("button", { name: /Pick one for me/ }));
    expect(await screen.findByText("You've read everything on this list.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your pick" })).toBeNull();
  });
});

describe("the Books I've read import", () => {
  const LIST = [
    "Dune by Frank Herbert – loved - a favorite of all time",
    "The Road – liked",
    "Zebra Tales by Anna Smith – ok",
    "Lonsome Dove",
  ].join("\n");

  async function review(repo = newRepo(), text = LIST) {
    const user = userEvent.setup();
    renderApp(<ReadImportPage />, repo);
    await user.type(await screen.findByLabelText("The books you've read"), text, { skipClick: false });
    await user.click(screen.getByRole("button", { name: "Review matches" }));
    return { user, repo };
  }

  it("won't review an empty paste", async () => {
    renderApp(<ReadImportPage />);
    expect(await screen.findByRole("button", { name: "Review matches" })).toBeDisabled();
  });

  it("shows what it found for every line before changing anything, flagging the doubtful one", async () => {
    const { repo } = await review();
    expect(await screen.findByText(/4/, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/2 matched, 1 to check, 1 not in your archive yet/)).toBeInTheDocument();
    expect(screen.getByText(/1 still needs your decision/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 3 books" })).toBeEnabled(); // Dune, The Road and the new one
    expect(screen.getByText("Check this")).toBeInTheDocument();
    // Nothing has changed yet.
    expect((await find(repo, dune.id)).status).toBe("want_to_read");
    expect((await repo.listBooks()).some((b) => b.title === "Zebra Tales")).toBe(false);
  });

  it("shows your verdict, rating and favorite for each line", async () => {
    await review();
    expect(await screen.findByLabelText("5 stars")).toBeInTheDocument();
    expect(screen.getByText(/loved - a favorite of all time/)).toBeInTheDocument();
    expect(screen.getByText(/favorite$/)).toBeInTheDocument();
  });

  it("imports: marks matches read with rating, favorite and note, and adds the new book", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ docs: [] }) }) as Response));
    const { user, repo } = await review();
    await user.selectOptions(await screen.findByLabelText(/What is .Lonsome Dove.\?/), `book:${dove.id}`);
    await user.click(screen.getByRole("button", { name: "Import 4 books" }));

    expect(await screen.findByText(/Marked/, { selector: "p" })).toHaveTextContent(/Marked 4 books as read, including 1 new book added/);

    expect(await find(repo, dune.id)).toMatchObject({ status: "read", myRating: 5, favorite: true });
    expect(await find(repo, road.id)).toMatchObject({ status: "read", myRating: 4 });
    expect(await find(repo, dove.id)).toMatchObject({ status: "read" });
    const zebra = (await repo.listBooks()).find((b) => b.title === "Zebra Tales")!;
    expect(zebra).toMatchObject({ status: "read", myRating: 3, author: "Anna Smith" });
    expect(zebra.sources.map((s) => s.source)).toEqual(["Already read"]);
    const notes = (await repo.listNotes()).map((n) => [n.bookId, n.body]);
    expect(notes).toContainEqual([dune.id, "loved - a favorite of all time"]);
    expect(notes).toContainEqual([road.id, "liked"]);
  });

  it("leaves a doubtful line alone until you decide, and says so at the end", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ docs: [] }) }) as Response));
    const { user, repo } = await review();
    await user.click(screen.getByRole("button", { name: "Import 3 books" }));
    expect(await screen.findByText(/1 left alone/)).toBeInTheDocument();
    expect((await find(repo, dove.id)).status).toBe("want_to_read");
  });

  it("lets you skip a line, or add a matched line as a new book instead", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ docs: [] }) }) as Response));
    const { user, repo } = await review();
    await user.selectOptions(screen.getByLabelText(/What is .The Road.\?/), "skip");
    await user.selectOptions(screen.getByLabelText(/What is .Dune.\?/), "new");
    expect(screen.getByRole("button", { name: "Import 2 books" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import 2 books" }));
    await screen.findByText(/Marked/, { selector: "p" });
    expect((await find(repo, road.id)).myRating).toBeUndefined(); // skipped: not touched
    // "Add as new" for a title you already have just finds that book again (no duplicate) and marks it read.
    expect(await find(repo, dune.id)).toMatchObject({ status: "read", myRating: 5 });
    expect((await repo.listBooks()).filter((b) => b.title === "Dune")).toHaveLength(1);
  });

  it("restores a book you'd removed when you read it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ docs: [] }) }) as Response));
    const repo = newRepo();
    await repo.removeBook(ref(dune));
    const { user } = await review(repo, "Dune by Frank Herbert – loved");
    expect(await screen.findByText(/You removed this earlier; it will be restored/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import 1 book" }));
    await screen.findByText(/brought back 1 you'd removed/);
    const back = await find(repo, dune.id);
    expect(back.status).toBe("read");
    expect(back.removedAt).toBeUndefined();
  });

  it("suggests an author for a new book you only know the title of, for you to accept", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return {
          ok: true,
          json: async () => ({
            docs: [
              { title: "East of Eden", author_name: ["John Steinbeck"], edition_count: 400 },
              { title: "East of Eden", author_name: ["Someone Else"], edition_count: 3 },
              { title: "East of Eden Companion", author_name: ["Nobody"], edition_count: 900 },
            ],
          }),
        } as Response;
      }),
    );
    const { user } = await review(newRepo(), "East of Eden");
    expect(await screen.findByLabelText(/Author of .East of Eden./)).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Suggest an author" }));
    const best = await screen.findByRole("button", { name: "Use John Steinbeck" });
    expect(best).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Someone Else" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use Nobody" })).toBeNull(); // a different title doesn't count
    await user.click(best);
    expect(screen.getByLabelText(/Author of .East of Eden./)).toHaveValue("John Steinbeck");
    expect(calls[0]).toContain("title=East+of+Eden");
  });

  it("looks up a cover and page count for a new book that has an author", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          docs: [{ title: "Zebra Tales", author_name: ["Anna Smith"], cover_i: 77, edition_count: 5, first_publish_year: 1999, number_of_pages_median: 250 }],
        }),
      }) as Response),
    );
    const { user, repo } = await review(newRepo(), "Zebra Tales by Anna Smith – liked");
    await user.click(screen.getByRole("button", { name: "Import 1 book" }));
    await screen.findByText(/Marked/, { selector: "p" });
    const zebra = (await repo.listBooks()).find((b) => b.title === "Zebra Tales")!;
    expect(zebra).toMatchObject({ coverUrl: "https://covers.openlibrary.org/b/id/77-M.jpg", pageCount: 250 });
    expect(zebra.year).toBeUndefined(); // Open Library's year is unreliable, so it isn't used
  });

  it("opens a saved draft as the list to review, and marks the draft added afterwards", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ docs: [] }) }) as Response));
    const user = userEvent.setup();
    const repo = newRepo();
    const body = "The Road – liked\nDune by Frank Herbert – loved";
    await repo.addDraft({ id: "d1", body });
    nav.params = new URLSearchParams({ draft: "d1" });
    renderApp(<ReadImportPage />, repo);
    await waitFor(() => expect(screen.getByLabelText("The books you've read")).toHaveValue(body));
    await user.click(screen.getByRole("button", { name: "Review matches" }));
    await user.click(screen.getByRole("button", { name: "Import 2 books" }));
    expect(await screen.findByText(/Marked/, { selector: "p" })).toHaveTextContent(/Marked 2 books as read/);
    expect((await repo.listMyData()).inbox[0]).toMatchObject({ id: "d1", status: "added", body });
  });

  it("explains that importing needs your passcode when you're not signed in", async () => {
    renderApp(<ReadImportPage />, new LockedRepo());
    expect(await screen.findByText(/Importing needs your passcode/)).toBeInTheDocument();
  });

  it("can start over, and import another list afterwards", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ docs: [] }) }) as Response));
    const { user } = await review(newRepo(), "The Road – liked");
    await user.click(screen.getByRole("button", { name: "Back to the list" }));
    expect(screen.getByLabelText("The books you've read")).toHaveValue("The Road – liked");
    await user.click(screen.getByRole("button", { name: "Review matches" }));
    await user.click(screen.getByRole("button", { name: "Import 1 book" }));
    await user.click(await screen.findByRole("button", { name: "Import another list" }));
    expect(screen.getByLabelText("The books you've read")).toHaveValue("");
  });
});
