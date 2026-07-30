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
};

export default nextConfig;
