import type { Metadata } from 'next';
import Script from 'next/script';
import { Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';
import { PreferencesProvider, THEME_BOOTSTRAP_SCRIPT } from '@/components/providers/Preferences';

/**
 * iWorkbench sans. The CSS variable keeps its original name so the hundreds of
 * places already reading --font-geist-sans keep working — renaming the variable
 * would be a rename with no reader-facing benefit and a large blast radius.
 */
const jakartaSans = Plus_Jakarta_Sans({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

/** Mono is reserved for IDs, part numbers, AWBs and reference codes (§10.2). */
const geistMono = Geist_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: '1BUY Fulfilment',
    template: '%s · 1BUY Fulfilment',
  },
  description:
    'Internal procurement-to-fulfilment platform. 1BUY acts as Merchant of Record between customer and supplier.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      // Next 16 no longer overrides scroll-behavior during navigation unless
      // asked; we want snappy route changes with smooth in-page anchors.
      data-scroll-behavior="smooth"
      className={`${jakartaSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs before hydration so the correct theme, density and motion
            preference are applied on first paint, with no flash of the wrong
            one. It has to finish before the first pixel.

            Delivered through next/script with `beforeInteractive` rather than a
            raw <script> tag. A raw tag makes React log "Encountered a script tag
            while rendering React component" on every page in development — its
            client createInstance path warns for any script element in the tree —
            and this route sidesteps it because Next injects the content into the
            initial HTML itself instead of reconciling a script element. Verified
            on 16.2: theme and density still apply before paint, and the console
            is clean.

            An earlier note here recorded that this had been tried and still
            warned. It does not on this version, so the note was wrong to keep
            trusting; the raw tag is gone. */}
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {THEME_BOOTSTRAP_SCRIPT}
        </Script>
      </head>
      <body className="bg-surface-0 text-fg min-h-full">
        <PreferencesProvider>
          {children}
          <Toaster
            position="bottom-right"
            closeButton
            toastOptions={{
              classNames: {
                toast:
                  'bg-surface-1 border border-line-subtle text-fg shadow-e3 rounded-[10px] text-sm',
              },
            }}
          />
        </PreferencesProvider>
      </body>
    </html>
  );
}
