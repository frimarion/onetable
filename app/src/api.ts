import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, CommandResult, Session, Snapshot } from '../shared/model';
import {
  doyleSessionOf, doyleSignIn, loadDoyleSnapshot, loadSavedDoyleAuth, saveDoyleAuth, type DoyleAuth,
} from './doyleAdapter';

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Сервер недоступен');
  return body;
}

export function useOffice() {
  const [doyleAuth, setDoyleAuth] = useState<DoyleAuth | null>(() => loadSavedDoyleAuth());
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

  const isDoyleLive = Boolean(doyleAuth);
  const activeSession = doyleAuth ? doyleSessionOf(doyleAuth) : sessions.find(item => item.token === token);
  const activeToken = activeSession?.token ?? token;
  const activeSessions = doyleAuth && activeSession ? [activeSession] : sessions;
  const data = snapshot?.token === activeToken && (isDoyleLive || snapshot.data.tournament.id === id) ? snapshot.data : undefined;
  const path = '/api/tournaments/' + id;

  const load = useCallback(() => {
    if (doyleAuthRef.current) return;
    request<Session[]>('/api/demo').then(items => {
      setSessions(items);
      setToken(current => items.some(item => item.token === current) ? current : 'doyle-admin');
    }).catch((reason: Error) => setError(reason.message));
  }, []);
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
    const next = await request<Snapshot>(path, { headers: { Authorization: 'Bearer ' + token }, signal });
    if (!signal?.aborted) {
      setSnapshot(previous => previous?.token === token && previous.data.tournament.id === next.tournament.id &&
        previous.data.serverTime > next.serverTime ? previous : { data: next, token });
      setError('');
    }
  }, [path, token, id]);

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
    if (isDoyleLive) return;
    history.replaceState(null, '', '#' + new URLSearchParams({ session: token, tournament: id }));
  }, [token, id, isDoyleLive]);

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
    const key = JSON.stringify([token, endpoint, action]);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    try {
      const response = await request<CommandResult>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
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
    setId: (next: string) => { if (!inFlight.current) { setId(next); setError(''); } },
  };
}

export type Run = (action: Command, after?: (result: CommandResult) => void) => Promise<void>;

