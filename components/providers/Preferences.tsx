'use client';

/**
 * User presentation preferences — theme, Plain English mode (§8.2), reduced
 * motion (§5.3) and table density (§8.1). Persisted to localStorage and applied
 * to <html> so CSS can react without prop-drilling.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';

interface Preferences {
  theme: ThemeChoice;
  resolvedTheme: 'light' | 'dark';
  plainEnglish: boolean;
  reduceMotion: boolean;
  density: Density;
  setTheme: (t: ThemeChoice) => void;
  setPlainEnglish: (v: boolean) => void;
  setReduceMotion: (v: boolean) => void;
  setDensity: (d: Density) => void;
  /** Pick the right label for the current Plain English setting. */
  label: (technical: string, plain?: string | null) => string;
}

const STORAGE_KEY = '1buy.prefs';

const PreferencesContext = createContext<Preferences | null>(null);

interface Stored {
  theme?: ThemeChoice;
  plainEnglish?: boolean;
  reduceMotion?: boolean;
  density?: Density;
}

function readStored(): Stored {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Stored;
  } catch {
    return {};
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [plainEnglish, setPlainEnglishState] = useState(false);
  const [reduceMotion, setReduceMotionState] = useState(false);
  const [density, setDensityState] = useState<Density>('comfortable');
  const [systemDark, setSystemDark] = useState(false);

  // Hydrate from storage once on mount. The inline script in <head> has already
  // applied the theme class, so there is no flash of the wrong theme.
  useEffect(() => {
    const s = readStored();
    if (s.theme) setThemeState(s.theme);
    if (typeof s.plainEnglish === 'boolean') setPlainEnglishState(s.plainEnglish);
    if (typeof s.reduceMotion === 'boolean') setReduceMotionState(s.reduceMotion);
    if (s.density) setDensityState(s.density);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  // Apply to <html> and persist.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.dataset.reduceMotion = String(reduceMotion);
    root.dataset.density = density;
    root.dataset.plainEnglish = String(plainEnglish);
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ theme, plainEnglish, reduceMotion, density }),
      );
    } catch {
      /* storage unavailable — preferences simply won't persist */
    }
  }, [resolvedTheme, theme, plainEnglish, reduceMotion, density]);

  const label = useCallback(
    (technical: string, plain?: string | null) =>
      plainEnglish && plain ? plain : technical,
    [plainEnglish],
  );

  const value = useMemo<Preferences>(
    () => ({
      theme,
      resolvedTheme,
      plainEnglish,
      reduceMotion,
      density,
      setTheme: setThemeState,
      setPlainEnglish: setPlainEnglishState,
      setReduceMotion: setReduceMotionState,
      setDensity: setDensityState,
      label,
    }),
    [theme, resolvedTheme, plainEnglish, reduceMotion, density, label],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Preferences {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return ctx;
}

/** Runs before first paint to avoid a flash of the wrong theme. */
export const THEME_BOOTSTRAP_SCRIPT = `
(function(){
  try {
    var s = JSON.parse(localStorage.getItem('${STORAGE_KEY}') || '{}');
    var t = s.theme || 'system';
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var r = document.documentElement;
    if (dark) r.classList.add('dark');
    r.dataset.reduceMotion = String(!!s.reduceMotion);
    r.dataset.density = s.density || 'comfortable';
    r.dataset.plainEnglish = String(!!s.plainEnglish);
  } catch (e) {}
})();
`.trim();
