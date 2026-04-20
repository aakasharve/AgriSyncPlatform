import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ColorTheme = 'fresh' | 'dusk';
export type DisplayMode = 'light' | 'dark';

interface ThemeCtx {
  theme: ColorTheme;
  mode: DisplayMode;
  setTheme: (t: ColorTheme) => void;
  setMode: (m: DisplayMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeCtx | null>(null);

const STORAGE_KEY = 'admin.theme.v1';

function readStored(): { theme: ColorTheme; mode: DisplayMode } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        theme: p.theme === 'dusk' ? 'dusk' : 'fresh',
        mode: p.mode === 'dark' ? 'dark' : p.mode === 'light' ? 'light' : systemMode(),
      };
    }
  } catch {
    /* ignore */
  }
  return { theme: 'fresh', mode: systemMode() };
}

function systemMode(): DisplayMode {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyDom(theme: ColorTheme, mode: DisplayMode) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-mode', mode);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [{ theme, mode }, set] = useState<{ theme: ColorTheme; mode: DisplayMode }>(() =>
    readStored()
  );

  useEffect(() => {
    applyDom(theme, mode);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, mode }));
  }, [theme, mode]);

  const ctx: ThemeCtx = {
    theme,
    mode,
    setTheme: (t) => set((p) => ({ ...p, theme: t })),
    setMode: (m) => set((p) => ({ ...p, mode: m })),
    toggleMode: () => set((p) => ({ ...p, mode: p.mode === 'dark' ? 'light' : 'dark' })),
  };

  return <ThemeContext.Provider value={ctx}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(ThemeContext);
  if (!c) throw new Error('useTheme must be used within ThemeProvider');
  return c;
}
