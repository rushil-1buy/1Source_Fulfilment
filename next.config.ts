import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Hides the development on-screen indicator — the floating "N" badge.
   *
   * It is fixed to the bottom-left of the viewport, which is exactly where the
   * flow rail's first stage and the sidebar's collapse control sit, so it covered
   * stage labels. Compile and runtime errors are still surfaced; only the badge
   * is hidden. Development-only either way, so a production build is unaffected.
   *
   * `false` is the v16 form — `buildActivity` and `buildActivityPosition` were
   * removed in this major.
   */
  devIndicators: false,

  /**
   * Ships the seeded SQLite file inside every server function's bundle.
   *
   * File tracing follows `import` statements, and nothing imports a `.db` — so
   * without this the database is simply absent from the deployment and every
   * query fails. The key is a route glob and the value is resolved from the
   * project root, so the file lands at `prisma/demo.db` relative to `cwd()`
   * inside the function, which is where lib/db.ts looks for it.
   *
   * `/**` rather than `/*`: picomatch's single star stops at a path separator,
   * which would cover `/orders` but miss `/orders/[id]`.
   */
  outputFileTracingIncludes: {
    '/**': ['./prisma/demo.db'],
  },
};

export default nextConfig;
