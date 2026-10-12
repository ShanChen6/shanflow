import type { NextConfig } from "next";

// Pages reached from an emailed link carry a single-use token in the URL: never send it on as a Referer
// and never let a cache keep the page.
const sensitiveLinkHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/verify-email", headers: sensitiveLinkHeaders },
      { source: "/reset-password", headers: sensitiveLinkHeaders },
    ];
  },
};

export default nextConfig;
