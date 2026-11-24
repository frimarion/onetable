import { useEffect, useState, type FormEvent } from 'react';
import type { RegistrationStatus } from '../shared/model';
import { request } from './api';

export function OnlineRegistration({ club, tournament }: { club: string; tournament: string }) {
  const [key] = useState(() => {
    const storageKey = 'onetable-registration:' + club;
    const stored = localStorage.getItem(storageKey);
    if (stored) return stored;
    const generated = crypto.randomUUID();
    localStorage.setItem(storageKey, generated);
    return generated;
  });
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [status, setStatus] = useState<RegistrationStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = '/api/public/clubs/' + encodeURIComponent(club) + '/tournaments/' + encodeURIComponent(tournament) + '/registration';

  useEffect(() => {
    if (busy) return;
    const controller = new AbortController();
    async function refresh() {
      try {
        const next = await request<RegistrationStatus>(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', key }), signal: controller.signal,
        });
        if (!controller.signal.aborted) setStatus(next);
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message);
      }
    }
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [url, key, busy]);

  async function send(action: 'register' | 'cancel', event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError('');
    try {
      setStatus(await request<RegistrationStatus>(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, name, nickname, key }),
      }));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel admin-pane online-registration" aria-labelledby="registration-heading">
    <h2 id="registration-heading">Запись на турнир</h2>
    {error && <p role="alert" className="alert">{error}</p>}
    {!status && !error && <p role="status">Проверяем наличие мест…</p>}
    {status?.state === 'registered' && <p role="status">Вы записаны. По прибытии отметьтесь у администратора.</p>}
    {status?.state === 'waiting' && <p role="status">Ваше место в листе ожидания — {status.position}. По прибытии отметьтесь у администратора.</p>}
    {status?.state === 'admitted' && <p role="status">Администратор подтвердил ваше участие.</p>}
    {status && !status.state && !status.open && <p role="status">Регистрация закрыта.</p>}
    {status?.open && !status.state && <form className="admin-form" onSubmit={event => void send('register', event)}>
      {status.full && <p className="muted">Свободных мест для прямой записи сейчас нет. Можно встать в лист ожидания.</p>}
      <label>Имя и фамилия<input required maxLength={80} autoComplete="name" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label>Никнейм (необязательно)<input maxLength={40} autoComplete="nickname" value={nickname} disabled={busy} onChange={event => setNickname(event.target.value)} /></label>
      <button className="button primary" disabled={busy}>{status.full ? 'Встать в лист ожидания' : 'Записаться'}</button>
    </form>}
    {(status?.state === 'registered' || status?.state === 'waiting') &&
      <button className="button" disabled={busy} onClick={() => void send('cancel')}>Отменить запись</button>}
  </section>;
}
