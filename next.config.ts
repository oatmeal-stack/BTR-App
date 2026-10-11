import type { NextConfig } from "next";

// GitHub Pages serves a project site from /<repo-name>/, so the deploy build
// sets NEXT_PUBLIC_BASE_PATH (e.g. "/book-archive-app"). Locally it's empty.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
};

export default nextConfig;
