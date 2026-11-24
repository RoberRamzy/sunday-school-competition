import type { NextConfig } from "next";

const apiOrigin = (process.env.API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default config;
