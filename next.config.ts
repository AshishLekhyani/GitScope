import type { NextConfig } from "next";

// Content Security Policy — keeps Next.js hydration working while blocking
// clickjacking, XSS data-exfil, and rogue frame embeds.
const CSP = [
  "default-src 'self'",
  // Next.js requires unsafe-eval (dev HMR) and unsafe-inline (inline hydration scripts)
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  // Tailwind generates runtime inline styles
  "style-src 'self' 'unsafe-inline'",
  // All image sources the app uses (GitHub avatars, Dicebear identicons, etc.)
  [
    "img-src 'self' data: blob:",
    "https://avatars.githubusercontent.com",
    "https://github.com",
    "https://api.dicebear.com",
    "https://octodex.github.com",
    "https://em-content.zobj.net",
  ].join(" "),
  // Fonts served from self; data: for embedded base64 fonts
  "font-src 'self' data:",
  // API calls: app backend + GitHub REST API + Iconify icon data
  "connect-src 'self' https://api.github.com https://api.iconify.design",
  // Block embedding the app in any frame (anti-clickjacking)
  "frame-ancestors 'none'",
  "frame-src 'none'",
  // Forms can only submit to our own origin
  "form-action 'self'",
  // No Flash / Java plugins
  "object-src 'none'",
  // Block <base> tag hijacking
  "base-uri 'self'",
  // Upgrade any accidental HTTP sub-resource requests
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  // Force HTTPS (Vercel already does this, but belt-and-suspenders for custom domains)
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Block embedding in iframes (older browsers; CSP frame-ancestors covers modern ones)
  { key: "X-Frame-Options",       value: "DENY" },
  // Prevent MIME sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't send full referrer to third-party origins
  { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
  // Lock down sensitive browser APIs
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()",
  },
  // Legacy XSS filter (belt-and-suspenders for old browsers)
  { key: "X-XSS-Protection",      value: "1; mode=block" },
  // Enable DNS prefetch (perf)
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // The main event
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig: NextConfig = {
  reactCompiler: true,

  async headers() {
    return [
      {
        // Apply to all routes
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "octodex.github.com" },
      { protocol: "https", hostname: "em-content.zobj.net" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "github.com" },
      { protocol: "https", hostname: "api.dicebear.com" },
    ],
  },
};

export default nextConfig;
