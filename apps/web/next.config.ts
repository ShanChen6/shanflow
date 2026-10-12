import type { NextConfig } from "next";

// Baseline hardening for every page. A Content-Security-Policy is deliberately not set here yet: Next needs
// per-request nonces for its inline scripts, which is tracked as an open item in the Phase 3 closure report.
const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Pages reached from an emailed link carry a single-use token in the URL: never send it on as a Referer
// and never let a cache keep the page.
const sensitiveLinkHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: baseHeaders },
      { source: "/verify-email", headers: sensitiveLinkHeaders },
      { source: "/reset-password", headers: sensitiveLinkHeaders },
    ];
  },
};

export default nextConfig;
