// Reads an Amazon book link for the Bookshelf app: follows a short share link (a.co/..., amzn.to/...) to the
// product page and returns what Amazon says about the book (title, author, pages, cover, ISBN).
//
// Why this is a server-side helper: a web page can't read Amazon pages or follow Amazon's short-link
// redirects (the browser blocks it), but this can.
//
// Safety: only the owner can use it (the sign-in token is checked against the database), it only ever
// fetches Amazon hosts (every redirect is checked), and it returns a handful of fields, never the page.
import { asinFromUrl, isAmazonHost, parseAmazonPage } from "./parse.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const BROWSER = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml",
};

/** Follows redirects by hand so that every hop can be checked against the Amazon-only list. */
async function follow(start: string): Promise<{ url: string; res: Response } | null> {
  let url = start;
  for (let hop = 0; hop < 6; hop++) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" || !isAmazonHost(u.hostname)) return null;
    const res = await fetch(u.toString(), { redirect: "manual", headers: BROWSER, signal: AbortSignal.timeout(9000) });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) return null;
      url = new URL(next, u).toString();
      continue;
    }
    return { url: u.toString(), res };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { token?: string; url?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (!body.token || !body.url) return json({ error: "Missing token or url" }, 400);

  // Only the owner: the same sign-in token every change in the app needs.
  const base = Deno.env.get("SUPABASE_URL");
  const key = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const check = await fetch(`${base}/rest/v1/rpc/check_code`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_code: body.token }),
  });
  if (!check.ok || (await check.json()) !== true) return json({ error: "Not signed in" }, 401);

  try {
    const first = await follow(body.url.trim());
    if (!first) return json({ error: "That isn't an Amazon link I can read" }, 422);
    const asin = asinFromUrl(first.url);

    // The product page itself, from the clean address (no tracking parameters).
    const host = new URL(first.url).hostname;
    let page = first;
    if (asin) {
      const clean = await follow(`https://${host.startsWith("www.") ? host : "www.amazon.com"}/dp/${asin}`);
      if (clean) page = clean;
    }
    if (!page.res.ok) return json({ asin, finalUrl: first.url, blocked: true });

    const html = await page.res.text();
    return json({ asin, finalUrl: first.url, ...parseAmazonPage(html) });
  } catch {
    return json({ error: "Couldn't reach Amazon" }, 502);
  }
});
