/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    return process.env.BACKEND_URL
      ? [{ source: '/api/:path*', destination: `${process.env.BACKEND_URL}/api/:path*` }]
      : [];
  },
};
module.exports = nextConfig;
