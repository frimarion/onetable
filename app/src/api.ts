import { useCallback, useEffect, useRef, useState } from 'react';
import type { MemberRole } from '../shared/access';
import type { Command, CommandResult, Session, Snapshot } from '../shared/model';
import type { DoyleRows } from '../shared/doyleQueries';
import { mapDoyleSnapshot } from './doyleAdapter';
import { CLUB_HEADER, DOYLE_CLUB_ID, workspaceClubId, workspacePath } from '../shared/workspace';

export type OAuthProvider = 'telegram' | 'vk' | 'yandex';

export type LinkedIdentity = {
  provider: OAuthProvider;
  username: string;
  displayName: string;
  createdAt: number;
};

export type TelegramAuthMode = 'oidc' | 'widget' | 'none';

export type OAuthProvidersStatus = {
  telegram: { enabled: boolean; mode?: TelegramAuthMode; botUsername: string };
  vk: { enabled: boolean };
  yandex: { enabled: boolean };
};

export type ProdAuthState = {
  user: { id: string; email: string; name: string; avatarUrl?: string; isSuperadmin: boolean };
  role: MemberRole;
  session: Session;
  memberships: { club: Session['club']; role: MemberRole; tableNo: number | null }[];
  identities?: LinkedIdentity[];
  doyleAccess?: boolean;
  doyleWrite?: boolean;
  doyleUnavailable?: boolean;
  defaultTournamentId?: string | null;
};

function workspaceHeaders(values?: HeadersInit, clubId = workspaceClubId(location.pathname)) {
  const headers = new Headers(values);
  if (clubId && !headers.has(CLUB_HEADER)) headers.set(CLUB_HEADER, clubId);
  return headers;
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: workspaceHeaders(options?.headers) });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { /* non-JSON proxy response */ }
  if (!response.ok) {
    if (response.status === 429) throw new Error(String(body.error || 'Слишком много попыток. Подождите минуту.'));
    throw new Error(String(body.error || `Ошибка сервера (${response.status})`));
  }
  return body as T;
}

