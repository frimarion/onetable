import { useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarPlus, ChevronRight, Clock3, Database, ExternalLink, LayoutGrid, LogOut, Plus, ShieldCheck, Trophy, UsersRound, Wallet, X } from 'lucide-react';
import { useOffice } from './api';
import { Brand, Heading, pad, Person, State, Timer, money, startLabel } from './widgets';
import { Crm, Dialog, bustModal, type Modal } from './crm';
import { Live } from './Live';
import { Display } from './Display';
import { TournamentEditor } from './TournamentEditor';
import { TournamentWeek } from './TournamentWeek';
import { RatingStudio } from './RatingBuilder';
import { ClubFinance } from './ClubFinance';
import { MobileNav } from './MobileNav';
import { ThemeSwitch } from './Theme';
import { scheduleHref } from './PublicSchedule';

type View = 'live' | 'crm' | 'rating' | 'finance' | 'tournaments' | 'create' | 'edit' | 'week';

function DoyleConnectDialog({ busy, onConnect, onClose }: {
  busy: boolean;
  onConnect: (email: string, password: string) => Promise<void>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('alexander@doyle.ru');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setErr('');
    try {
      await onConnect(email, password);
      onClose();
    } catch (reason) {
      setErr(reason instanceof Error ? reason.message : 'Не удалось войти');
    }
  }
  return <div className="backdrop" onClick={onClose}>
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="doyle-connect-title" onClick={event => event.stopPropagation()}>
      <div className="dialog-head">
        <h2 id="doyle-connect-title">Подключение к Дойлу</h2>
        <button className="button icon" aria-label="Закрыть" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="dialog-body">
        <p className="muted">Войдите под админской учётной записью Supabase Дойла. Кабинет откроется в <strong>безопасном режиме просмотра</strong>: турниры, игроки с аватарками, оплаты, результаты, CRM и «Финансы» подтянутся вживую, но никакие изменения в боевую базу отправляться не будут.</p>
        {err && <p className="alert" role="alert">{err}</p>}
        <form className="admin-form" onSubmit={submit}>
          <label>Email администратора
            <input type="email" required autoFocus value={email} disabled={busy} onChange={event => setEmail(event.target.value)} placeholder="alexander@doyle.ru" />
          </label>
          <label>Пароль
            <input type="password" required value={password} disabled={busy} onChange={event => setPassword(event.target.value)} placeholder="Пароль от админки Дойла" />
          </label>
          <div className="actions">
            <button className="button primary" type="submit" disabled={busy}>{busy ? 'Подключаем…' : 'Подключить'}</button>
            <button className="button" type="button" disabled={busy} onClick={onClose}>Отмена</button>
          </div>
        </form>
      </div>
    </div>
  </div>;
}

