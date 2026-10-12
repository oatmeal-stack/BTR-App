/**
 * Reading an Amazon book page. Pure functions on the page's HTML, with no network and no Deno, so the
 * same file runs in the edge function and in the tests. Amazon changes its markup now and then, so every
 * field is best-effort: a field it can't find is simply left out, never guessed.
 */

export interface AmazonPage {
  /** Amazon's own title, subtitle and all ("Title: A Subtitle"). */
  title?: string;
  /** First author, "First Last". */
  author?: string;
  pages?: number;
  /** Large cover image on Amazon's image server. */
  coverUrl?: string;
  isbn10?: string;
  isbn13?: string;
  /** True when Amazon served a "prove you're human" page instead of the book. */
  blocked?: boolean;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

const clean = (s: string | undefined) => (s ? decodeEntities(s).replace(/\s+/g, " ").trim() : undefined);

/** "Fitzgerald, F. Scott" -> "F. Scott Fitzgerald". Leaves anything else alone. */
export function firstLast(name: string): string {
  const m = name.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}`.trim() : name;
}

const IMAGE_HOST = /^https:\/\/(?:m\.media-amazon\.com|images-na\.ssl-images-amazon\.com|images-eu\.ssl-images-amazon\.com|images\.amazon\.com)\//;

export function parseAmazonPage(html: string): AmazonPage {
  if (/api-services-support@amazon|Robot Check|Enter the characters you see below|Type the characters you see in this image/i.test(html) && !/id="productTitle"/.test(html)) {
    return { blocked: true };
  }
  const out: AmazonPage = {};

  out.title = clean(html.match(/id="productTitle"[^>]*>([^<]+)</)?.[1]);

  // The first named author link, not the "(Foreword)" or "(Illustrator)" credits that follow.
  const authorLink =
    html.match(/class="author[^"]*"[\s\S]{0,500}?<a[^>]*>([^<]+)<\/a>/)?.[1] ?? html.match(/id="bylineInfo"[\s\S]{0,900}?<a[^>]*>([^<]+)<\/a>/)?.[1];
  const byline = clean(authorLink);
  if (byline && !/^visit amazon|^amazon\.com|^follow/i.test(byline)) out.author = byline;

  // "<Title>: <Last, First>: <ISBN>: Amazon.com: Books" is the fallback for a missing title or author.
  const tag = clean(html.match(/<title>([^<]*)<\/title>/)?.[1]);
  const tagParts = tag?.split(/\s*:\s*/) ?? [];
  const isbnAt = tagParts.findIndex((p) => /^(?:97[89])?\d{9}[\dXx]$/.test(p));
  if (isbnAt > 0) {
    out.isbn13 ??= tagParts[isbnAt].length === 13 ? tagParts[isbnAt] : undefined;
    out.isbn10 ??= tagParts[isbnAt].length === 10 ? tagParts[isbnAt] : undefined;
    if (!out.author && tagParts[isbnAt - 1] && tagParts[isbnAt - 1].length < 60) out.author = firstLast(tagParts[isbnAt - 1]);
    if (!out.title && isbnAt >= 2) out.title = tagParts.slice(0, isbnAt - 1).join(": ");
  }

  // "Print length" in the highlights strip, e.g. <span>180 pages</span>.
  const pages =
    html.match(/rpi-attribute-book_details-fiona_pages[\s\S]{0,900}?(\d[\d,]*)\s*pages/i)?.[1] ??
    html.match(/Print length[\s\S]{0,300}?(\d[\d,]*)\s*pages/i)?.[1];
  if (pages) {
    const n = Number(pages.replace(/,/g, ""));
    if (Number.isInteger(n) && n >= 10 && n <= 5000) out.pages = n;
  }

  const image =
    html.match(/data-old-hires="(https:[^"]+)"/)?.[1] ??
    html.match(/"hiRes"\s*:\s*"(https:[^"]+)"/)?.[1] ??
    html.match(/id="landingImage"[^>]*?src="(https:[^"]+)"/)?.[1] ??
    html.match(/id="imgBlkFront"[^>]*?src="(https:[^"]+)"/)?.[1];
  if (image && IMAGE_HOST.test(image)) out.coverUrl = image;

  const isbn13 = html.match(/ISBN-13[\s\S]{0,400}?(97[89][-\d]{10,14})/)?.[1]?.replace(/-/g, "");
  if (isbn13 && isbn13.length === 13) out.isbn13 = isbn13;
  const isbn10 = html.match(/ISBN-10[\s\S]{0,400}?<span[^>]*>\s*(\d{9}[\dXx])\s*<\/span>/)?.[1];
  if (isbn10) out.isbn10 = isbn10.toUpperCase();

  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as AmazonPage;
}

/** The ten-character product id in an Amazon product URL, if there is one. */
export function asinFromUrl(url: string): string | undefined {
  return url.match(/\/(?:dp|gp\/product|gp\/aw\/d|gp\/offer-listing|product|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i)?.[1]?.toUpperCase();
}

/** Only these hosts are ever fetched, so the helper can't be pointed at anything else. */
export function isAmazonHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    /(^|\.)amazon\.(com|co\.uk|ca|de|fr|es|it|nl|com\.au|co\.jp|in|com\.mx|com\.br|se|pl|sg|ae|sa)$/.test(h) ||
    h === "a.co" ||
    h === "amzn.to" ||
    h === "amzn.eu" ||
    h === "amzn.com" ||
    h === "amzn.asia"
  );
}