export function useOffice(doyleTvTournament?: string) {
  const [prodMode, setProdMode] = useState(false);
  const [prodAuth, setProdAuth] = useState<ProdAuthState | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [token, setToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get('session') || 'doyle-admin');
  const [id, setId] = useState(() => doyleTvTournament || new URLSearchParams(location.hash.slice(1)).get('tournament') || 'doyle-main');
  const [snapshot, setSnapshot] = useState<{ data: Snapshot; token: string }>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; id: string } | undefined>(undefined);
  const inFlight = useRef(false);
  const prodModeRef = useRef(prodMode);
  prodModeRef.current = prodMode;

  const isDoyleLive = Boolean(prodAuth?.doyleAccess);
  const activeSession = prodMode ? prodAuth?.session : sessions.find(item => item.token === token);
  const activeToken = activeSession?.token ?? token;
  const activeRole = activeSession?.role;
  const activeSessions = prodMode && prodAuth
    ? prodAuth.memberships.map(m => ({ token: 'club:' + m.club.id, club: m.club, role: (m.role === 'dealer' || m.role === 'floor' ? m.role : 'admin') as Session['role'], memberRole: m.role, table: m.tableNo }))
    : sessions;
  const data = snapshot?.token === activeToken && (!id || snapshot.data.tournament.id === id) ? snapshot.data : undefined;
  const path = '/api/tournaments/' + id;

  const loadProdMe = useCallback(async () => {
    const headers = workspaceHeaders(undefined, doyleTvTournament ? DOYLE_CLUB_ID : undefined);
    const resp = await fetch('/api/auth/me', { credentials: 'same-origin', headers });
    if (resp.status === 401) {
      setProdAuth(null);
      setError('');
      setAuthChecked(true);
      return;
    }
    const body = await resp.json() as ProdAuthState & { error?: string };
    if (resp.status === 403) {
      setProdAuth(null);
      setError(body.error || 'У вас нет доступа к этому клубу');
      setAuthChecked(true);
      return;
    }
    if (!resp.ok) throw new Error(body.error || 'Ошибка авторизации');
    if (!doyleTvTournament && !new URLSearchParams(location.search).has('invite')) {
      history.replaceState(null, '', workspacePath(body.session.club.id));
    }
    setProdAuth(body);
    const defaultId = body.defaultTournamentId ?? '';
    setId(body.doyleAccess ? doyleTvTournament || '' : defaultId);
    setError('');
    setAuthChecked(true);
  }, [doyleTvTournament]);

  const load = useCallback(() => {
    fetch('/api/demo', { credentials: 'same-origin' }).then(async resp => {
      if (resp.status === 404) {
        setProdMode(true);
        await loadProdMe();
        return;
      }
      const items = (await resp.json()) as Session[];
      if (!resp.ok) throw new Error('Сервер недоступен');
      setSessions(items);
      setToken(current => items.some(item => item.token === current) ? current : 'doyle-admin');
      setAuthChecked(true);
    }).catch((reason: Error) => { setError(reason.message); setAuthChecked(true); });
  }, [loadProdMe]);
  useEffect(load, [load]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (isDoyleLive && activeSession) {
      const headers = workspaceHeaders(undefined, activeSession.club.id);
      const rows = await request<DoyleRows>('/api/doyle/snapshot', { signal, headers });
      const next = await mapDoyleSnapshot(activeSession.club, id || null, async resource => rows[resource], rows);
      if (!signal?.aborted) {
        setSnapshot({ data: next, token: activeToken });
        setId(next.tournament.id);
        setError('');
      }
      return;
    }
    if (prodModeRef.current && !id) return;
    const headers: Record<string, string> = prodModeRef.current ? {} : { Authorization: 'Bearer ' + token };
    const next = await request<Snapshot>(path, { headers, signal });
    if (!signal?.aborted) {
      setSnapshot(previous => previous?.token === activeToken && previous.data.tournament.id === next.tournament.id &&
        previous.data.serverTime > next.serverTime ? previous : { data: next, token: activeToken });
      setError('');
    }
  }, [path, token, activeToken, id, isDoyleLive, activeSession]);

  useEffect(() => {
    if (!activeRole) return;
    let stopped = false;
    let refreshQueued = false;
    let currentReq: AbortController | undefined;
    let stream: AbortController | undefined;
    let streamReady = false;
    let lastStreamUpdate = 0;
    const visible = () => activeRole === 'display' || !document.hidden;
    const tick = async () => {
      if (stopped || !visible()) return;
      if (currentReq) {
        refreshQueued = true;
        return;
      }
      const controller = new AbortController();
      currentReq = controller;
      const timeout = window.setTimeout(() => controller.abort(), isDoyleLive ? 14000 : 8000);
      try { await refresh(controller.signal); }
      catch (reason) {
        if (!stopped) setError(controller.signal.aborted ? 'Сервер не отвечает' : (reason as Error).message);
      } finally {
        window.clearTimeout(timeout);
        currentReq = undefined;
        if (refreshQueued) {
          refreshQueued = false;
          void tick();
        }
      }
    };
    const connect = async () => {
      if (stopped || isDoyleLive || !id || stream || !visible()) return;
      const controller = new AbortController();
      stream = controller;
      lastStreamUpdate = Date.now();
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      if (!prodMode) headers.Authorization = 'Bearer ' + token;
      try {
        const response = await fetch('/api/office/updates', { headers: workspaceHeaders(headers), signal: controller.signal });
        if (!response.ok || !response.headers.get('Content-Type')?.startsWith('text/event-stream') || !response.body) {
          await response.body?.cancel();
          return;
        }
        const reader = response.body.getReader();
        // The stream carries only refresh signals. Split or coalesced frames also trigger a refresh.
        while (!(await reader.read()).done) {
          streamReady = true;
          lastStreamUpdate = Date.now();
          void tick();
        }
      } catch { /* Poll while the stream is unavailable. */ }
      finally {
        stream = undefined;
        streamReady = false;
      }
    };
    const wake = () => {
      void tick();
      void connect();
    };
    wake();
    const timer = window.setInterval(() => {
      if (stream && Date.now() - lastStreamUpdate > 30_000) {
        streamReady = false;
        stream.abort();
      }
      if (!streamReady) wake();
    }, isDoyleLive ? 6000 : prodMode ? 5000 : 2000);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      stopped = true;
      currentReq?.abort();
      stream?.abort();
      window.clearInterval(timer);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [activeRole, id, isDoyleLive, prodMode, refresh, token]);

  const clock = data?.tournament.state === 'live' ? data.clock : undefined;
  const clockEndsAt = clock?.startedAt == null ? undefined : clock.startedAt + clock.remaining * 1000;
  const serverTime = data?.serverTime;
  useEffect(() => {
    if (isDoyleLive || clockEndsAt === undefined || serverTime === undefined || clockEndsAt <= serverTime) return;
    const controller = new AbortController();
    // The server advances the clock when the next snapshot is requested.
    const timer = window.setTimeout(() => {
      if (activeRole === 'display' || !document.hidden) void refresh(controller.signal).catch(() => {});
    }, clockEndsAt - serverTime);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeRole, clockEndsAt, isDoyleLive, refresh, serverTime]);

  useEffect(() => {
    if (!authChecked || isDoyleLive || prodMode) return;
    history.replaceState(null, '', '#' + new URLSearchParams({ session: token, tournament: id }));
  }, [token, id, isDoyleLive, prodMode, authChecked]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function select(next: Session) {
    if (inFlight.current) return;
    if (prodMode) {
      if (next.club.id === prodAuth?.session.club.id) return;
      setBusy(true);
      try {
        await request('/api/auth/switch-club', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clubId: next.club.id }),
        });
        location.assign(workspacePath(next.club.id));
      } catch (reason) {
        setNotice(reason instanceof Error ? reason.message : 'Не удалось открыть клуб');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (next.club.id !== activeSession?.club.id) setId(next.club.id + '-main');
    setToken(next.token);
    setNotice('');
    setError('');
  }
  async function external(role: 'dealer' | 'display', table = 1) {
    if (isDoyleLive) {
      if (role === 'display') window.open(workspacePath(DOYLE_CLUB_ID) + '#' + new URLSearchParams({ 'doyle-tv': id }), '_blank', 'noopener');
      return;
    }
    if (prodMode) {
      if (role !== 'display') return;
      // Open during the click so browsers allow it even before the token arrives.
      const screen = window.open('about:blank', '_blank');
      if (!screen) { setNotice('Разрешите открывать новые вкладки для ТВ-дисплея'); return; }
      screen.opener = null;
      try {
        const { token: tvToken } = await request<{ token: string }>(path + '/tv-token', { method: 'POST' });
        screen.location.replace('/#' + new URLSearchParams({ tv: tvToken }));
      } catch (reason) {
        screen.close();
        setNotice(reason instanceof Error ? reason.message : 'Не удалось открыть ТВ-дисплей');
      }
      return;
    }
    const next = sessions.find(item => item.club.id === activeSession?.club.id && item.role === role && (role === 'display' || item.table === table));
    if (next) window.open('#' + new URLSearchParams({ session: next.token, tournament: id }), '_blank', 'noopener');
  }
  async function exportPayments() {
    if (isDoyleLive) {
      throw new Error('Экспорт Excel доступен в локальном режиме или через админку Дойла');
    }
    const headers = workspaceHeaders(prodMode ? undefined : { Authorization: 'Bearer ' + token });
    const response = await fetch(path + '/payments.xlsx', { headers });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Не удалось скачать отчёт');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Оплаты — ' + (data?.tournament.name ?? 'турнир') + '.xlsx';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function prodLogin(email: string, password: string) {
    setBusy(true);
    setError('');
    try {
      await request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      await loadProdMe();
    } finally {
      setBusy(false);
    }
  }
  async function prodAcceptInvite(inviteToken: string, name: string, password: string) {
    setBusy(true);
    setError('');
    try {
      await request('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken, name, password }),
      });
      history.replaceState(null, '', location.pathname);
      await loadProdMe();
    } finally {
      setBusy(false);
    }
  }
  async function prodLogout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    history.replaceState(null, '', '/');
    setProdAuth(null);
    setSnapshot(undefined);
    setNotice('');
    setError('');
  }
