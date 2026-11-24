import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, Trash2 } from 'lucide-react';
import { roleLabels, type ClubAccounts as AccountList, type StaffRole } from '../shared/access';
import type { Club } from '../shared/model';
import { request } from './api';
import { Heading } from './widgets';

const expiry = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });
type Removal = { id: string; name: string } | { email: string; name: string };

export function ClubAccounts({ club }: { club: Club }) {
  const [list, setList] = useState<AccountList>();
  const [role, setRole] = useState<StaffRole>('admin');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [removal, setRemoval] = useState<Removal>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const report = (reason: unknown) => setError(reason instanceof Error ? reason.message : 'Не удалось сохранить изменения');

  useEffect(() => {
    const controller = new AbortController();
    request<AccountList>('/api/auth/accounts', { signal: controller.signal }).then(setList).catch(reason => {
      if (!controller.signal.aborted) report(reason);
    });
    return () => controller.abort();
  }, []);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setError('');
    setCopied(false);
    setLink('');
    try {
      const invitation = await request<{ token: string }>('/api/auth/invites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fields.get('email'), role, tableNo: role === 'dealer' ? Number(fields.get('table')) : null }),
      });
      setLink(location.origin + '/?' + new URLSearchParams({ invite: invitation.token }));
      form.reset();
      setList(await request<AccountList>('/api/auth/accounts'));
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: Removal) {
    setBusy(true);
    setError('');
    try {
      await request('/api/auth/accounts', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify('id' in target ? { id: target.id } : { email: target.email }),
      });
      setRemoval(undefined);
      setLink('');
      setList(await request<AccountList>('/api/auth/accounts'));
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Heading title="Учётные записи" subtitle={club.name} />
    {error && <p className="alert" role="alert">{error}</p>}
    <section className="panel admin-pane">
      <h2>Добавить сотрудника</h2>
      <form className="admin-form" onSubmit={invite}>
        <div className="fields-grid">
          <label>Email<input name="email" type="email" maxLength={254} required disabled={busy} /></label>
          <label>Роль<select value={role} onChange={event => setRole(event.target.value as StaffRole)} disabled={busy}>
            <option value="admin">Менеджер</option><option value="floor">Флор</option><option value="dealer">Дилер</option>
          </select></label>
          {role === 'dealer' && <label>Номер стола<input name="table" type="number" min={1} max={20} required disabled={busy} /></label>}
        </div>
        <button className="button primary" disabled={busy}>Создать приглашение</button>
        {link && <label>Одноразовая ссылка на 24 часа
          <input readOnly value={link} onFocus={event => event.currentTarget.select()} />
        </label>}
        {link && <button className="button" type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError('Выделите ссылку и скопируйте её вручную'); }
        }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Скопировано' : 'Копировать ссылку'}</button>}
      </form>
    </section>
    {list && <>
      <section className="panel roster">
        <div className="panel-head"><h2>Сотрудники клуба</h2></div>
        {list.members.map(member => <div className="person-row account-row" key={member.id}>
          <span><strong>{member.name || member.email}</strong><small>{member.email} · {roleLabels[member.role]}{member.tableNo ? ' · Стол ' + member.tableNo : ''}</small></span>
          {member.role !== 'owner' && <button className="button compact" type="button" disabled={busy}
            onClick={() => setRemoval({ id: member.id, name: member.name || member.email })}><Trash2 size={15} /> Удалить доступ</button>}
        </div>)}
      </section>
      {list.invitations.length > 0 && <section className="panel roster">
        <div className="panel-head"><h2>Ожидают активации</h2></div>
        {list.invitations.map(invitation => <div className="person-row account-row" key={invitation.email}>
          <span><strong>{invitation.email}</strong><small>{roleLabels[invitation.role]}{invitation.tableNo ? ' · Стол ' + invitation.tableNo : ''} · До {expiry.format(invitation.expiresAt)} МСК</small></span>
          <button className="button compact" type="button" disabled={busy}
            onClick={() => setRemoval({ email: invitation.email, name: invitation.email })}>Отозвать ссылку</button>
        </div>)}
      </section>}
    </>}
    {removal && <div className="backdrop">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="account-removal">
        <div className="dialog-body admin-form">
          <h2 id="account-removal">{'id' in removal ? 'Удалить доступ к клубу?' : 'Отозвать приглашение?'}</h2>
          <p>{removal.name}</p>
          {error && <p className="alert" role="alert">{error}</p>}
          <div className="actions">
            <button className="button" disabled={busy} onClick={() => setRemoval(undefined)}>Отмена</button>
            <button className="button primary" disabled={busy} onClick={() => void remove(removal)}>Подтвердить</button>
          </div>
        </div>
      </div>
    </div>}
  </>;
}
