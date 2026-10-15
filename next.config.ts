import type { NextConfig } from "next";

// GitHub Pages serves a project site from /<repo-name>/, so the deploy build
// sets NEXT_PUBLIC_BASE_PATH (e.g. "/book-archive-app"). Locally it's empty.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  // Dev server only: lets a browser that opens http://127.0.0.1:3000 (rather than localhost) hydrate the page.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
