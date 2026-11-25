import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarPlus, ChevronRight, Clock3, ExternalLink, Eye, EyeOff, LayoutGrid, LogOut, Plus, Trophy, UserRoundCog, UsersRound, Wallet, X } from 'lucide-react';
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
import { ClubAccounts } from './ClubAccounts';
import { StaffTournament } from './StaffTournament';
import { scheduleHref } from './PublicSchedule';

type View = 'live' | 'crm' | 'rating' | 'finance' | 'tournaments' | 'create' | 'edit' | 'week' | 'accounts';

function ProdAuthScreen({ busy, onLogin, onAcceptInvite }: {
  busy: boolean;
  onLogin: (email: string, password: string) => Promise<void>;
  onAcceptInvite: (token: string, name: string, password: string) => Promise<void>;
}) {
  const inviteToken = new URLSearchParams(location.search).get('invite') || '';
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [existing, setExisting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErr('');
    if (inviteToken && !existing && password !== confirmPassword) {
      setErr('Пароли не совпадают');
      return;
    }
    try {
      if (inviteToken) await onAcceptInvite(inviteToken, name, password);
      else await onLogin(email, password);
    } catch (reason) {
      setErr(reason instanceof Error ? reason.message : 'Ошибка входа');
    }
  }

  return <main className="standalone auth-screen">
    <div className="panel auth-card">
      <Brand />
      <h1>{inviteToken ? 'Активация доступа' : 'Вход в кабинет'}</h1>
      {inviteToken && <p className="muted">Добавьте доступ к существующей учётной записи или создайте новую.</p>}
      {err && <p className="alert" role="alert">{err}</p>}
      <form className="admin-form" onSubmit={submit}>
        {inviteToken && <label className="crm-checkbox"><input type="checkbox" checked={existing}
          disabled={busy} onChange={event => setExisting(event.target.checked)} />У меня уже есть учётная запись OneTable</label>}
        {inviteToken ? (!existing &&
          <label>Ваше имя
            <input type="text" required autoFocus value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Александр" />
          </label>
        ) : (
          <label>Email
            <input type="email" required autoFocus autoComplete="username" value={email} disabled={busy} onChange={e => setEmail(e.target.value)} placeholder="you@club.ru" />
          </label>
        )}
        <label>{inviteToken && !existing ? 'Новый пароль' : 'Пароль'}
          <span className="password-field">
            <input type={showPassword ? 'text' : 'password'} required minLength={inviteToken && !existing ? 10 : 1}
              autoComplete={inviteToken && !existing ? 'new-password' : 'current-password'}
              value={password} disabled={busy} onChange={e => setPassword(e.target.value)} />
            <button type="button" className="password-toggle" aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              title={showPassword ? 'Скрыть пароль' : 'Показать пароль'} onClick={() => setShowPassword(v => !v)}>
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>
        {inviteToken && !existing && <label>Повторить пароль
          <span className="password-field">
            <input type={showPassword ? 'text' : 'password'} required minLength={10} autoComplete="new-password"
              value={confirmPassword} disabled={busy} onChange={e => setConfirmPassword(e.target.value)} />
          </span>
        </label>}
        <button className="button primary wide" type="submit" disabled={busy}>
          {busy ? 'Подождите…' : inviteToken ? 'Активировать доступ' : 'Войти'}
        </button>
      </form>
    </div>
  </main>;
}

