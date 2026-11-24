import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';
const storageKey = 'onetable-theme';
const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f2f3f5' : '#0b0f0d');
  }, [theme]);
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === storageKey || event.key === null) setTheme(event.newValue === 'light' ? 'light' : 'dark');
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem(storageKey, next); } catch { /* Preference can still be changed for this tab. */ }
  }
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function ThemeSwitch() {
  const preference = useContext(ThemeContext);
  if (!preference) return null;
  return <button type="button" className="theme-toggle" role="switch" aria-label="Светлая тема"
    aria-checked={preference.theme === 'light'} title="Сменить тему" onClick={preference.toggle}>
    <Moon size={15} aria-hidden="true" /><Sun size={16} aria-hidden="true" />
  </button>;
}
