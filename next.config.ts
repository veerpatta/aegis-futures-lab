import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; " +
              "img-src 'self' data: blob:; " +
              // Google Fonts, loaded as a plain <link> in app/layout.tsx (see
              // docs/design-language.md — deliberately not next/font). The
              // stylesheet comes from fonts.googleapis.com and the woff2 files
              // it references come from fonts.gstatic.com; font-src must be
              // named explicitly because default-src 'self' would otherwise
              // block the second hop. Omitting either one silently drops
              // Archivo, Space Grotesk and JetBrains Mono to system fallbacks.
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
              "font-src 'self' https://fonts.gstatic.com; " +
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
              "connect-src 'self' https://*.supabase.co https://query1.finance.yahoo.com wss://*.supabase.co; " +
              "worker-src 'self' blob:; form-action 'self'",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