export function App() {
  const office = useOffice();
  const {
    session, data, busy, error, notice, setNotice, sessions, run, select, external,
    prodMode, prodAuth, authChecked, prodLogin, prodAcceptInvite, prodLogout, waitingForTournament,
  } = office;
  const [view, setView] = useState<View>();
  const [modal, setModal] = useState<Modal>();
  const open = (next: Modal) => { setNotice(''); setModal(next); };
  const admin = sessions.find(item => item.role === 'admin' && item.club.id === session?.club.id);
  const openDoyle = prodAuth?.doyleWorkspace && !new URLSearchParams(location.search).has('workspace');
  useEffect(() => {
    if (openDoyle) location.replace('/doyle/');
  }, [openDoyle]);

  if (prodMode && authChecked && (!prodAuth || new URLSearchParams(location.search).has('invite'))) {
    return <ProdAuthScreen busy={busy} onLogin={prodLogin} onAcceptInvite={prodAcceptInvite} />;
  }

  if (openDoyle) return <main className="standalone"><Brand /><h1>Открываем Doyle Poker Club…</h1></main>;

  const accounts = prodAuth?.role === 'owner';
  const finances = !prodMode || accounts;
  const staffDesk = prodMode && (session?.role === 'floor' || session?.role === 'dealer');
  const clubSelector = session && sessions.length > 1 && <div className="club-switch">
    <label htmlFor="club">Рабочее пространство</label>
    <select id="club" value={session.club.id} disabled={busy} onChange={event => {
      const next = sessions.find(item => item.club.id === event.target.value && (prodMode || item.role === 'admin'));
      if (next) { setView('tournaments'); setModal(undefined); void select(next); }
    }}>
      {sessions.filter(item => prodMode || item.role === 'admin').map(item =>
        <option key={item.club.id} value={item.club.id}>{item.club.name}</option>)}
    </select>
  </div>;
  if (session && (staffDesk || waitingForTournament)) {
    return <div className={staffDesk ? 'shell dealer-shell' : 'shell admin-shell'}>
      <header className="topbar"><Brand /><div className="top-right"><ThemeSwitch />
        {prodAuth?.doyleWorkspace && <a className="button compact" href="/doyle/">Doyle Poker Club</a>}
        <button className="button compact" onClick={() => void prodLogout()}><LogOut size={16} /> Выйти</button>
      </div></header>
      {!staffDesk && <aside className="sidebar">
        {clubSelector}
        <nav aria-label="Разделы клуба">
          <button className={view !== 'accounts' ? 'selected' : ''} onClick={() => setView('tournaments')}><LayoutGrid size={18} /> Турниры</button>
          {accounts && <button className={view === 'accounts' ? 'selected' : ''} onClick={() => setView('accounts')}><UserRoundCog size={18} /> Учётные записи</button>}
        </nav>
      </aside>}
      <main className="sheet account-sheet">
        {staffDesk && clubSelector}
        {staffDesk ? (data ? <StaffTournament key={data.club.id} data={data} tableNo={session.table} busy={busy}
          run={run} setId={id => { office.setId(id); setModal(undefined); }} open={open} />
          : <Heading title={error || (waitingForTournament ? 'Нет доступных турниров' : 'Загружаем турнир…')} subtitle={session.club.name} />)
          : view === 'accounts' && accounts ? <ClubAccounts key={session.club.id} club={session.club} />
            : view === 'create' ? <TournamentEditor data={{ club: session.club, presets: [], ratingPresets: [] }} creating busy={busy} run={run}
              back={() => setView('tournaments')} created={() => setView('live')} published={() => setView('live')} />
              : <Heading title="Турниры" subtitle={session.club.name} actions={
                <button className="button primary" disabled={busy} onClick={() => setView('create')}><Plus size={17} /> Создать турнир</button>
              } />}
      </main>
      {!staffDesk && <MobileNav label="Разделы клуба" busy={busy} items={[
        { label: 'Турниры', Icon: LayoutGrid, action: () => setView('tournaments'), active: view !== 'accounts' },
        ...(accounts ? [{ label: 'Учётные записи', Icon: UserRoundCog, action: () => setView('accounts'), active: view === 'accounts' }] : []),
      ]} />}
      {data && modal && <Dialog modal={modal} data={data} finances={finances} run={run} close={() => setModal(undefined)} busy={busy} notice={notice} change={open} />}
      {notice && !modal && <div className="toast" role="status">{notice}<button aria-label="Скрыть сообщение" onClick={() => setNotice('')}><X size={17} /></button></div>}
    </div>;
  }

  if (!session || !data) {
    return <main className="standalone"><Brand /><h1>{error ? 'Не удалось открыть кабинет' : 'Загружаем кабинет'}</h1>
      {error && <><p>{error}</p><div className="actions">
        {prodMode && prodAuth && <button className="button" onClick={() => void prodLogout()}>Выйти</button>}
        <button className="button" onClick={() => { if (sessions.length) location.assign(location.pathname); else office.load(); }}>Повторить</button>
      </div></>}
    </main>;
  }
  if (session.role === 'display') return <Display key={data.tournament.id} data={data} error={error} />;

  const dealer = session.role === 'dealer';
  const currentView = view ?? 'live';
  const allowedView = (currentView === 'accounts' && !accounts) || (currentView === 'finance' && !finances) ? 'tournaments' : currentView;
  const screen = dealer ? 'dealer' : allowedView === 'live' && data.tournament.state === 'draft' ? 'edit' : allowedView;
  const breadcrumb = screen === 'accounts' ? 'Учётные записи' : screen === 'crm' ? 'CRM' : screen === 'rating' ? 'Рейтинг' : screen === 'finance' ? 'Финансы' : dealer ? 'Планшет дилера' : 'Турниры';
  function navigate(next: View) {
    setView(next);
    window.scrollTo(0, 0);
  }
  return <div className={dealer ? 'shell dealer-shell' : 'shell admin-shell'}>
    <header className="topbar">
      <Brand />
      <div className="top-context"><span>Кабинет клуба</span><ChevronRight size={14} /><span>{breadcrumb}</span></div>
      <div className="top-right">
        {prodAuth?.doyleWorkspace && <a className="button compact" href="/doyle/">Doyle Poker Club</a>}
        <ThemeSwitch />
        {dealer ? <button className="button" onClick={() => admin && select(admin)}><ArrowLeft size={16} /> Кабинет</button> :
          <span className="profile"><span className="avatar">{(prodAuth?.user.name?.[0] || prodAuth?.user.email?.[0] || 'А').toUpperCase()}</span><span>{prodAuth ? (prodAuth.user.name || prodAuth.user.email) : 'Администратор'}</span></span>}
      </div>
    </header>
    {!dealer && <aside className="sidebar">
      {clubSelector}
      <nav aria-label="Разделы клуба">
        <button disabled={busy} className={screen !== 'crm' && screen !== 'rating' && screen !== 'finance' && screen !== 'accounts' ? 'selected' : ''} onClick={() => setView('tournaments')}><LayoutGrid size={18} /> Турниры</button>
        {finances && <button disabled={busy} className={screen === 'finance' ? 'selected' : ''} onClick={() => setView('finance')}><Wallet size={18} /> Финансы</button>}
        <button disabled={busy} className={screen === 'rating' ? 'selected' : ''} onClick={() => setView('rating')}><Trophy size={18} /> Рейтинг</button>
        <button disabled={busy} className={screen === 'crm' ? 'selected' : ''} onClick={() => setView('crm')}><UsersRound size={18} /> CRM клуба</button>
        {accounts && <button disabled={busy} className={screen === 'accounts' ? 'selected' : ''} onClick={() => navigate('accounts')}><UserRoundCog size={18} /> Учётные записи</button>}
      </nav>
      <div className="sidebar-bottom">
        {prodMode && prodAuth ? (
          <div className="sidebar-conn">
            <div><strong>{session.club.name}</strong><small>{prodAuth.user.email}</small></div>
            <button className="button compact wide" type="button" onClick={() => void prodLogout()}><LogOut size={14} /> Выйти</button>
          </div>
        ) : (
          <div className="sidebar-conn">
            <div><strong>Демо-кабинет</strong><small>Локальные данные</small></div>
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
      {screen === 'live' && <Live key={data.tournament.id} data={data} busy={busy} run={run} external={external} open={open} exportPayments={office.exportPayments} finances={finances} nativeDealer={prodMode}
        back={() => navigate('tournaments')} edit={() => { setNotice(''); navigate('edit'); }} crm={() => navigate('crm')} />}
      {screen === 'accounts' && <ClubAccounts key={session.club.id} club={session.club} />}
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
      ...(finances ? [{ label: 'Финансы', Icon: Wallet, action: () => navigate('finance'), active: screen === 'finance' }] : []),
      { label: 'Рейтинг', Icon: Trophy, action: () => navigate('rating'), active: screen === 'rating' },
      { label: 'CRM', Icon: UsersRound, action: () => navigate('crm'), active: screen === 'crm' },
      ...(accounts ? [{ label: 'Учётные записи', Icon: UserRoundCog, action: () => navigate('accounts'), active: screen === 'accounts' }] : []),
    ]} />}
    {modal && <Dialog modal={modal} data={data} finances={finances} run={run} close={() => setModal(undefined)} busy={busy} notice={notice} change={open} />}
    {notice && !modal && <div className="toast" role="status">{notice}<button aria-label="Скрыть сообщение" onClick={() => setNotice('')}><X size={17} /></button></div>}
  </div>;
}

