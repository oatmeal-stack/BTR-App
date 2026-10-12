import type { ReactNode } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
import DraftsPage from "@/app/drafts/page";
import ListsPage from "@/app/lists/page";
import MyListPage from "@/app/mylist/page";
import { AppShell } from "@/components/layout/AppShell";
import { SkinProvider } from "@/components/theme/SkinProvider";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";
import { LibraryProvider } from "@/hooks/useLibrary";
import { LocalBookRepository } from "@/repositories/LocalBookRepository";
import { memoryStorage } from "./helpers";

const dune = SAMPLE_BOOKS.find((b) => b.title === "Dune")!;
const road = SAMPLE_BOOKS.find((b) => b.title === "The Road")!;
const dove = SAMPLE_BOOKS.find((b) => b.title === "Lonesome Dove")!;

const newRepo = () => new LocalBookRepository(memoryStorage(), SAMPLE_BOOKS);

/** A shared library this device hasn't signed in to: lists and drafts are private, so nothing shows. */
class LockedRepo extends LocalBookRepository {
  readonly requiresPasscode: boolean = true;
  readonly storageLabel: string = "Shared library (Supabase)";
  constructor() {
    super(memoryStorage(), SAMPLE_BOOKS);
  }
  hasPasscode() {
    return false;
  }
  async listMyData() {
    return { lists: [], items: [], inbox: [] };
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

async function withLists(repo = newRepo()) {
  await repo.createList({ id: "l-couples", name: "Couples Book Club" });
  await repo.createList({ id: "l-rd", name: "Rough Drafts Potentials" });
  await repo.createList({ id: "l-personal", name: "Personal Books" });
  return repo;
}

afterEach(() => {
  vi.unstubAllGlobals();
  nav.replace.mockClear();
  nav.params = new URLSearchParams();
  nav.path = "/";
});

describe("the Lists tab", () => {
  it("makes your own lists, shows how many books are on each, and links to them", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    renderApp(<ListsPage />, repo);
    await screen.findByText("My lists");

    await user.type(screen.getByLabelText("New list name"), "Couples Book Club");
    await user.click(screen.getByRole("button", { name: /Make list/ }));

    const link = await screen.findByRole("link", { name: /Couples Book Club/ });
    expect(link).toHaveAttribute("href", "/mylist?id=" + encodeURIComponent((await repo.listMyData()).lists[0].id));
    expect(within(link).getByText("0")).toBeInTheDocument();
    expect(screen.getByLabelText("New list name")).toHaveValue("");
  });

  it("won't make a blank list or a second list with the same name", async () => {
    const user = userEvent.setup();
    const repo = await withLists();
    renderApp(<ListsPage />, repo);
    await screen.findByText("Personal Books");
    await user.type(screen.getByLabelText("New list name"), "  personal   books ");
    await user.click(screen.getByRole("button", { name: /Make list/ }));
    expect(await screen.findByText("You already have a list with that name.")).toBeInTheDocument();
    expect((await repo.listMyData()).lists).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Make list/ })).toBeEnabled();
    await user.clear(screen.getByLabelText("New list name"));
    expect(screen.getByRole("button", { name: /Make list/ })).toBeDisabled();
  });

  it("counts only visible books, and links to Drafts with the number waiting", async () => {
    const repo = await withLists();
    await repo.addToList("l-couples", dune.id);
    await repo.addToList("l-couples", road.id);
    await repo.removeBook({ id: dune.id, title: dune.title, author: dune.author });
    await repo.addDraft({ id: "d1", body: "one" });
    await repo.addDraft({ id: "d2", body: "two" });
    renderApp(<ListsPage />, repo);
    const couples = await screen.findByRole("link", { name: /Couples Book Club/ });
    expect(within(couples).getByText("1")).toBeInTheDocument();
    const drafts = screen.getByRole("link", { name: /^Drafts/ });
    expect(drafts).toHaveAttribute("href", "/drafts");
    expect(within(drafts).getByText("2")).toBeInTheDocument();
  });

  it("explains that lists are private when this device isn't signed in", async () => {
    renderApp(<ListsPage />, new LockedRepo());
    expect(await screen.findByText(/Your lists and drafts are private/)).toBeInTheDocument();
    expect(screen.queryByLabelText("New list name")).toBeNull();
    expect(screen.getByText("Where your books came from")).toBeInTheDocument(); // the public lists still show
  });
});