function applyOptimistic(data: Snapshot, action: Command): Snapshot | null {
  if (action.type === 'assign') {
    const entries = data.entries.map(e =>
      e.playerId === action.playerId ? { ...e, tableNo: action.tableNo, seatNo: action.seatNo } : e,
    );
    const seated = entries.filter(e => e.status === 'active' && e.tableNo !== null).length;
    return { ...data, entries, stats: { ...data.stats, seated } };
  }
  if (action.type === 'vacate') {
    const entries = data.entries.map(e =>
      e.playerId === action.playerId ? { ...e, tableNo: null, seatNo: null, confirmed: false } : e,
    );
    const seated = entries.filter(e => e.status === 'active' && e.tableNo !== null).length;
    return { ...data, entries, stats: { ...data.stats, seated } };
  }
  if (action.type === 'swapSeats') {
    const first = data.entries.find(e => e.playerId === action.playerId);
    const second = data.entries.find(e => e.playerId === action.withPlayerId);
    if (!first || !second) return null;
    const entries = data.entries.map(e => {
      if (e.playerId === action.playerId) return { ...e, tableNo: second.tableNo, seatNo: second.seatNo };
      if (e.playerId === action.withPlayerId) return { ...e, tableNo: first.tableNo, seatNo: first.seatNo };
      return e;
    });
    return { ...data, entries };
  }
  if (action.type === 'confirmSeat') {
    const entries = data.entries.map(e =>
      e.playerId === action.playerId ? { ...e, confirmed: true } : e,
    );
    return { ...data, entries };
  }
  if (action.type === 'clearSeating') {
    const entries = data.entries.map(e => ({ ...e, tableNo: null, seatNo: null, confirmed: false }));
    return { ...data, entries, stats: { ...data.stats, seated: 0 } };
  }
  return null;
}

  const run: Run = async (action, after) => {
    if (isDoyleLive && !prodAuth?.doyleWrite) {
      setNotice('Данные Doyle открыты в режиме просмотра');
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice('');
    const previousSnapshot = snapshot;
    const optimistic = previousSnapshot && previousSnapshot.token === activeToken
      ? applyOptimistic(previousSnapshot.data, action)
      : null;
    if (optimistic && previousSnapshot) {
      setSnapshot({ data: optimistic, token: previousSnapshot.token });
    }
    const endpoint = isDoyleLive
      ? (action.type === 'createTournament' || action.type === 'copyTournamentWeek' || !id
        ? '/api/doyle/commands'
        : '/api/doyle/tournaments/' + id + '/commands')
      : action.type === 'createTournament' || action.type === 'copyTournamentWeek'
        ? '/api/clubs/' + activeSession?.club.id + '/tournaments' : path + '/commands';
    const key = JSON.stringify([activeToken, endpoint, action]);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    try {
      const headers: Record<string, string> = prodModeRef.current
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
      const response = await request<CommandResult>(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, id: pending.current.id }),
      });
      pending.current = undefined;
      setNotice(response.message);
      if (response.tournamentId) {
        setId(response.tournamentId);
        setError('');
      }
      after?.(response);
      if (!response.tournamentId) {
        if (optimistic) {
          // Для оптимистичных операций рассадки обновляем снимок в фоне, не блокируя следующий перенос
          void refresh().catch((reason: Error) => setError(reason.message));
        } else {
          await refresh().catch((reason: Error) => setError(reason.message));
        }
      }
    } catch (reason) {
      if (optimistic && previousSnapshot) setSnapshot(previousSnapshot);
      setNotice(reason instanceof Error ? reason.message : 'Операция не выполнена');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const updateProfile = async (patch: { name?: string; avatarUrl?: string }) => {
    const res = await request<{ user: ProdAuthState['user'] }>('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    setProdAuth(prev => prev ? { ...prev, user: res.user } : prev);
    return res.user;
  };
  const setIdentities = (identities: LinkedIdentity[]) => {
    setProdAuth(prev => prev ? { ...prev, identities } : prev);
  };
  const prodLoginTelegram = async (auth: Record<string, unknown>) => {
    setBusy(true);
    try {
      await request('/api/auth/oauth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'login', auth }),
      });
      await loadProdMe();
    } finally {
      setBusy(false);
    }
  };
  return {
    session: activeSession,
    sessions: activeSessions,
    data,
    busy,
    error,
    notice,
    setNotice,
    load,
    select,
    external,
    run,
    exportPayments,
    isDoyleLive,
    prodMode,
    prodAuth,
    authChecked,
    prodLogin,
    prodLoginTelegram,
    prodAcceptInvite,
    prodLogout,
    updateProfile,
    setIdentities,
    waitingForTournament: prodMode && !isDoyleLive && !id,
    setId: (next: string) => { if (!inFlight.current) { setId(next); setError(''); } },
  };
}

export type Run = (action: Command, after?: (result: CommandResult) => void) => Promise<void>;

