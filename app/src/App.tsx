import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarPlus, ChevronLeft, ChevronRight, Clock3, ExternalLink, Eye, EyeOff, LayoutGrid, Plus, Trophy, UserRoundCog, UsersRound, Wallet, X } from 'lucide-react';
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
import { ProfileMenu } from './ProfileMenu';
import { usePreferences } from './preferences';
import { ClubAccounts } from './ClubAccounts';
import { StaffTournament } from './StaffTournament';
import { scheduleHref } from './PublicSchedule';

type View = 'live' | 'crm' | 'rating' | 'finance' | 'tournaments' | 'create' | 'edit' | 'week' | 'accounts';

function buildPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | 'ellipsis')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('ellipsis');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push('ellipsis');
  pages.push(total);
  return pages;
}

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
    isDoyleLive,
    prodMode, prodAuth, authChecked, prodLogin, prodAcceptInvite, prodLogout, updateProfileName, waitingForTournament,
  } = office;
  const { prefs } = usePreferences();
  const [view, setView] = useState<View>();
  const [modal, setModal] = useState<Modal>();
  const [tournamentsPage, setTournamentsPage] = useState(1);

  useEffect(() => {
    setTournamentsPage(1);
  }, [session?.club.id, isDoyleLive, prefs.tournamentsPerPage]);

  const profileControl = (
    <ProfileMenu
      prodMode={prodMode}
      prodAuth={prodAuth}
      onLogout={prodMode && prodAuth ? () => { void prodLogout(); } : undefined}
      onSaveName={async nextName => { await updateProfileName(nextName); }}
    />
  );
  const open = (next: Modal) => { setNotice(''); setModal(next); };
  const admin = sessions.find(item => item.role === 'admin' && item.club.id === session?.club.id);
  if (prodMode && authChecked && ((!prodAuth && !error) || new URLSearchParams(location.search).has('invite'))) {
    return <ProdAuthScreen busy={busy} onLogin={prodLogin} onAcceptInvite={prodAcceptInvite} />;
  }

  const accounts = prodAuth?.role === 'owner';
  const finances = !prodMode || accounts;
  const staffDesk = prodMode && (session?.role === 'floor' || session?.role === 'dealer');
  const clubSelector = session && sessions.length > 1 && <div className="club-switch">
    <label htmlFor="club">Рабочее пространство</label>
    <select id="club" aria-label="Рабочее пространство" value={session.club.id} disabled={busy} onChange={event => {
      const next = sessions.find(item => item.club.id === event.target.value && (prodMode || item.role === 'admin'));
      if (next) { setView('tournaments'); setModal(undefined); void select(next); }
    }}>
      {sessions.filter(item => prodMode || item.role === 'admin').map(item =>
        <option key={item.club.id} value={item.club.id}>{item.club.name}</option>)}
    </select>
  </div>;
  if (session && (staffDesk || waitingForTournament || prodAuth?.doyleUnavailable)) {
    return <div className={staffDesk ? 'shell dealer-shell' : 'shell admin-shell'}>
      <header className="topbar"><Brand /><div className="top-right">
        {profileControl}
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
        {prodAuth?.doyleUnavailable && view !== 'accounts' ? <>
          <Heading title="Турниры" subtitle={session.club.name} />
          <p className="alert" role="status">Для вашей учётной записи доступ к турнирам Doyle ещё не настроен.</p>
        </> : staffDesk ? (data ? <StaffTournament key={data.club.id} data={data} tableNo={session.table} busy={busy}
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
    return <main className="standalone"><Brand /><h1>{error ? 'Не удалось открыть кабинет' : isDoyleLive ? 'Загружаем данные Дойла…' : 'Загружаем кабинет'}</h1>
      {error && <><p>{error}</p>{clubSelector}<div className="actions">
        {prodMode && !prodAuth && <a className="button" href="/">Открыть основной клуб</a>}
        {prodMode && prodAuth && <button className="button" onClick={() => void prodLogout()}>Выйти</button>}
        <button className="button" onClick={() => location.reload()}>Повторить</button>
      </div></>}
    </main>;
  }
  if (session.role === 'display') return <Display key={data.tournament.id} data={data} error={error} />;

  const dealer = session.role === 'dealer';
  const currentView = view ?? prefs.startView;
  const allowedView = (currentView === 'accounts' && !accounts) || (currentView === 'finance' && !finances) ? 'tournaments' : currentView;
  const screen = dealer ? 'dealer' : allowedView === 'live' && data.tournament.state === 'draft' ? 'edit' : allowedView;
  const breadcrumb = screen === 'accounts' ? 'Учётные записи' : screen === 'crm' ? 'CRM' : screen === 'rating' ? 'Рейтинг' : screen === 'finance' ? 'Финансы' : dealer ? 'Планшет дилера' : 'Турниры';
  function navigate(next: View) {
    setView(next);
    window.scrollTo(0, 0);
  }
  const perPage = prefs.tournamentsPerPage;
  const totalTournaments = data.schedule.length;
  const totalPages = Math.max(1, Math.ceil(totalTournaments / perPage));
  const safePage = Math.min(tournamentsPage, totalPages);
  const pageStart = (safePage - 1) * perPage;
  const visibleTournaments = data.schedule.slice(pageStart, pageStart + perPage);
  const pageEnd = Math.min(totalTournaments, pageStart + visibleTournaments.length);
  function goToPage(nextPage: number) {
    setTournamentsPage(Math.min(Math.max(1, nextPage), totalPages));
    window.scrollTo({ top: 0, behavior: prefs.reducedMotion ? 'auto' : 'smooth' });
  }
  return <div className={dealer ? 'shell dealer-shell' : 'shell admin-shell'}>
    <header className="topbar">
      <Brand />
      <div className="top-context"><span>{session.club.name}</span><ChevronRight size={14} /><span>{breadcrumb}</span></div>
      <div className="top-right">
        {dealer ? <button className="button" onClick={() => admin && select(admin)}><ArrowLeft size={16} /> Кабинет</button> : profileControl}
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
            <div><strong>{session.club.name}</strong><small>{session.club.venue}</small></div>
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
        <Heading title="Турниры" subtitle={session.club.name} actions={!isDoyleLive ? <>
          <a className="button" href={scheduleHref(data.club.id)} target="_blank" rel="noreferrer">Расписание клуба <ExternalLink size={15} /></a>
          <button className="button" disabled={busy} onClick={() => { setNotice(''); setView('week'); }}><CalendarPlus size={17} /> Создать неделю</button>
          <button className="button primary" disabled={busy} onClick={() => { setNotice(''); setView('create'); }}><Plus size={17} /> Создать турнир</button>
        </> : undefined} />
        <section className="panel schedule" aria-label="Список турниров">
          {visibleTournaments.length ? visibleTournaments.map(item => <button className="schedule-row" key={item.id} disabled={busy} onClick={() => { office.setId(item.id); setView('live'); }}>
            <span><strong>{item.name}</strong><small>{startLabel(item.startsAt)}</small></span><State tournament={item} /><ChevronRight size={17} />
          </button>) : <p className="empty">Турниров пока нет</p>}
        </section>
        {totalPages > 1 && (
          <div className="pagination" role="navigation" aria-label="Страницы списка турниров">
            <span className="pagination-info">Показано {pageStart + 1}–{pageEnd} из {totalTournaments}</span>
            <div className="pagination-controls">
              <button
                type="button"
                className="pagination-nav"
                disabled={safePage <= 1}
                aria-label="Предыдущая страница"
                onClick={() => goToPage(safePage - 1)}
              >
                <ChevronLeft size={15} /> Назад
              </button>
              <div className="pagination-pages">
                {buildPageNumbers(safePage, totalPages).map((entry, idx) =>
                  entry === 'ellipsis' ? (
                    <span key={'e' + idx} className="pagination-ellipsis" aria-hidden="true">…</span>
                  ) : (
                    <button
                      key={entry}
                      type="button"
                      className={'pagination-page' + (entry === safePage ? ' active' : '')}
                      aria-current={entry === safePage ? 'page' : undefined}
                      onClick={() => goToPage(entry)}
                    >
                      {entry}
                    </button>
                  ),
                )}
              </div>
              <button
                type="button"
                className="pagination-nav"
                disabled={safePage >= totalPages}
                aria-label="Следующая страница"
                onClick={() => goToPage(safePage + 1)}
              >
                Вперёд <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
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