describe("Add to list on a book", () => {
  it("ticks a book onto several lists and off again", async () => {
    const user = userEvent.setup();
    const repo = await withLists();
    nav.params = new URLSearchParams({ id: dune.id });
    renderApp(<BookPage />, repo);
    await screen.findByRole("heading", { name: "Dune" });

    await user.click(screen.getByRole("button", { name: "Add to list" }));
    const panel = screen.getByRole("group", { name: "Add to list" });
    await user.click(within(panel).getByRole("button", { name: "Couples Book Club" }));
    await user.click(within(panel).getByRole("button", { name: "Rough Drafts Potentials" }));
    expect(within(panel).getByRole("button", { name: "Couples Book Club" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "On 2 lists" })).toBeInTheDocument();
    expect((await repo.listMyData()).items.filter((i) => i.bookId === dune.id)).toHaveLength(2);

    await user.click(within(panel).getByRole("button", { name: "Couples Book Club" }));
    expect(screen.getByRole("button", { name: "On 1 list" })).toBeInTheDocument();
    expect((await repo.listMyData()).items.filter((i) => i.bookId === dune.id).map((i) => i.listId)).toEqual(["l-rd"]);
  });

  it("makes a new list and puts the book straight on it", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    nav.params = new URLSearchParams({ id: dune.id });
    renderApp(<BookPage />, repo);
    await screen.findByRole("heading", { name: "Dune" });
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect(screen.getByText(/don't have any lists yet/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("New list name"), "Books to read with my wife");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("button", { name: "On 1 list" })).toBeInTheDocument();
    const data = await repo.listMyData();
    expect(data.lists.map((l) => l.name)).toEqual(["Books to read with my wife"]);
    expect(data.items.map((i) => i.bookId)).toEqual([dune.id]);
  });

  it("says lists are private when not signed in", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: dune.id });
    renderApp(<BookPage />, new LockedRepo());
    await screen.findByRole("heading", { name: "Dune" });
    await user.click(screen.getByRole("button", { name: "Add to list" }));
    expect(screen.getByText(/Your lists are private/)).toBeInTheDocument();
    expect(screen.queryByLabelText("New list name")).toBeNull();
  });
});

