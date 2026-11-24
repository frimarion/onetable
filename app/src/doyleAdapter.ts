import type {
  Club, Entry, JournalItem, Payment, Player, Session, Snapshot, Table, Tournament, Visit,
} from '../shared/model';
import {
  defaultConfig, defaultDisplay, formats, type Config, type Level, type MoneyMethod, type Preset, type Result,
} from '../shared/operations';
import { baseRatingPresets, defaultRatingScheme } from '../shared/rating';
import type { BroadcastSummary, CrmData, PipelineStage, PlayerNote, RegistrationRecord } from '../shared/crm';

export const DOYLE_HOSTS = [
  'https://r.doylepoker.ru',
  'https://doylepoker.ru/sb',
  'https://api.doylepoker.ru',
  'https://gw.doylepoker.ru',
];

const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzEzMjI1NjAwLCJleHAiOjE4Njg5OTIwMDB9.JEHfDm5ghdB_UgORrAXZzjcT8TFdecTPs88C77sm5MA';

const STORAGE_AUTH_KEY = 'onetable-doyle-auth-v1';
const STORAGE_HOST_KEY = 'onetable-doyle-host-v1';

export type DoyleAuth = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email: string;
  role: 'admin' | 'superadmin' | 'operator';
  isAdmin: boolean;
  host?: string;
};

type DoyleTournamentRow = {
  id: number;
  name: string;
  entry_fee: number | null;
  status: string;
  slots: number | null;
  date: string | null;
  room_id: string | null;
  created_at?: string | null;
};

type DoyleRoomRow = {
  room_id: string;
  state: Record<string, unknown> | null;
  version: number | null;
  branch?: string | null;
};

type DoylePlayerRow = {
  id: number;
  name: string;
  full_name: string | null;
  tg_id: string | null;
  tg_username: string | null;
  photo_url: string | null;
  points: number | null;
  games_played: number | null;
  ko_count: number | null;
  registered_at: string | null;
  marketing_consent: boolean | null;
  bio: string | null;
};

type DoyleRegistrationRow = {
  tournament_id: number;
  player_id: number;
  source: string | null;
  attendance: string | null;
  created_at: string | null;
};

type DoyleResultRow = {
  tournament_id: number;
  player_id: number;
  place: number;
  points: number | null;
  place_points: number | null;
  ko_count: number | null;
};

type DoyleBlueprintRow = {
  id: number;
  name: string;
  start_stack: number | null;
  late_reg_until_level: number | null;
  default_buy_in: number | null;
  default_registered: number | null;
  enables_seating: boolean | null;
  levels: unknown;
};

type DoyleNoteRow = {
  id: number;
  player_id: number;
  text: string;
  admin_email: string | null;
  created_at: string;
};

type DoyleTagRow = {
  player_id: number;
  tag: string;
};

type DoyleDebtRow = {
  id: number;
  player_id: number;
  amount: number;
  reason: string | null;
  tournament_id: number | null;
  tournament_name: string | null;
  method: string | null;
  settled_at: string | null;
  created_at: string;
};

type DoyleBroadcastRow = {
  id: number;
  message: string;
  filter: Record<string, unknown> | null;
  recipient_count: number | null;
  sent_count: number | null;
  failed_count: number | null;
  status: string | null;
  created_at: string;
};

const envUrl = (import.meta.env.VITE_DOYLE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
const envKey = (import.meta.env.VITE_DOYLE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_ANON_KEY;

function activeHostOrder(): string[] {
  const saved = (() => {
    try { return localStorage.getItem(STORAGE_HOST_KEY) || ''; } catch { return ''; }
  })();
  const base = envUrl ? [envUrl, ...DOYLE_HOSTS.filter(h => h !== envUrl)] : [...DOYLE_HOSTS];
  if (saved && base.includes(saved)) return [saved, ...base.filter(h => h !== saved)];
  return base;
}

let currentWorkingHost = activeHostOrder()[0];

export function normalizeDoylePhoto(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^https:\/\/(?:r|api|gw)\.doylepoker\.ru/i, currentWorkingHost);
}

async function doyleFetch(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const hosts = activeHostOrder();
  let lastError: unknown;
  for (const host of hosts) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const parentSignal = init.signal;
    const onAbort = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) {
        window.clearTimeout(timer);
        throw new DOMException('Aborted', 'AbortError');
      }
      parentSignal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const response = await fetch(host + path, { ...init, signal: controller.signal });
      window.clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onAbort);
      currentWorkingHost = host;
      try { localStorage.setItem(STORAGE_HOST_KEY, host); } catch { /* ignore */ }
      return response;
    } catch (error) {
      window.clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onAbort);
      if (parentSignal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Сервер Дойла недоступен');
}

