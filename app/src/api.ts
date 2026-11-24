import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, CommandResult, Session, Snapshot } from '../shared/model';
import {
  doyleSessionOf, doyleSignIn, loadDoyleSnapshot, loadSavedDoyleAuth, saveDoyleAuth, type DoyleAuth,
} from './doyleAdapter';

export type ProdAuthState = {
  user: { id: string; email: string; name: string; isSuperadmin: boolean };
  role: 'owner' | 'admin' | 'floor' | 'dealer';
  session: Session;
  memberships: { club: Session['club']; role: string; tableNo: number | null }[];
};

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Сервер недоступен');
  return body;
}

export function useOffice() {
  const [doyleAuth, setDoyleAuth] = useState<DoyleAuth | null>(() => loadSavedDoyleAuth());
  const [prodMode, setProdMode] = useState(false);
  const [prodAuth, setProdAuth] = useState<ProdAuthState | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [token, setToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get('session') || 'doyle-admin');
  const [id, setId] = useState(() => new URLSearchParams(location.hash.slice(1)).get('tournament') || 'doyle-main');
  const [snapshot, setSnapshot] = useState<{ data: Snapshot; token: string }>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; id: string } | undefined>(undefined);
  const inFlight = useRef(false);
  const doyleAuthRef = useRef<DoyleAuth | null>(doyleAuth);
  doyleAuthRef.current = doyleAuth;
  const prodModeRef = useRef(prodMode);
  prodModeRef.current = prodMode;

  const isDoyleLive = Boolean(doyleAuth);
  const activeSession = doyleAuth
    ? doyleSessionOf(doyleAuth)
    : prodMode
      ? prodAuth?.session
      : sessions.find(item => item.token === token);
  const activeToken = activeSession?.token ?? token;
  const activeSessions = doyleAuth && activeSession
    ? [activeSession]
    : prodMode && prodAuth
      ? prodAuth.memberships.map(m => ({ token: 'club:' + m.club.id, club: m.club, role: (m.role === 'dealer' ? 'dealer' : 'admin') as Session['role'], table: m.tableNo }))
      : sessions;
  const data = snapshot?.token === activeToken && (isDoyleLive || prodMode || snapshot.data.tournament.id === id) ? snapshot.data : undefined;
  const path = '/api/tournaments/' + id;

  const loadProdMe = useCallback(async () => {
    const resp = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (resp.status === 401) {
      setProdAuth(null);
      setAuthChecked(true);
      return;
    }
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.error || 'Ошибка авторизации');
    setProdAuth(body as ProdAuthState);
    if (body.defaultTournamentId) setId(body.defaultTournamentId);
    setAuthChecked(true);
  }, []);

  const load = useCallback(() => {
    if (doyleAuthRef.current) { setAuthChecked(true); return; }
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
    const auth = doyleAuthRef.current;
    if (auth) {
      const { auth: fresh, snapshot: next } = await loadDoyleSnapshot(auth, id || null, signal);
      if (!signal?.aborted) {
        if (fresh.accessToken !== auth.accessToken) setDoyleAuth(fresh);
        const liveToken = doyleSessionOf(fresh).token;
        setSnapshot({ data: next, token: liveToken });
        if (next.tournament.id && next.tournament.id !== id) setId(next.tournament.id);
        setError('');
      }
      return;
    }
    if (prodModeRef.current && (!id || id === 'doyle-main')) return;
    const headers: Record<string, string> = prodModeRef.current ? {} : { Authorization: 'Bearer ' + token };
    const next = await request<Snapshot>(path, { headers, signal });
    if (!signal?.aborted) {
      setSnapshot(previous => previous?.token === activeToken && previous.data.tournament.id === next.tournament.id &&
        previous.data.serverTime > next.serverTime ? previous : { data: next, token: activeToken });
      setError('');
    }
  }, [path, token, activeToken, id]);

  useEffect(() => {
    if (!activeSession) return;
    let stopped = false;
    let currentReq: AbortController | undefined;
    const tick = async () => {
      if (currentReq || stopped) return;
      const controller = new AbortController();
      currentReq = controller;
      const timeout = window.setTimeout(() => controller.abort(), isDoyleLive ? 14000 : 8000);
      try { await refresh(controller.signal); }
      catch (reason) {
        if (!stopped) setError(controller.signal.aborted ? 'Сервер не отвечает' : (reason as Error).message);
      } finally {
        window.clearTimeout(timeout);
        currentReq = undefined;
      }
    };
    const wake = () => { if (activeSession.role === 'display' || !document.hidden) void tick(); };
    void tick();
    const timer = window.setInterval(wake, isDoyleLive ? 6000 : 2000);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      stopped = true;
      currentReq?.abort();
      window.clearInterval(timer);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [activeSession?.token, isDoyleLive, refresh]);

  useEffect(() => {
    if (isDoyleLive || prodMode) return;
    history.replaceState(null, '', '#' + new URLSearchParams({ session: token, tournament: id }));
  }, [token, id, isDoyleLive, prodMode]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function select(next: Session) {
    if (inFlight.current || isDoyleLive) return;
    if (next.club.id !== activeSession?.club.id) setId(next.club.id + '-main');
    setToken(next.token);
    setNotice('');
    setError('');
  }
  function external(role: 'dealer' | 'display', table = 1) {
    if (isDoyleLive) {
      setNotice('Для ТВ-дисплея в режиме Дойла используйте действующий display.html клуба');
      return;
    }
    const next = sessions.find(item => item.club.id === activeSession?.club.id && item.role === role && (role === 'display' || item.table === table));
    if (next) window.open('#' + new URLSearchParams({ session: next.token, tournament: id }), '_blank', 'noopener');
  }
  async function exportPayments() {
    if (isDoyleLive) {
      throw new Error('Экспорт Excel доступен в локальном режиме или через админку Дойла');
    }
    const response = await fetch(path + '/payments.xlsx', { headers: { Authorization: 'Bearer ' + token } });
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
  async function connectDoyle(email: string, password: string) {
    setBusy(true);
    setError('');
    try {
      const auth = await doyleSignIn(email, password);
      setDoyleAuth(auth);
      setId('');
      setSnapshot(undefined);
      setNotice('Подключено к базе Дойла (безопасный режим просмотра)');
    } finally {
      setBusy(false);
    }
  }
  function disconnectDoyle() {
    saveDoyleAuth(null);
    setDoyleAuth(null);
    setSnapshot(undefined);
    setId('doyle-main');
    setToken('doyle-admin');
    setError('');
    setNotice('Переключено на локальное демо');
    request<Session[]>('/api/demo').then(items => {
      setSessions(items);
    }).catch((reason: Error) => setError(reason.message));
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
    setProdAuth(null);
    setSnapshot(undefined);
    setNotice('');
  }
  async function prodInvite(email: string, role: 'owner' | 'admin' | 'floor' | 'dealer') {
    const res = await request<{ token: string; expiresAt: number }>('/api/auth/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    return `${location.origin}/?invite=${res.token}`;
  }
  const run: Run = async (action, after) => {
    if (doyleAuthRef.current) {
      setNotice('Безопасный режим просмотра Дойла: изменения не отправляются в боевую базу');
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice('');
    const endpoint = action.type === 'createTournament' || action.type === 'copyTournamentWeek'
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
      if (!response.tournamentId) await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Операция не выполнена');
    } finally {
      inFlight.current = false;
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
    doyleAuth,
    connectDoyle,
    disconnectDoyle,
    prodMode,
    prodAuth,
    authChecked,
    prodLogin,
    prodAcceptInvite,
    prodLogout,
    prodInvite,
    setId: (next: string) => { if (!inFlight.current) { setId(next); setError(''); } },
  };
}

export type Run = (action: Command, after?: (result: CommandResult) => void) => Promise<void>;

