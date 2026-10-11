import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
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

import AddPage from "@/app/add/page";
import HomeStub from "@/app/page";
import BookPage from "@/app/book/page";
import ProfilePage from "@/app/profile/page";
import { AppShell } from "@/components/layout/AppShell";
import { SkinProvider } from "@/components/theme/SkinProvider";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";
import { LibraryProvider } from "@/hooks/useLibrary";
import { PasscodeRequiredError } from "@/lib/passcode";
import { LocalBookRepository } from "@/repositories/LocalBookRepository";
import { memoryStorage } from "./helpers";

/** A shared-library stand-in: reads are open, changes need the passcode "letmein". */
class SharedRepo extends LocalBookRepository {
  readonly requiresPasscode: boolean = true;
  readonly storageLabel: string = "Shared library (Supabase)";
  private open = false;
  constructor() {
    super(memoryStorage(), SAMPLE_BOOKS);
  }
  hasPasscode() {
    return this.open;
  }
  async unlock(code: string) {
    this.open = code === "letmein";
    return this.open;
  }
  lock() {
    this.open = false;
  }
  async setFavorite(id: string, favorite: boolean) {
    if (!this.open) throw new PasscodeRequiredError();
    return super.setFavorite(id, favorite);
  }
  async addBook(...args: Parameters<LocalBookRepository["addBook"]>) {
    if (!this.open) throw new PasscodeRequiredError();
    return super.addBook(...args);
  }
}

const DUNE = "bk-dune-frank-herbert"; // starts as not a favorite

function renderApp(ui: ReactNode, repo = new SharedRepo()) {
  return render(
    <SkinProvider>
      <LibraryProvider repository={repo}>
        <AppShell>{ui}</AppShell>
      </LibraryProvider>
    </SkinProvider>,
  );
}

describe("passcode on the shared library", () => {
  it("rejects a wrong passcode and unlocks with the right one", async () => {
    const user = userEvent.setup();
    nav.path = "/profile/";
    renderApp(<ProfilePage />);
    expect(await screen.findByText(/Shared library \(Supabase\)/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(screen.getByText("Enter your passcode first.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Passcode", { selector: "input" }), "wrong");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("That passcode isn't right.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Passcode", { selector: "input" }));
    await user.type(screen.getByLabelText("Passcode", { selector: "input" }), "letmein");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText(/Unlocked on this device/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Lock/ }));
    expect(await screen.findByRole("button", { name: "Unlock" })).toBeInTheDocument();
  });

  it("undoes a change made while locked and points to Profile", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: DUNE });
    renderApp(<BookPage />);
    await screen.findByRole("heading", { name: "Dune" });
    const fav = screen.getByRole("button", { name: /Favorite/ });
    expect(fav).toHaveAttribute("aria-pressed", "false");

    await user.click(fav);
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("Enter your passcode in Profile to make changes.");
    expect(screen.getByRole("button", { name: /Favorite/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("lets the change through once unlocked", async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams({ id: DUNE });
    const repo = new SharedRepo();
    await repo.unlock("letmein");
    renderApp(<BookPage />, repo);
    await screen.findByRole("heading", { name: "Dune" });
    await user.click(screen.getByRole("button", { name: /Favorite/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Favorited/ })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByText(/Enter your passcode/)).toBeNull();
  });

  it("tells you on the Add screen that adding needs the passcode", async () => {
    nav.path = "/add/";
    renderApp(<AddPage />);
    expect(await screen.findByText(/Adding books needs your passcode/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enter it in Profile" })).toHaveAttribute("href", "/profile");
  });

  it("says nothing about a passcode when the library is only on this device", async () => {
    nav.path = "/profile/";
    renderApp(<ProfilePage />, new LocalBookRepository(memoryStorage(), SAMPLE_BOOKS) as unknown as SharedRepo);
    expect(await screen.findByText(/This device only/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
  });
});

describe("when the library can't be loaded", () => {
  it("says so, instead of claiming the library is empty", async () => {
    class DownRepo extends SharedRepo {
      async listBooks(): Promise<never> {
        throw new Error("network down");
      }
    }
    nav.path = "/";
    renderApp(<HomeStub />, new DownRepo());
    expect(await screen.findByText("Couldn't load your library")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("Your library is empty")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/Couldn't load your library/);
  });
});