describe("a list", () => {
  async function filled() {
    const repo = await withLists();
    for (const b of [dune, road, dove]) await repo.addToList("l-couples", b.id);
    return repo;
  }
  const open = (repo: LocalBookRepository, id = "l-couples") => {
    nav.params = new URLSearchParams({ id });
    return renderApp(<MyListPage />, repo);
  };

  it("shows its books as cover cards in the list's own order", async () => {
    const repo = await filled();
    await repo.reorderList("l-couples", [dove.id, dune.id, road.id]);
    open(repo);
    expect(await screen.findByRole("heading", { name: "Couples Book Club" })).toBeInTheDocument();
    const tiles = document.querySelectorAll(".grid .tile__title");
    expect([...tiles].map((t) => t.textContent)).toEqual([dove.title, dune.title, road.title]);
    expect(screen.getByText("3 books")).toBeInTheDocument();
  });

  it("hides a removed book, and it returns when restored", async () => {
    const repo = await filled();
    await repo.removeBook({ id: road.id, title: road.title, author: road.author });
    const first = open(repo);
    await screen.findByRole("heading", { name: "Couples Book Club" });
    expect([...document.querySelectorAll(".grid .tile__title")].map((t) => t.textContent)).not.toContain(road.title);
    first.unmount();
    await repo.restoreBook(road.id);
    open(repo);
    await screen.findByRole("heading", { name: "Couples Book Club" });
    expect([...document.querySelectorAll(".grid .tile__title")].map((t) => t.textContent)).toContain(road.title);
  });

  it("picks one for you from the list", async () => {
    const user = userEvent.setup();
    const repo = await filled();
    open(repo);
    await screen.findByRole("heading", { name: "Couples Book Club" });
    await user.click(screen.getByRole("button", { name: /Pick one for me/ }));
    const pick = await screen.findByRole("region", { name: "Your pick" });
    expect([dune.title, road.title, dove.title]).toContain(within(pick).getByText(/./, { selector: ".tile__title" }).textContent);
  });

  it("reorders with the arrows and saves the new order", async () => {
    const user = userEvent.setup();
    const repo = await filled();
    open(repo);
    await user.click(await screen.findByRole("button", { name: "Reorder" }));
    await user.click(screen.getByRole("button", { name: `Move ${dove.title} up` }));
    await waitFor(async () => {
      const items = (await repo.listMyData()).items.filter((i) => i.listId === "l-couples").sort((a, b) => a.position - b.position);
      expect(items.map((i) => i.bookId)).toEqual([dune.id, dove.id, road.id]);
    });
    expect(screen.getByRole("button", { name: `Move ${dune.title} up` })).toBeDisabled(); // first can't go higher
    expect(screen.getByRole("button", { name: `Move ${road.title} down` })).toBeDisabled(); // last can't go lower
  });

  it("takes a book off the list without deleting it", async () => {
    const user = userEvent.setup();
    const repo = await filled();
    open(repo);
    await user.click(await screen.findByRole("button", { name: "Reorder" }));
    await user.click(screen.getByRole("button", { name: `Take ${road.title} off this list` }));
    await waitFor(async () => expect((await repo.listMyData()).items.some((i) => i.bookId === road.id)).toBe(false));
    expect((await repo.listBooks()).find((b) => b.id === road.id)?.removedAt).toBeUndefined();
  });

  it("renames, but not to a name another list has", async () => {
    const user = userEvent.setup();
    const repo = await filled();
    open(repo);
    await user.click(await screen.findByRole("button", { name: "Rename" }));
    const field = screen.getByLabelText("List name");
    await user.clear(field);
    await user.type(field, "personal books");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByText("You already have a list with that name.")).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, "Couples (with Leigh)");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("heading", { name: "Couples (with Leigh)" })).toBeInTheDocument();
    expect((await repo.listMyData()).lists.find((l) => l.id === "l-couples")?.name).toBe("Couples (with Leigh)");
  });

  it("asks before deleting, and deleting leaves every book in the library", async () => {
    const user = userEvent.setup();
    const repo = await filled();
    const booksBefore = (await repo.listBooks()).length;
    open(repo);
    await user.click(await screen.findByRole("button", { name: /Delete list/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/books on it stay in your library/);
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect((await repo.listMyData()).lists).toHaveLength(3); // nothing happened

    await user.click(screen.getByRole("button", { name: /Delete list/ }));
    await user.click(screen.getByRole("button", { name: "Delete the list" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/lists"));
    expect((await repo.listMyData()).lists.map((l) => l.id)).not.toContain("l-couples");
    expect((await repo.listBooks()).length).toBe(booksBefore);
  });

  it("adds a book found by searching your library", async () => {
    const user = userEvent.setup();
    const repo = await withLists();
    open(repo, "l-rd");
    await screen.findByRole("heading", { name: "Rough Drafts Potentials" });
    await user.type(screen.getByLabelText("Search your library"), "dune");
    await user.click(await screen.findByRole("button", { name: `Add ${dune.title} to Rough Drafts Potentials` }));
    await waitFor(async () => expect((await repo.listMyData()).items).toMatchObject([{ listId: "l-rd", bookId: dune.id }]));
    expect(await screen.findByText("1 book")).toBeInTheDocument();
  });

  it("says so for a list that doesn't exist, and when not signed in", async () => {
    open(newRepo(), "nope");
    expect(await screen.findByText("List not found")).toBeInTheDocument();
    nav.params = new URLSearchParams({ id: "l-couples" });
    renderApp(<MyListPage />, new LockedRepo());
    expect(await screen.findByText("Your lists are private")).toBeInTheDocument();
  });
});

describe("Browse by one of your lists", () => {
  it("shows only that list's books, in the list's order, and only when you have lists", async () => {
    const repo = await withLists();
    await repo.addToList("l-rd", dove.id);
    await repo.addToList("l-rd", dune.id);
    nav.params = new URLSearchParams({ list: "l-rd" });
    renderApp(<BrowsePage />, repo);
    expect(await screen.findByText(/^2 books/)).toBeInTheDocument();
    expect([...document.querySelectorAll(".grid .tile__title")].map((t) => t.textContent)).toEqual([dove.title, dune.title]);
    expect(screen.getByLabelText("My list")).toHaveValue("l-rd");
  });

  it("has no 'My list' filter until you've made a list", async () => {
    renderApp(<BrowsePage />, newRepo());
    await screen.findByText(`${SAMPLE_BOOKS.length} books`);
    expect(screen.queryByLabelText("My list")).toBeNull();
  });
});

describe("Quick note", () => {
  it("is always there, saves a draft in one go, and counts what's waiting", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    renderApp(<ListsPage />, repo);
    await user.click(await screen.findByRole("button", { name: "Quick note" }));
    await user.type(screen.getByRole("textbox", { name: "Quick note" }), "That spy novel about Berlin Mark mentioned");
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByText("Saved to your drafts")).toBeInTheDocument();
    expect((await repo.listMyData()).inbox).toMatchObject([{ body: "That spy novel about Berlin Mark mentioned", status: "new" }]);
    expect(screen.getByRole("button", { name: "Quick note, 1 waiting" })).toBeInTheDocument();
  });

  it("won't save an empty note", async () => {
    const user = userEvent.setup();
    renderApp(<ListsPage />);
    await user.click(await screen.findByRole("button", { name: "Quick note" }));
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Quick note" }), "   ");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  });

  it("can be closed without saving", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    renderApp(<ListsPage />, repo);
    await user.click(await screen.findByRole("button", { name: "Quick note" }));
    await user.type(screen.getByRole("textbox", { name: "Quick note" }), "never mind");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((await repo.listMyData()).inbox).toEqual([]);
  });

  it("gets out of the way on screens that have a form of their own", async () => {
    for (const path of ["/add/", "/edit/", "/drafts/", "/read-import/"]) {
      nav.path = path;
      const view = renderApp(<div>page</div>);
      await screen.findByText("page");
      expect(screen.queryByRole("button", { name: /Quick note/ })).toBeNull();
      view.unmount();
    }
  });

  it("tells you drafts are private when you're not signed in", async () => {
    const user = userEvent.setup();
    renderApp(<ListsPage />, new LockedRepo());
    await user.click(await screen.findByRole("button", { name: "Quick note" }));
    expect(screen.getByText(/Drafts are private/)).toBeInTheDocument();
  });

  it("hides the mic where the browser can't transcribe, and uses it where it can", async () => {
    const user = userEvent.setup();
    renderApp(<ListsPage />);
    await user.click(await screen.findByRole("button", { name: "Quick note" }));
    expect(screen.queryByRole("button", { name: /Speak/ })).toBeNull();
  });

  it("transcribes speech into the box", async () => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: ((e: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      static last: FakeRecognition | null = null;
      start() {
        FakeRecognition.last = this;
      }
      stop() {
        this.onend?.();
      }
    }
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    const user = userEvent.setup();
    renderApp(<ListsPage />);
    await user.click(await screen.findByRole("button", { name: "Quick note" }));
    await user.type(screen.getByRole("textbox", { name: "Quick note" }), "Mark said");
    await user.click(await screen.findByRole("button", { name: /Speak/ }));
    act(() => {
      FakeRecognition.last!.onresult?.({ results: [Object.assign([{ transcript: "something about Berlin" }], { isFinal: true })] });
    });
    expect(screen.getByRole("textbox", { name: "Quick note" })).toHaveValue("Mark said something about Berlin");
    await user.click(screen.getByRole("button", { name: /Stop/ }));
  });
});

describe("the Drafts screen", () => {
  async function withDrafts() {
    const repo = newRepo();
    await repo.addDraft({ id: "d1", body: "Piranesi by Susanna Clarke" });
    await repo.addDraft({ id: "d2", body: "that spy novel about Berlin" });
    return repo;
  }

  it("lists what's waiting, keeping the text exactly, and can dismiss and bring back a draft", async () => {
    const user = userEvent.setup();
    const repo = await withDrafts();
    renderApp(<DraftsPage />, repo);
    expect(await screen.findByText("that spy novel about Berlin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Waiting \(2\)/ })).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);
    await user.click(screen.getByRole("button", { name: /Dismissed \(1\)/ }));
    expect(await screen.findByText("that spy novel about Berlin")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to waiting" }));
    await waitFor(async () => expect((await repo.listMyData()).inbox.every((d) => d.status === "new")).toBe(true));
    expect((await repo.listMyData()).inbox.map((d) => d.body).sort()).toEqual(["Piranesi by Susanna Clarke", "that spy novel about Berlin"]);
  });

  it("takes a new draft right on the page", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    renderApp(<DraftsPage />, repo);
    await user.type(await screen.findByRole("textbox", { name: "Quick note" }), "a title I heard on a podcast");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("a title I heard on a podcast")).toBeInTheDocument();
    expect((await repo.listMyData()).inbox).toHaveLength(1);
  });

  it("says so when there's nothing waiting", async () => {
    renderApp(<DraftsPage />);
    expect(await screen.findByText("Nothing waiting")).toBeInTheDocument();
  });

  it("says drafts are private when not signed in", async () => {
    renderApp(<DraftsPage />, new LockedRepo());
    expect(await screen.findByText("Drafts are private")).toBeInTheDocument();
  });

  it("links 'Make it a book' to the Add screen with that draft", async () => {
    renderApp(<DraftsPage />, await withDrafts());
    const links = await screen.findAllByRole("link", { name: "Make it a book" });
    expect(links.map((l) => l.getAttribute("href")).sort()).toEqual(["/add?draft=d1", "/add?draft=d2"]);
  });
});

describe("turning a draft into a book", () => {
  it("fills in a guessed title and author, keeps the note visible, and marks the draft added", async () => {
    const user = userEvent.setup();
    const repo = await withLists();
    await repo.addDraft({ id: "d1", body: "Zebra Tales by Anna Smith" });
    nav.params = new URLSearchParams({ draft: "d1" });
    renderApp(<AddPage />, repo);

    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Zebra Tales"));
    expect(screen.getByLabelText(/Author/)).toHaveValue("Anna Smith");
    expect(screen.getByRole("region", { name: "Your draft" })).toHaveTextContent("Zebra Tales by Anna Smith");

    await user.click(screen.getByRole("button", { name: "Couples Book Club" }));
    await user.click(screen.getByRole("button", { name: "Add book" }));

    expect(await screen.findByText(/to your library/)).toBeInTheDocument();
    const book = (await repo.listBooks()).find((b) => b.title === "Zebra Tales")!;
    expect(book.author).toBe("Anna Smith");
    const mine = await repo.listMyData();
    expect(mine.items).toMatchObject([{ listId: "l-couples", bookId: book.id }]);
    expect(mine.inbox[0]).toMatchObject({ id: "d1", status: "added", bookId: book.id, body: "Zebra Tales by Anna Smith" }); // text never lost
  });

  it("lets you correct the guess before adding", async () => {
    const user = userEvent.setup();
    const repo = newRepo();
    await repo.addDraft({ id: "d1", body: "that spy novel about Berlin" });
    nav.params = new URLSearchParams({ draft: "d1" });
    renderApp(<AddPage />, repo);
    const title = await screen.findByLabelText("Title");
    await waitFor(() => expect(title).toHaveValue("that spy novel about Berlin"));
    await user.clear(title);
    await user.type(title, "Berlin Game");
    await user.type(screen.getByLabelText(/Author/), "Len Deighton");
    await user.click(screen.getByRole("button", { name: "Add book" }));
    await screen.findByText(/to your library/);
    expect((await repo.listBooks()).some((b) => b.title === "Berlin Game")).toBe(true);
  });

  it("can put any new book on a list, draft or not", async () => {
    const user = userEvent.setup();
    const repo = await withLists();
    renderApp(<AddPage />, repo);
    await user.type(await screen.findByLabelText("Title"), "Zebra Tales");
    await user.click(screen.getByRole("button", { name: "Rough Drafts Potentials" }));
    await user.click(screen.getByRole("button", { name: "Add book" }));
    await screen.findByText(/to your library/);
    const book = (await repo.listBooks()).find((b) => b.title === "Zebra Tales")!;
    expect((await repo.listMyData()).items).toMatchObject([{ listId: "l-rd", bookId: book.id }]);
  });
});
