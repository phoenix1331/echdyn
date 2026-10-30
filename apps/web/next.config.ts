import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@echdyn/core"],
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // The proxy buffers request bodies up to this size and silently truncates beyond it.
    // Uploads may be 20 MB (MAX_UPLOAD_BYTES) plus multipart overhead, so leave headroom
    // and let the upload route return its own 413 for anything larger.
    proxyClientMaxBodySize: "25mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
