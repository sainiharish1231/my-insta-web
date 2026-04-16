/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Allow large file uploads for videos (up to 4GB)
    proxyClientMaxBodySize: 4 * 1024 * 1024 * 1024, // 4GB
  },
  serverRuntimeConfig: {
    // Node.js runtime config for large uploads
    api: {
      bodyParser: {
        sizeLimit: '4gb',
      },
    },
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
