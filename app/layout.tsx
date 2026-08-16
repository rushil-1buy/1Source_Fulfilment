import type { Metadata } from 'next';
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
        {/* Runs before hydration so the correct theme is applied on first paint,
            with no flash of the wrong one. Blocking and inline on purpose: it has
            to finish before the first pixel.

            In development React logs "Encountered a script tag while rendering
            React component" for this. The message is accurate and harmless — the
            script's work is done during SSR and it has no job on a client render
            — but it is unavoidable, not unaddressed. React warns in its client
            createInstance path for ANY script element in the tree, so these were
            tried and all still warn:
              • the tag in <body>, raw
              • the tag in <head>, raw (here)
              • next/script with strategy="beforeInteractive", in either place
            The only escapes are a theme flash (async script) or moving all 72
            dark tokens into a duplicated @media (prefers-color-scheme) block to
            drive the theme from CSS alone. A correct first paint is worth more
            than a clean dev console, so the warning stays. */}
        <script
          id="theme-bootstrap"
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
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