export function loadSavedDoyleAuth(): DoyleAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DoyleAuth;
    if (!parsed?.accessToken || !parsed?.refreshToken || !parsed?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDoyleAuth(auth: DoyleAuth | null) {
  try {
    if (auth) localStorage.setItem(STORAGE_AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(STORAGE_AUTH_KEY);
  } catch { /* ignore */ }
}

export async function doyleSignIn(email: string, password: string): Promise<DoyleAuth> {
  const resp = await doyleFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: envKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  }, 12000);
  const body = await resp.json().catch(() => ({})) as Record<string, unknown>;
  if (!resp.ok) {
    const msg = String(body.error_description || body.msg || body.message || 'Неверный email или пароль');
    throw new Error(msg);
  }
  const accessToken = String(body.access_token || '');
  const refreshToken = String(body.refresh_token || '');
  const expiresIn = Number(body.expires_in || 3600);
  const user = (body.user || {}) as Record<string, unknown>;
  const userId = String(user.id || '');
  const userEmail = String(user.email || email.trim());

  const profileResp = await doyleFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role,is_admin,email`, {
    headers: { apikey: envKey, Authorization: 'Bearer ' + accessToken },
  });
  const profiles = profileResp.ok ? (await profileResp.json()) as { role?: string; is_admin?: boolean }[] : [];
  const profile = profiles[0];
  const isAdmin = Boolean(profile?.is_admin);
  const role = profile?.role === 'superadmin' ? 'superadmin' : profile?.role === 'operator' ? 'operator' : 'admin';
  if (!isAdmin && role !== 'operator') {
    throw new Error('У этой учётной записи нет прав администратора или оператора Дойла');
  }

  const auth: DoyleAuth = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    userId,
    email: userEmail,
    role,
    isAdmin,
    host: currentWorkingHost,
  };
  saveDoyleAuth(auth);
  return auth;
}

export async function ensureFreshDoyleAuth(auth: DoyleAuth): Promise<DoyleAuth> {
  if (auth.expiresAt - Date.now() > 90_000) return auth;
  const resp = await doyleFetch('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { apikey: envKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: auth.refreshToken }),
  }, 10000);
  if (!resp.ok) {
    saveDoyleAuth(null);
    throw new Error('Сессия Дойла истекла — войдите заново');
  }
  const body = await resp.json() as Record<string, unknown>;
  const next: DoyleAuth = {
    ...auth,
    accessToken: String(body.access_token || auth.accessToken),
    refreshToken: String(body.refresh_token || auth.refreshToken),
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
    host: currentWorkingHost,
  };
  saveDoyleAuth(next);
  return next;
}

async function restGet<T>(auth: DoyleAuth, path: string, signal?: AbortSignal): Promise<T> {
  const resp = await doyleFetch('/rest/v1/' + path, {
    headers: {
      apikey: envKey,
      Authorization: 'Bearer ' + auth.accessToken,
      Accept: 'application/json',
    },
    signal,
  }, 10000);
  if (resp.status === 401) {
    throw new Error('Сессия Дойла истекла — войдите заново');
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Ошибка Supabase (${resp.status})${text ? ': ' + text.slice(0, 120) : ''}`);
  }
  return resp.json() as Promise<T>;
}

const DOYLE_CLUB: Club = {
  id: 'doyle-live',
  name: 'Doyle Poker Club',
  venue: 'Москва · Supabase',
  accent: '#2BD98A',
};

export function doyleSessionOf(auth: DoyleAuth): Session {
  return {
    token: 'doyle-supabase:' + auth.email,
    club: DOYLE_CLUB,
    role: 'admin',
    table: null,
  };
}

