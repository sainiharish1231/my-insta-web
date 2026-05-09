const youtubeShortsTraceExcludes = [
  "./*-player-script.js",
  "./*.js",
  "./*.json",
  "./*.md",
  "./*.mjs",
  "./*.ts",
  "./*.tsx",
  "./app/**/*",
  "./components/**/*",
  "./hooks/**/*",
  "./lib/**/*",
  "./public/apple-icon.png",
  "./public/icon*",
  "./public/placeholder*",
  "./scripts/**/*",
  "./styles/**/*",
  "./tsconfig.tsbuildinfo",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Allow large file uploads for videos (up to 4GB)
    proxyClientMaxBodySize: 4 * 1024 * 1024 * 1024, // 4GB
  },
  env: {
    YTDL_NO_DEBUG_FILE: "1",
  },
  serverExternalPackages: ["@distube/ytdl-core"],
  outputFileTracingExcludes: {
    "/api/youtube/shorts/*": youtubeShortsTraceExcludes,
  },
  outputFileTracingIncludes: {
    "/api/youtube/shorts/*": ["./public/logo-overlay.jpg"],
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
