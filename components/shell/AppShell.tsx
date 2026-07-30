'use client';

/**
 * Responsive app shell (§10.3).
 *
 * Layout contract that every screen relies on:
 *  * The PAGE never scrolls horizontally. `min-w-0` on the flex column plus
 *    `overflow-x-hidden` on the scroll container means wide content must scroll
 *    inside its own container rather than pushing the body sideways.
 *  * ≥ lg: sidebar is a persistent column.
 *  * < lg: sidebar becomes an off-canvas drawer with a backdrop, opened from the
 *    hamburger in the top bar and closed by Escape, backdrop click, or
 *    navigating.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();

  const close = useCallback(() => setMobileNavOpen(false), []);

  // Navigating closes the drawer.
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Escape closes it, and body scroll locks while it is open.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen, close]);

  return (
    <div className="flex min-h-dvh w-full">
      {/* Persistent column at ≥ lg */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Off-canvas drawer below lg */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={close}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
          />
          <div className="animate-in slide-in-from-left absolute inset-y-0 left-0 shadow-e4">
            <Sidebar onNavigate={close} forceExpanded />
          </div>
        </div>
      )}

      {/* min-w-0 is what stops wide children from widening the whole page */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