export function App() {
  const office = useOffice();
  const { session, data, busy, error, notice, setNotice, sessions, run, select, external, doyleAuth, connectDoyle, disconnectDoyle } = office;
  const [view, setView] = useState<View>('live');
  const [modal, setModal] = useState<Modal>();
  const [connectOpen, setConnectOpen] = useState(false);
  const open = (next: Modal) => { setNotice(''); setModal(next); };
  const admin = sessions.find(item => item.role === 'admin' && item.club.id === session?.club.id);
  if (!session || !data) {
    return <main className="standalone"><Brand /><h1>{error ? 'Не удалось открыть кабинет' : doyleAuth ? 'Загружаем данные Дойла…' : 'Загружаем кабинет'}</h1>
      {error && <><p>{error}</p><div className="actions">
        {doyleAuth && <button className="button primary" onClick={disconnectDoyle}>Вернуться в демо</button>}
        <button className="button" onClick={() => { if (sessions.length) location.assign(location.pathname); else office.load(); }}>Повторить</button>
      </div></>}
    </main>;
  }
  if (session.role === 'display') return <Display key={data.tournament.id} data={data} error={error} />;

  const dealer = session.role === 'dealer';
  const screen = dealer ? 'dealer' : view === 'live' && data.tournament.state === 'draft' ? 'edit' : view;
  const breadcrumb = screen === 'crm' ? 'CRM' : screen === 'rating' ? 'Рейтинг' : screen === 'finance' ? 'Финансы' : dealer ? 'Планшет дилера' : 'Турниры';
  function navigate(next: View) {
    setView(next);
    window.scrollTo(0, 0);
  }
  return <div className={dealer ? 'shell dealer-shell' : 'shell admin-shell'}>
    <header className="topbar">
      <Brand />
      <div className="top-context"><span>Кабинет клуба</span><ChevronRight size={14} /><span>{breadcrumb}</span></div>
      <div className="top-right">
        {doyleAuth
          ? <span className="state live" title={`Подключено к ${doyleAuth.host || 'Supabase Дойла'} (только чтение)`}><ShieldCheck size={14} /> Дойл · просмотр</span>
          : <button className="button compact" type="button" onClick={() => setConnectOpen(true)}><Database size={14} /> Подключить Дойл</button>}
        <ThemeSwitch />
        {dealer ? <button className="button" onClick={() => admin && select(admin)}><ArrowLeft size={16} /> Кабинет</button> :
          <span className="profile"><span className="avatar">{(doyleAuth?.email?.[0] || 'А').toUpperCase()}</span><span>{doyleAuth ? doyleAuth.email : 'Администратор'}</span></span>}
      </div>
    </header>
    {!dealer && <aside className="sidebar">
      <div className="club-switch"><label htmlFor="club">Рабочее пространство</label>
        <select id="club" value={session.club.id} disabled={busy} onChange={event => {
          setModal(undefined); setView('live'); select(sessions.find(item => item.club.id === event.target.value && item.role === 'admin')!);
        }}>
          {sessions.filter(item => item.role === 'admin').map(item => <option key={item.club.id} value={item.club.id}>{item.club.name}</option>)}
        </select>
      </div>
      <nav aria-label="Разделы клуба">
        <button disabled={busy} className={screen !== 'crm' && screen !== 'rating' && screen !== 'finance' ? 'selected' : ''} onClick={() => setView('tournaments')}><LayoutGrid size={18} /> Турниры</button>
        <button disabled={busy} className={screen === 'finance' ? 'selected' : ''} onClick={() => setView('finance')}><Wallet size={18} /> Финансы</button>
        <button disabled={busy} className={screen === 'rating' ? 'selected' : ''} onClick={() => setView('rating')}><Trophy size={18} /> Рейтинг</button>
        <button disabled={busy} className={screen === 'crm' ? 'selected' : ''} onClick={() => setView('crm')}><UsersRound size={18} /> CRM клуба</button>
      </nav>
      <div className="sidebar-bottom">
        {doyleAuth ? (
          <div className="sidebar-conn">
            <div><strong>Doyle · Supabase</strong><small>Режим просмотра</small></div>
            <button className="button compact wide" type="button" onClick={disconnectDoyle}><LogOut size={14} /> Выйти в демо</button>
          </div>
        ) : (
          <div className="sidebar-conn">
            <div><strong>Демо-кабинет</strong><small>Локальные данные</small></div>
            <button className="button compact wide" type="button" onClick={() => setConnectOpen(true)}><Database size={14} /> Подключить Дойл</button>
          </div>
        )}
      </div>
    </aside>}
    <main className="sheet">
      {error && <p className="alert" role="status">Связь прервана. Показано последнее состояние.</p>}
      {screen === 'tournaments' && <>
        <Heading title="Турниры" subtitle={data.club.venue} actions={<>
          <a className="button" href={scheduleHref(data.club.id)} target="_blank" rel="noreferrer">Расписание клуба <ExternalLink size={15} /></a>
          <button className="button" disabled={busy} onClick={() => { setNotice(''); setView('week'); }}><CalendarPlus size={17} /> Создать неделю</button>
          <button className="button primary" disabled={busy} onClick={() => { setNotice(''); setView('create'); }}><Plus size={17} /> Создать турнир</button>
        </>} />
        <section className="panel schedule" aria-label="Список турниров">
          {data.schedule.map(item => <button className="schedule-row" key={item.id} disabled={busy} onClick={() => { office.setId(item.id); setView('live'); }}>
            <span><strong>{item.name}</strong><small>{startLabel(item.startsAt)}</small></span><State tournament={item} /><ChevronRight size={17} />
          </button>)}
        </section>
      </>}
      {screen === 'week' && <TournamentWeek key={data.club.id} data={data} busy={busy} run={run} back={() => setView('tournaments')} />}
      {(screen === 'create' || screen === 'edit') && <TournamentEditor key={screen + data.tournament.id} data={data}
        creating={screen === 'create'} busy={busy} run={run}
        back={() => setView(screen === 'create' || data.tournament.state === 'draft' ? 'tournaments' : 'live')}
        created={() => setView('live')} published={() => setView('live')} />}
      {screen === 'live' && <Live key={data.tournament.id} data={data} busy={busy} run={run} external={external} open={open} exportPayments={office.exportPayments}
        back={() => navigate('tournaments')} edit={() => { setNotice(''); navigate('edit'); }} crm={() => navigate('crm')} />}
      {screen === 'crm' && <Crm key={data.club.id} data={data} run={run} busy={busy} open={open} />}
      {screen === 'rating' && <RatingStudio key={data.club.id} data={data} busy={busy} run={run} />}
      {screen === 'finance' && <ClubFinance key={data.club.id} data={data} openTournament={id => { office.setId(id); navigate('live'); }} />}
      {dealer && !data.config.seating && <Heading title="Рассадка отключена" subtitle={data.tournament.name} />}
      {dealer && data.config.seating && <>
        <Heading title={'Стол ' + pad(session.table!)} subtitle={data.tournament.name + ' · ' + data.club.name} state={<State tournament={data.tournament} />} />
        <div className="dealer-content">
          <div className="panel roster">
            <div className="panel-head"><h2>Игроки стола</h2><span className="count">{data.entries.filter(item => item.status === 'active').length} в игре</span></div>
            {data.entries.length ? data.entries.slice().sort((a, b) => (a.seatNo ?? 99) - (b.seatNo ?? 99)).map(entry =>
              <div className="person-row dealer-row" key={entry.playerId}>
                <Person name={entry.name} nickname={entry.nickname} detail={entry.status === 'out' ? 'Вылетел · Реэнтри ' + entry.reentries : 'Место ' + entry.seatNo + (entry.confirmed ? ' · На месте' : '')} />
                {data.tournament.state === 'live' && <div className="actions">
                  {entry.status === 'active' && !entry.confirmed && <button className="button" disabled={busy} onClick={() => run({ type: 'confirmSeat', playerId: entry.playerId })}>На месте</button>}
                  <button className="button" disabled={busy} onClick={() => open(entry.status === 'out'
                    ? { mode: 'confirm', title: 'Оформить реэнтри?', message: entry.name + ' · ' + money(data.config.reentryFee) + '. Игрок вернётся в очередь на рассадку.', label: 'Оформить реэнтри', action: { type: 'reenter', playerId: entry.playerId } }
                    : bustModal(entry, data))}>
                    {entry.status === 'out' ? 'Реэнтри' : 'Вылет'}
                  </button>
                </div>}
              </div>) : <p className="empty">За столом пока нет игроков</p>}
          </div>
          <div className="panel timer-panel"><div className="timer-title"><Clock3 size={17} /><h2>Таймер турнира</h2></div><Timer data={data} /></div>
        </div>
      </>}
    </main>
    {!dealer && screen !== 'live' && <MobileNav label="Разделы клуба" busy={busy} items={[
      { label: 'Турниры', Icon: LayoutGrid, action: () => navigate('tournaments'), active: screen === 'tournaments' || screen === 'create' || screen === 'week' },
      { label: 'Финансы', Icon: Wallet, action: () => navigate('finance'), active: screen === 'finance' },
      { label: 'Рейтинг', Icon: Trophy, action: () => navigate('rating'), active: screen === 'rating' },
      { label: 'CRM', Icon: UsersRound, action: () => navigate('crm'), active: screen === 'crm' },
    ]} />}
    {modal && <Dialog modal={modal} data={data} run={run} close={() => setModal(undefined)} busy={busy} notice={notice} change={open} />}
    {connectOpen && <DoyleConnectDialog busy={busy} onConnect={connectDoyle} onClose={() => setConnectOpen(false)} />}
    {notice && !modal && <div className="toast" role="status">{notice}<button aria-label="Скрыть сообщение" onClick={() => setNotice('')}><X size={17} /></button></div>}
  </div>;
}

