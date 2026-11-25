import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Density = 'comfortable' | 'compact';
export type StartView = 'live' | 'tournaments' | 'crm';
export type TournamentsPerPage = 10 | 20 | 50;
export type AvatarTone = 'default' | 'emerald' | 'cobalt' | 'amber' | 'plum';

export type UserPreferences = {
  density: Density;
  startView: StartView;
  tournamentsPerPage: TournamentsPerPage;
  reducedMotion: boolean;
  timerSound: boolean;
  avatarTone: AvatarTone;
  demoName: string;
  demoAvatar: string;
};

const STORAGE_KEY = 'onetable-prefs';

export const DEFAULT_PREFS: UserPreferences = {
  density: 'comfortable',
  startView: 'live',
  tournamentsPerPage: 20,
  reducedMotion: false,
  timerSound: true,
  avatarTone: 'default',
  demoName: '',
  demoAvatar: '',
};

function sanitizePrefs(raw: unknown): UserPreferences {
  if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
  const obj = raw as Record<string, unknown>;
  const density: Density = obj.density === 'compact' ? 'compact' : 'comfortable';
  const startView: StartView = obj.startView === 'tournaments' || obj.startView === 'crm' ? obj.startView : 'live';
  const tournamentsPerPage: TournamentsPerPage = obj.tournamentsPerPage === 10 || obj.tournamentsPerPage === 50 ? obj.tournamentsPerPage : 20;
  const reducedMotion = Boolean(obj.reducedMotion);
  const timerSound = obj.timerSound === undefined ? true : Boolean(obj.timerSound);
  const avatarTone: AvatarTone =
    obj.avatarTone === 'emerald' || obj.avatarTone === 'cobalt' || obj.avatarTone === 'amber' || obj.avatarTone === 'plum'
      ? obj.avatarTone
      : 'default';
  const demoName = typeof obj.demoName === 'string' ? obj.demoName.slice(0, 80) : '';
  const demoAvatar = typeof obj.demoAvatar === 'string' && obj.demoAvatar.startsWith('data:image/') && obj.demoAvatar.length <= 160_000
    ? obj.demoAvatar : '';
  return { density, startView, tournamentsPerPage, reducedMotion, timerSound, avatarTone, demoName, demoAvatar };
}

function loadPrefs(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    return sanitizePrefs(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFS;
  }
}

type PreferencesContextValue = {
  prefs: UserPreferences;
  updatePrefs: (patch: Partial<UserPreferences>) => void;
  resetPrefs: () => void;
};

const PreferencesContext = createContext<PreferencesContextValue>({
  prefs: DEFAULT_PREFS,
  updatePrefs: () => {},
  resetPrefs: () => {},
});

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferences>(loadPrefs);

  useEffect(() => {
    document.documentElement.dataset.density = prefs.density;
    document.documentElement.dataset.motion = prefs.reducedMotion ? 'reduced' : 'normal';
  }, [prefs.density, prefs.reducedMotion]);

  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === STORAGE_KEY || event.key === null) setPrefs(loadPrefs());
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  function updatePrefs(patch: Partial<UserPreferences>) {
    setPrefs(prev => {
      const next = sanitizePrefs({ ...prev, ...patch });
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore storage errors */ }
      return next;
    });
  }

  function resetPrefs() {
    setPrefs(DEFAULT_PREFS);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore storage errors */ }
  }

  return (
    <PreferencesContext.Provider value={{ prefs, updatePrefs, resetPrefs }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  return useContext(PreferencesContext);
}

/** Короткий нейтральный звуковой сигнал при смене уровня / окончании таймера (Web Audio API). */
export function playTimerChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = [880, 1174.66];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.16);
      gain.gain.setValueAtTime(0.0001, now + idx * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.16 + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.16);
      osc.stop(now + idx * 0.16 + 0.36);
    });
    window.setTimeout(() => { void ctx.close().catch(() => {}); }, 800);
  } catch {
    /* Браузер может заблокировать звук до взаимодействия пользователя */
  }
}
