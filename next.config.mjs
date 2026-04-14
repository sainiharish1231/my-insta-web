/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Avoid 413 in Next proxy during large local uploads.
    proxyClientMaxBodySize: 5 * 1024 * 1024 * 1024, // 5GB
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
