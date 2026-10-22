import type { NextConfig } from "next";

// Phase 1 nav-perf investigation: trial a non-zero Router Cache staleTime for
// dynamic routes (default is 0 — every navigation always refetches the RSC
// payload, even revisiting a page seconds later). Gated behind an explicit
// opt-in env var so it's only exercised in dev/E2E runs that ask for it,
// never silently changing production navigation/caching behavior.
const enableDynamicStaleTime = process.env.NEXT_EXPERIMENTAL_STALE_TIMES === "1";

const nextConfig: NextConfig = {
  ...(enableDynamicStaleTime && {
    experimental: {
      staleTimes: {
        dynamic: 30,
      },
    },
  }),
};

export default nextConfig;
