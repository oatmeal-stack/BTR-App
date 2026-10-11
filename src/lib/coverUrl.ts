/** The same Open Library jacket, larger, for the book page. Any other url is left alone. */
export function largeCoverUrl(url: string): string {
  return url.replace(/(covers\.openlibrary\.org\/b\/id\/\d+)-M\.jpg$/, "$1-L.jpg");
}
