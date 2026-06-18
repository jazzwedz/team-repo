/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse (v2) pulls in pdfjs-dist, which breaks when bundled by
  // webpack on the server ("Object.defineProperty called on non-object").
  // Keep these as runtime node requires instead of bundling them.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://viewer.diagrams.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; frame-src 'self' blob:; connect-src 'self' https://api.github.com https://api.anthropic.com https://convert.diagrams.net;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