function toMs(iso: string | null | undefined, fallback: number): number {
  if (!iso) return fallback;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapLevels(raw: unknown): Level[] {
  if (!Array.isArray(raw) || !raw.length) return formats.Deepstack;
  const result: Level[] = raw.map(item => {
    const obj = (item || {}) as Record<string, unknown>;
    const isBreak = Boolean(obj.isBreak || obj.kind === 'break');
    const minutes = Math.max(1, Number(obj.min ?? obj.minutes ?? 15) || 15);
    const small = Math.max(0, Number(obj.sb ?? obj.small ?? 0) || 0);
    const big = Math.max(0, Number(obj.bb ?? obj.big ?? 0) || 0);
    const ante = isBreak ? 0 : obj.anteMode === 'NONE' ? 0 : big;
    return { kind: isBreak ? 'break' : 'play', small, big, ante, duration: minutes * 60 };
  });
  return result.length ? result : formats.Deepstack;
}

function mapMethod(raw: unknown): MoneyMethod | 'prior' | null {
  if (raw === 'card' || raw === 'cash' || raw === 'transfer' || raw === 'prior') return raw;
  return null;
}

function mapTournamentState(row: DoyleTournamentRow, room: DoyleRoomRow | undefined): Tournament['state'] {
  if (row.status === 'draft') return 'draft';
  if (row.status === 'past') return 'finished';
  const st = room?.state as Record<string, unknown> | undefined;
  const timer = (st?.timer || {}) as Record<string, unknown>;
  const players = Array.isArray(st?.players) ? st.players : [];
  const hasPresent = players.some(p => Boolean((p as Record<string, unknown>)?.present));
  if (timer.isRunning || timer.isPaused || hasPresent) return 'live';
  return 'scheduled';
}

export async function loadDoyleSnapshot(
  rawAuth: DoyleAuth,
  selectedId: string | null,
  signal?: AbortSignal,
): Promise<{ auth: DoyleAuth; snapshot: Snapshot }> {
  const auth = await ensureFreshDoyleAuth(rawAuth);
  const now = Date.now();

  const [
    tournamentsRaw,
    roomsRaw,
    playersRaw,
    regsRaw,
    resultsRaw,
    blueprintsRaw,
    notesRaw,
    tagsRaw,
    debtsRaw,
    broadcastsRaw,
  ] = await Promise.all([
    restGet<DoyleTournamentRow[]>(auth, 'doyle_tournaments?select=id,name,entry_fee,status,slots,date,room_id,created_at&order=date.desc.nullslast,id.desc&limit=120', signal),
    restGet<DoyleRoomRow[]>(auth, 'rooms?select=room_id,state,version,branch&limit=120', signal),
    restGet<DoylePlayerRow[]>(auth, 'doyle_players?select=id,name,full_name,tg_id,tg_username,photo_url,points,games_played,ko_count,registered_at,marketing_consent,bio&order=name.asc&limit=2000', signal),
    restGet<DoyleRegistrationRow[]>(auth, 'doyle_registrations?select=tournament_id,player_id,source,attendance,created_at&order=created_at.desc&limit=3000', signal),
    restGet<DoyleResultRow[]>(auth, 'doyle_tournament_results?select=tournament_id,player_id,place,points,place_points,ko_count&limit=4000', signal),
    auth.isAdmin
      ? restGet<DoyleBlueprintRow[]>(auth, 'tournament_blueprints?select=id,name,start_stack,late_reg_until_level,default_buy_in,default_registered,enables_seating,levels,sort_order&order=sort_order.asc,id.asc', signal).catch(() => [])
      : Promise.resolve([]),
    auth.isAdmin
      ? restGet<DoyleNoteRow[]>(auth, 'crm_player_notes?select=id,player_id,text,admin_email,created_at&order=created_at.desc&limit=500', signal).catch(() => [])
      : Promise.resolve([]),
    auth.isAdmin
      ? restGet<DoyleTagRow[]>(auth, 'crm_player_tags?select=player_id,tag&limit=2000', signal).catch(() => [])
      : Promise.resolve([]),
    auth.isAdmin
      ? restGet<DoyleDebtRow[]>(auth, 'crm_player_debts?select=id,player_id,amount,reason,tournament_id,tournament_name,method,settled_at,created_at&order=created_at.desc&limit=1000', signal).catch(() => [])
      : Promise.resolve([]),
    auth.isAdmin
      ? restGet<DoyleBroadcastRow[]>(auth, 'crm_broadcasts?select=id,message,filter,recipient_count,sent_count,failed_count,status,created_at&order=created_at.desc&limit=80', signal).catch(() => [])
      : Promise.resolve([]),
  ]);

  const roomsById = new Map(roomsRaw.map(r => [r.room_id, r]));
  const playersById = new Map(playersRaw.map(p => [String(p.id), p]));

  const schedule: Tournament[] = tournamentsRaw.map(row => ({
    id: String(row.id),
    clubId: DOYLE_CLUB.id,
    name: row.name,
    state: mapTournamentState(row, row.room_id ? roomsById.get(row.room_id) : undefined),
    startsAt: row.date,
    description: '',
    layout: null,
  }));

  schedule.sort((a, b) => {
    const order = { live: 0, scheduled: 1, draft: 2, finished: 3 };
    if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
    return toMs(b.startsAt, 0) - toMs(a.startsAt, 0);
  });

  const tournamentRow =
    tournamentsRaw.find(t => String(t.id) === selectedId)
    || tournamentsRaw.find(t => String(t.id) === schedule[0]?.id)
    || tournamentsRaw[0];

  const activeTournament: Tournament = tournamentRow
    ? schedule.find(s => s.id === String(tournamentRow.id))!
    : { id: 'empty', clubId: DOYLE_CLUB.id, name: 'Нет турниров', state: 'draft', startsAt: null, description: '', layout: null };

  const activeRoom = tournamentRow?.room_id ? roomsById.get(tournamentRow.room_id) : undefined;
  const activeState = (activeRoom?.state || {}) as Record<string, unknown>;
  const stTournament = (activeState.tournament || {}) as Record<string, unknown>;
  const stTimer = (activeState.timer || {}) as Record<string, unknown>;
  const stStructure = (activeState.structure || {}) as Record<string, unknown>;
  const stSeating = (activeState.seating || {}) as Record<string, unknown>;

  const structure = mapLevels(stStructure.levels);
  const levelIndex = Math.min(Math.max(0, Number(stTimer.levelIndex ?? 0) || 0), structure.length - 1);
  const levelDuration = structure[levelIndex]?.duration ?? 1200;
  const levelEndAt = Number(stTimer.levelEndAt ?? 0);
  const isRunning = Boolean(stTimer.isRunning && !stTimer.isPaused && Number.isFinite(levelEndAt) && levelEndAt > 0);
  const remaining = isRunning
    ? Math.max(0, Math.round((levelEndAt - now) / 1000))
    : Math.max(0, Number(stTimer.pauseRemainingSec ?? levelDuration) || levelDuration);

  const buyIn = Number(stTournament.buyIn ?? tournamentRow?.entry_fee ?? defaultConfig.buyIn) || 0;
  const addonCost = Number(stTournament.addonCost ?? buyIn) || 0;
  const addonChips = Number(stTournament.addonChips ?? stTournament.startStack ?? 30000) || 30000;
  const config: Config = {
    ...defaultConfig,
    anteEnabled: structure.some(l => l.kind === 'play' && l.ante > 0),
    buyIn,
    reentryFee: Number(stTournament.reentryFee ?? buyIn) || buyIn,
    startStack: Number(stTournament.startStack ?? 30000) || 30000,
    lateRegistration: Number(stTournament.lateRegUntilLevel ?? 0) || 0,
    addon: Boolean(stTournament.addonEnabled ?? stTournament.addon ?? false),
    addonCost,
    addonChips,
    knockout: Boolean(stTournament.pko),
    registrationLimit: tournamentRow?.slots ?? 0,
    seating: Boolean(stSeating.isActive),
    rating: {
      ...defaultRatingScheme,
      knockoutMode: stTournament.pko ? 'pool_per_entry' : 'pool_per_entry',
      knockoutPoints: stTournament.pko ? 4 : 2,
      distribution: 'curve',
      curveFactor: 0.8,
      roundStep: 1,
    },
  };

  // Рассадка из rooms.state.seating.tables
  const rawTables = Array.isArray(stSeating.tables) ? (stSeating.tables as Record<string, unknown>[]) : [];
  const tables: Table[] = config.seating && rawTables.length
    ? rawTables.map((t, idx) => ({
      number: idx + 1,
      capacity: Array.isArray(t.seats) && t.seats.length ? t.seats.length : 9,
    }))
    : [];

  const seatByPlayerId = new Map<string, { tableNo: number; seatNo: number }>();
  if (config.seating) {
    rawTables.forEach((t, ti) => {
      const seats = Array.isArray(t.seats) ? t.seats : [];
      seats.forEach((s, si) => {
        const obj = (s || {}) as Record<string, unknown>;
        if (obj.playerId != null) {
          seatByPlayerId.set(String(obj.playerId), { tableNo: ti + 1, seatNo: si + 1 });
        }
      });
    });
  }

  // Участники выбранного турнира (rooms.state.players + doyle_registrations + doyle_tournament_results)
  const roomPlayers = Array.isArray(activeState.players) ? (activeState.players as Record<string, unknown>[]) : [];
  const entriesMap = new Map<string, Entry>();
  const placeFromRoom = new Map<string, number>();

  roomPlayers.forEach((raw, idx) => {
    const pid = raw.player_id != null ? String(raw.player_id) : `manual-${idx}-${String(raw.name || 'player')}`;
    const dbPlayer = playersById.get(pid);
    const present = Boolean(raw.present);
    const busted = raw.status === 'busted' || Boolean(raw.busted);
    const status: Entry['status'] = !present ? 'registered' : busted ? 'out' : 'active';
    const seat = status === 'active' ? seatByPlayerId.get(pid) : undefined;
    const addon = Boolean(raw.addon);
    const addonTier = addon ? Math.min(3, Math.max(1, Number(raw.addonTier ?? 1) || 1)) : 0;
    const rateRaw = Number(raw.rate ?? raw.tariff ?? 100);
    const rate = rateRaw === 0 || rateRaw === 50 ? rateRaw : 100;
    const bustOrder = Number(raw.bustOrder ?? 0) || 0;
    if (raw.place != null && Number(raw.place) > 0) placeFromRoom.set(pid, Number(raw.place));

    entriesMap.set(pid, {
      playerId: pid,
      name: dbPlayer?.full_name || dbPlayer?.name || String(raw.name || 'Игрок'),
      nickname: dbPlayer?.name || String(raw.name || ''),
      photoUrl: normalizeDoylePhoto(dbPlayer?.photo_url),
      status,
      tableNo: seat?.tableNo ?? null,
      seatNo: seat?.seatNo ?? null,
      reentries: Math.max(0, Number(raw.reentries ?? 0) || 0),
      confirmed: present,
      addon,
      addonTier,
      addonChips: addon ? addonChips * addonTier : 0,
      knockouts: Math.max(0, Number(raw.ko ?? raw.knockouts ?? 0) || 0),
      rate,
      bustedAt: busted ? (bustOrder || idx + 1) : null,
    });
  });

  // Дополняем записями из doyle_registrations (если комнаты нет или кто-то не попал в state)
  if (tournamentRow) {
    for (const reg of regsRaw) {
      if (reg.tournament_id !== tournamentRow.id) continue;
      const pid = String(reg.player_id);
      if (entriesMap.has(pid)) continue;
      const dbPlayer = playersById.get(pid);
      const status: Entry['status'] = reg.attendance === 'present'
        ? (activeTournament.state === 'finished' ? 'out' : 'active')
        : 'registered';
      entriesMap.set(pid, {
        playerId: pid,
        name: dbPlayer?.full_name || dbPlayer?.name || `Игрок #${pid}`,
        nickname: dbPlayer?.name || '',
        photoUrl: normalizeDoylePhoto(dbPlayer?.photo_url),
        status,
        tableNo: null,
        seatNo: null,
        reentries: 0,
        confirmed: reg.attendance === 'present',
        addon: false,
        addonTier: 0,
        addonChips: 0,
        knockouts: 0,
        rate: 100,
        bustedAt: null,
      });
    }
  }

  // Результаты выбранного турнира
  const dbResultsForActive = tournamentRow
    ? resultsRaw.filter(r => r.tournament_id === tournamentRow.id).sort((a, b) => a.place - b.place)
    : [];

  for (const res of dbResultsForActive) {
    const pid = String(res.player_id);
    if (!entriesMap.has(pid)) {
      const dbPlayer = playersById.get(pid);
      entriesMap.set(pid, {
        playerId: pid,
        name: dbPlayer?.full_name || dbPlayer?.name || `Игрок #${pid}`,
        nickname: dbPlayer?.name || '',
        photoUrl: normalizeDoylePhoto(dbPlayer?.photo_url),
        status: 'out',
        tableNo: null,
        seatNo: null,
        reentries: 0,
        confirmed: true,
        addon: false,
        addonTier: 0,
        addonChips: 0,
        knockouts: res.ko_count ?? 0,
        rate: 100,
        bustedAt: res.place,
      });
    } else {
      const existing = entriesMap.get(pid)!;
      if (res.ko_count && !existing.knockouts) existing.knockouts = res.ko_count;
    }
  }

  const entries = [...entriesMap.values()];
  const activeEntries = entries.filter(e => e.status === 'active');
  const outEntries = entries.filter(e => e.status === 'out');

  let results: Result[];
  if (dbResultsForActive.length) {
    results = dbResultsForActive.map(r => {
      const pid = String(r.player_id);
      const dbPlayer = playersById.get(pid);
      return {
        playerId: pid,
        name: dbPlayer?.name || dbPlayer?.full_name || `Игрок #${pid}`,
        place: r.place,
        knockouts: r.ko_count ?? 0,
      };
    });
  } else {
    const sortedOut = [...outEntries].sort((a, b) => {
      const pa = placeFromRoom.get(a.playerId);
      const pb = placeFromRoom.get(b.playerId);
      if (pa != null && pb != null) return pa - pb;
      return (b.bustedAt ?? 0) - (a.bustedAt ?? 0);
    });
    results = [
      ...activeEntries.map(e => ({
        playerId: e.playerId,
        name: e.nickname || e.name,
        place: activeEntries.length === 1 && sortedOut.length > 0 ? 1 : null,
        knockouts: e.knockouts,
      })),
      ...sortedOut.map((e, idx) => ({
        playerId: e.playerId,
        name: e.nickname || e.name,
        place: placeFromRoom.get(e.playerId) ?? (activeEntries.length + idx + 1),
        knockouts: e.knockouts,
      })),
    ];
  }

  // Платежи и начисления по ВСЕМ турнирам клуба (для вкладки «Финансы» и «Оплаты»)
  const payments: Payment[] = [];
  let syntheticPaymentId = 1;
  const tournamentsByRoomId = new Map<string, DoyleTournamentRow>();
  for (const t of tournamentsRaw) {
    if (t.room_id) tournamentsByRoomId.set(t.room_id, t);
  }

  for (const t of tournamentsRaw) {
    const room = t.room_id ? roomsById.get(t.room_id) : undefined;
    const st = (room?.state || {}) as Record<string, unknown>;
    const tMeta = (st.tournament || {}) as Record<string, unknown>;
    const tBuyIn = Number(tMeta.buyIn ?? t.entry_fee ?? 0) || 0;
    const tReentry = Number(tMeta.reentryFee ?? tBuyIn) || tBuyIn;
    const tAddonCost = Number(tMeta.addonCost ?? tBuyIn) || 0;
    const tTime = toMs(t.date || t.created_at, now);
    const list = Array.isArray(st.players) ? (st.players as Record<string, unknown>[]) : [];

    list.forEach((raw, idx) => {
      if (!raw.present && !(Array.isArray(raw.payments) && raw.payments.length)) return;
      const pid = raw.player_id != null ? String(raw.player_id) : `manual-${idx}-${String(raw.name || 'player')}`;
      const rateRaw = Number(raw.rate ?? raw.tariff ?? 100);
      const rate = rateRaw === 0 || rateRaw === 50 ? rateRaw : 100;
      const waivedEntry = Boolean(raw.freeEntry || raw.compEntry || rate === 0);
      const entryAmount = Math.round(tBuyIn * rate / 100);
      if (tBuyIn > 0 && raw.present) {
        payments.push({
          id: syntheticPaymentId++,
          playerId: pid,
          tournamentId: String(t.id),
          tournamentName: t.name,
          time: tTime,
          amount: entryAmount,
          kind: 'buyin',
          method: null,
          waived: waivedEntry,
          collectedAtTournament: null,
        });
      }
      const reentries = Math.max(0, Number(raw.reentries ?? 0) || 0);
      for (let r = 0; r < reentries; r++) {
        if (tReentry > 0) {
          payments.push({
            id: syntheticPaymentId++,
            playerId: pid,
            tournamentId: String(t.id),
            tournamentName: t.name,
            time: tTime + (r + 1) * 1000,
            amount: Math.round(tReentry * rate / 100),
            kind: 'reentry',
            method: null,
            waived: false,
            collectedAtTournament: null,
          });
        }
      }
      if (raw.addon && tAddonCost > 0) {
        const tier = Math.min(3, Math.max(1, Number(raw.addonTier ?? 1) || 1));
        payments.push({
          id: syntheticPaymentId++,
          playerId: pid,
          tournamentId: String(t.id),
          tournamentName: t.name,
          time: tTime + 10000,
          amount: tAddonCost * tier,
          kind: 'addon',
          method: null,
          waived: Boolean(raw.freeAddon || raw.compAddon),
          collectedAtTournament: null,
        });
      }
      const rawPays = Array.isArray(raw.payments) ? (raw.payments as Record<string, unknown>[]) : [];
      rawPays.forEach((pay, pIdx) => {
        const amount = Math.max(0, Number(pay.amount ?? 0) || 0);
        if (amount <= 0) return;
        const payTime = Number(pay.ts ?? pay.at ?? pay.time) || (tTime + 20000 + pIdx * 1000);
        payments.push({
          id: syntheticPaymentId++,
          playerId: pid,
          tournamentId: String(t.id),
          tournamentName: t.name,
          time: payTime,
          amount,
          kind: 'payment',
          method: mapMethod(pay.method),
          waived: false,
          collectedAtTournament: String(t.id),
        });
      });
    });
  }

  // Непогашенные долги из crm_player_debts (если у игрока нет дублирующих начислений в этой комнате)
  for (const debt of debtsRaw) {
    if (debt.settled_at) continue;
    const tid = debt.tournament_id != null ? String(debt.tournament_id) : 'debt-' + debt.id;
    const alreadyHas = payments.some(p => p.playerId === String(debt.player_id) && p.tournamentId === tid);
    if (!alreadyHas && debt.amount > 0) {
      payments.push({
        id: syntheticPaymentId++,
        playerId: String(debt.player_id),
        tournamentId: tid,
        tournamentName: debt.tournament_name || debt.reason || 'Долг за турнир',
        time: toMs(debt.created_at, now),
        amount: debt.amount,
        kind: 'buyin',
        method: null,
        waived: false,
        collectedAtTournament: null,
      });
    }
  }

  // Визиты и CRM
  const visitsMap = new Map<string, Visit>();
  const tournamentById = new Map(tournamentsRaw.map(t => [t.id, t]));
  for (const reg of regsRaw) {
    if (reg.attendance !== 'present') continue;
    const t = tournamentById.get(reg.tournament_id);
    if (!t) continue;
    const key = `${reg.player_id}:${reg.tournament_id}`;
    visitsMap.set(key, {
      playerId: String(reg.player_id),
      tournamentId: String(reg.tournament_id),
      tournamentName: t.name,
      time: toMs(t.date || reg.created_at, now),
    });
  }
  for (const res of resultsRaw) {
    const t = tournamentById.get(res.tournament_id);
    if (!t) continue;
    const key = `${res.player_id}:${res.tournament_id}`;
    if (!visitsMap.has(key)) {
      visitsMap.set(key, {
        playerId: String(res.player_id),
        tournamentId: String(res.tournament_id),
        tournamentName: t.name,
        time: toMs(t.date || t.created_at, now),
      });
    }
  }
  const visits = [...visitsMap.values()].sort((a, b) => b.time - a.time);

  const tagsByPlayer = new Map<string, string[]>();
  for (const row of tagsRaw) {
    const pid = String(row.player_id);
    const list = tagsByPlayer.get(pid);
    if (list) list.push(row.tag);
    else tagsByPlayer.set(pid, [row.tag]);
  }

  const visitsCountByPlayer = new Map<string, number>();
  for (const v of visits) {
    visitsCountByPlayer.set(v.playerId, (visitsCountByPlayer.get(v.playerId) ?? 0) + 1);
  }
  const regPlayers = new Set(regsRaw.map(r => String(r.player_id)));

  const roster: Player[] = playersRaw.map(p => {
    const pid = String(p.id);
    const vCount = Math.max(visitsCountByPlayer.get(pid) ?? 0, p.games_played ?? 0);
    const stage: PipelineStage = vCount >= 3 ? 'regular' : vCount >= 1 ? 'first_visit' : regPlayers.has(pid) ? 'registered' : 'lead';
    return {
      id: pid,
      name: p.full_name || p.name,
      nickname: p.name,
      photoUrl: normalizeDoylePhoto(p.photo_url),
      source: p.tg_id ? 'Telegram' : 'Клуб',
      note: p.bio || '',
      tags: (tagsByPlayer.get(pid) ?? []).join(', '),
      phone: '',
      telegram: p.tg_username ? '@' + p.tg_username.replace(/^@/, '') : p.tg_id ? `id:${p.tg_id}` : '',
      instagram: '',
      registeredAt: toMs(p.registered_at, now),
      telegramConsent: Boolean(p.marketing_consent),
      stage,
      owner: 'Администратор',
    };
  });

  const notes: PlayerNote[] = notesRaw.map(n => ({
    id: n.id,
    playerId: String(n.player_id),
    author: n.admin_email || 'Администратор',
    body: n.text,
    createdAt: toMs(n.created_at, now),
  }));

  const registrations: RegistrationRecord[] = regsRaw.map(r => {
    const t = tournamentById.get(r.tournament_id);
    return {
      playerId: String(r.player_id),
      tournamentId: String(r.tournament_id),
      tournamentName: t?.name || `Турнир #${r.tournament_id}`,
      status: r.attendance === 'present' ? 'active' : 'registered',
      queued: false,
      registeredAt: toMs(r.created_at, now),
      visitedAt: r.attendance === 'present' ? toMs(t?.date || r.created_at, now) : null,
      broadcastId: null,
    };
  });

  const broadcasts: BroadcastSummary[] = broadcastsRaw.map(b => ({
    id: String(b.id),
    title: String((b.filter as Record<string, unknown> | null)?.segment || 'Рассылка Telegram'),
    segment: 'all',
    segmentLabel: String((b.filter as Record<string, unknown> | null)?.segment || 'Все подписчики'),
    tournamentId: null,
    tournamentName: null,
    message: b.message,
    linkUrl: '',
    status: b.status === 'failed' ? 'failed' : b.status === 'sending' ? 'sending' : 'sent',
    mode: 'live',
    sentCount: b.sent_count ?? 0,
    failedCount: b.failed_count ?? 0,
    clicksCount: 0,
    registeredCount: 0,
    attendedCount: 0,
    revenue: 0,
    rateLimitPerSec: 25,
    createdAt: toMs(b.created_at, now),
    sentAt: toMs(b.created_at, now),
  }));

  const crm: CrmData = {
    notes,
    messages: [],
    broadcasts,
    registrations,
    tasks: [],
    events: [],
    botConfigured: true,
    rateLimitPerSec: 25,
  };

  const presets: Preset[] = blueprintsRaw.map(bp => ({
    name: bp.name,
    structure: mapLevels(bp.levels),
    config: {
      startStack: bp.start_stack ?? 30000,
      lateRegistration: bp.late_reg_until_level ?? 0,
      buyIn: bp.default_buy_in ?? 1500,
      registrationLimit: bp.default_registered ?? 0,
      seating: Boolean(bp.enables_seating),
    },
  }));

  const journal: JournalItem[] = Array.isArray(activeState.corrections)
    ? (activeState.corrections as Record<string, unknown>[]).slice(0, 30).map((c, idx) => ({
      id: idx + 1,
      label: `Правка вылета (${String(c.action || 'edit')})`,
      actor: String(c.by || 'Администратор'),
      time: Number(c.at) || now,
    }))
    : [];

  const attended = entries.filter(e => e.status !== 'registered');
  const snapshot: Snapshot = {
    tournament: activeTournament,
    schedule,
    club: DOYLE_CLUB,
    role: 'admin',
    revision: Number(activeRoom?.version ?? 0) || 0,
    serverTime: now,
    clock: {
      level: levelIndex,
      remaining,
      startedAt: isRunning ? now : null,
      duration: levelDuration,
      manualBreak: Boolean(stTimer.breakUntil && Number(stTimer.breakUntil) > now),
    },
    stats: {
      registered: entries.length,
      active: activeEntries.length,
      seated: config.seating ? attended.filter(e => e.tableNo !== null).length : 0,
      reentries: attended.reduce((sum, e) => sum + e.reentries, 0),
      entered: attended.length,
      addons: attended.filter(e => e.addon).length,
      addonChips: attended.reduce((sum, e) => sum + e.addonChips, 0),
    },
    waitlist: { people: [], canAdmit: false },
    structure,
    presets,
    ratingPresets: baseRatingPresets,
    manualStats: { entered: 0, reentries: 0, out: 0 },
    config,
    display: { ...defaultDisplay, finalTable: Boolean((activeState.finalTable as Record<string, unknown> | undefined)?.isActive) },
    results,
    tables,
    entries,
    roster,
    visits,
    payments,
    journal,
    crm,
  };

  // Заглушка чтобы не ругался tsc на неиспользуемую переменную, если понадобится позже
  void tournamentsByRoomId;

  return { auth, snapshot };
}
