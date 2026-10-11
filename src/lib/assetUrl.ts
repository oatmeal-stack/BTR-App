/** GitHub Pages serves from /<repo>/, so public files need the base path. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function assetUrl(path: string): string {
  return `${BASE_PATH}${path}`;
}
