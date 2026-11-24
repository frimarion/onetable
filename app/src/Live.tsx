import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Activity, ArrowLeft, ArrowLeftRight, ArrowRight, CalendarDays, Clock3, Ellipsis, LayoutGrid, Monitor, Pencil, Plus, Settings2, Trophy, UsersRound, Wallet } from 'lucide-react';
import type { Entry, Snapshot } from '../shared/model';
import { addonOptions } from '../shared/operations';
import type { Run } from './api';
import type { Modal } from './crm';
import { Finance } from './Finance';
import { Players } from './Players';
import { Settings } from './Settings';
import { Waitlist } from './Waitlist';
import { ResultsPanel, TimerControls } from './TournamentControls';
import { EntryList, Heading, Journal, PokerTable, State, initialsOf, pad, startLabel } from './widgets';
import { MobileNav, MobileSection, MobileSections } from './MobileNav';

type SeatTarget = { tableNo: number; seatNo: number; occupant?: Entry };
type SeatDrag = {
  pointerId: number; player: Entry; fromTable: number; fromSeat: number;
  startX: number; startY: number; x: number; y: number; active: boolean;
  target: SeatTarget | null;
};

type Tab = 'tables' | 'players' | 'journal' | 'payments' | 'settings' | 'results';
const phone = '(max-width: 680px)';
const sections = [
  { key: 'tables', label: 'Столы и рассадка', Icon: LayoutGrid },
  { key: 'settings', label: 'Настройки турнира', Icon: Settings2 },
  { key: 'results', label: 'Результаты', Icon: Trophy },
  { key: 'journal', label: 'Журнал', Icon: Activity },
] as const;

function plural(count: number, one: string, few: string, many: string) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function Live({ data, busy, run, external, open, back, edit, crm, exportPayments, finances, nativeDealer }: {
  data: Snapshot; busy: boolean; run: Run; external: (role: 'dealer' | 'display', table?: number) => void;
  open: (modal: Modal) => void; back: () => void; edit: () => void; crm: () => void;
  exportPayments: () => Promise<void>; finances: boolean; nativeDealer: boolean;
}) {
  const seating = data.config.seating;
  const [selectedTab, setTab] = useState<Tab>(() => seating && !window.matchMedia(phone).matches ? 'tables' : 'players');
  const [detailedTables, setDetailedTables] = useState(() => {
    try { return localStorage.getItem('onetable-tables-detailed') === '1'; } catch { return false; }
  });
  const [mobileTimer, setMobileTimer] = useState(false);
  const [more, setMore] = useState(false);
  const closeMore = useCallback(() => setMore(false), []);
  const tab = (!seating && selectedTab === 'tables') || (!finances && selectedTab === 'payments') ? 'players' : selectedTab;
  const [table, setTable] = useState<number | null>(null);
  const [seatDrag, setSeatDrag] = useState<SeatDrag | null>(null);
  const dragRef = useRef<SeatDrag | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef(data.entries);
  entriesRef.current = data.entries;
  const runRef = useRef(run);
  runRef.current = run;
  const suppressClick = useRef(false);
  const live = data.tournament.state === 'live';
  const waiting = data.stats.active - data.stats.seated;
  const capacity = data.tables.reduce((sum, item) => sum + item.capacity, 0);
  const editable = data.tournament.state !== 'finished';
  const addonCounts = { 1: 0, 2: 0, 3: 0 };
  for (const entry of data.entries) {
    if (entry.status !== 'registered' && entry.addon) {
      const tier = entry.addonTier === 2 || entry.addonTier === 3 ? entry.addonTier : 1;
      addonCounts[tier]++;
    }
  }
  const addonTotal = addonCounts[1] + addonCounts[2] + addonCounts[3];
  const showAddons = data.config.addon || addonTotal > 0;
  const multiAddonTiers = addonOptions(data.config).length > 1 || addonCounts[2] > 0 || addonCounts[3] > 0;
  const addonBreakdown = multiAddonTiers && addonTotal > 0
    ? ([1, 2, 3] as const).filter(tier => addonCounts[tier] > 0).map(tier => `×${tier}: ${addonCounts[tier]}`).join(' · ')
    : '';
  const metrics: { label: string; value: number; detail?: string; title?: string }[] = [
    { label: 'Записались', value: data.stats.registered },
    { label: 'В игре', value: data.stats.active },
    ...(seating ? [{ label: 'За столами', value: data.stats.seated }] : []),
    { label: 'Реэнтри', value: data.stats.reentries },
    ...(showAddons ? [{
      label: 'Аддоны',
      value: addonTotal,
      detail: addonBreakdown || undefined,
      title: `Одинарные: ${addonCounts[1]}, двойные: ${addonCounts[2]}, тройные: ${addonCounts[3]}`,
    }] : []),
  ];

  const findSeatTarget = useCallback((clientX: number, clientY: number, fromTable: number, fromSeat: number): SeatTarget | null => {
    let hit: HTMLElement | null = null;
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const seatEl = (el as HTMLElement).closest?.<HTMLElement>('[data-seat-table][data-seat-no]');
      if (seatEl) { hit = seatEl; break; }
    }
    if (!hit && gridRef.current) {
      let bestDist = 28;
      for (const el of gridRef.current.querySelectorAll<HTMLElement>('[data-seat-table][data-seat-no]')) {
        const rect = el.getBoundingClientRect();
        const dist = Math.hypot(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
        if (dist < bestDist) { bestDist = dist; hit = el; }
      }
    }
    if (!hit) return null;
    const tableNo = Number(hit.dataset.seatTable);
    const seatNo = Number(hit.dataset.seatNo);
    if (!tableNo || !seatNo || (tableNo === fromTable && seatNo === fromSeat)) return null;
    const occupant = entriesRef.current.find(item => item.tableNo === tableNo && item.seatNo === seatNo);
    return { tableNo, seatNo, occupant };
  }, []);

  const clearDrag = useCallback(() => {
    dragRef.current = null;
    setSeatDrag(null);
  }, []);

  useEffect(() => {
    if (!live || busy || tab !== 'tables') clearDrag();
  }, [live, busy, tab, clearDrag]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const current = dragRef.current;
      if (!current?.active) { frame = 0; return; }
      const edge = 64;
      const speed = current.y < edge ? current.y - edge : Math.max(0, current.y - window.innerHeight + edge);
      if (speed) {
        window.scrollBy(0, Math.max(-16, Math.min(16, speed / 3)));
        const target = findSeatTarget(current.x, current.y, current.fromTable, current.fromSeat);
        current.target = target;
        setSeatDrag({ ...current });
      }
      frame = requestAnimationFrame(tick);
    };
    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.x = event.clientX;
      current.y = event.clientY;
      if (!current.active) {
        if (Math.hypot(current.x - current.startX, current.y - current.startY) < 6) return;
        current.active = true;
        if (!frame) frame = requestAnimationFrame(tick);
      }
      event.preventDefault();
      current.target = findSeatTarget(current.x, current.y, current.fromTable, current.fromSeat);
      setSeatDrag({ ...current });
    };
    const onUp = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      cancelAnimationFrame(frame);
      frame = 0;
      const wasActive = current.active;
      const target = wasActive ? findSeatTarget(event.clientX, event.clientY, current.fromTable, current.fromSeat) : null;
      const player = current.player;
      clearDrag();
      if (!wasActive) return;
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      if (!target) return;
      if (target.occupant && target.occupant.playerId !== player.playerId) {
        void runRef.current({ type: 'swapSeats', playerId: player.playerId, withPlayerId: target.occupant.playerId });
      } else if (!target.occupant) {
        void runRef.current({ type: 'assign', playerId: player.playerId, tableNo: target.tableNo, seatNo: target.seatNo });
      }
    };
    const onCancel = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      cancelAnimationFrame(frame);
      frame = 0;
      clearDrag();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragRef.current) return;
      cancelAnimationFrame(frame);
      frame = 0;
      clearDrag();
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [clearDrag, findSeatTarget]);

  const startSeatDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, tableNo: number, seatNo: number, occupant: Entry) => {
    if (!live || busy || event.button !== 0 || !event.isPrimary || dragRef.current) return;
    dragRef.current = {
      pointerId: event.pointerId, player: occupant, fromTable: tableNo, fromSeat: seatNo,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      active: false, target: null,
    };
  }, [live, busy]);
  function selectTab(next: Tab) {
    setMobileTimer(false);
    setTab(next);
    closeMore();
    if (window.matchMedia(phone).matches) window.scrollTo(0, 0);
  }
  function showTimer() {
    setMobileTimer(true);
    window.scrollTo(0, 0);
  }
  return <>
    <button className="back live-back" onClick={back}><ArrowLeft size={15} /> Все турниры</button>
    <div className={'live-heading' + (mobileTimer || tab !== 'players' && tab !== 'tables' ? ' live-heading-simple' : '')}>
    <Heading title={data.tournament.name} subtitle={data.tournament.startsAt ? startLabel(data.tournament.startsAt) + ' · ' + data.club.venue : data.club.venue} state={<State tournament={data.tournament} />}
      actions={<>
        {editable && <button className="button live-desktop-action" disabled={busy} onClick={edit}><Pencil size={16} /> Редактировать</button>}
        <button className="button live-desktop-action" onClick={() => external('display')}><Monitor size={17} /> ТВ-дисплей</button>
        {editable && <button className="button primary" disabled={busy} onClick={() => open({ mode: 'register' })}><Plus size={18} /> Записать игрока</button>}
      </>} />
    </div>
    <div className="tabs live-tabs" aria-label="Управление турниром">
      {([['tables', 'Столы и рассадка'], ['players', 'Игроки'], ['payments', 'Оплаты'], ['settings', 'Настройки'], ['results', 'Результаты'], ['journal', 'Журнал']] as const).filter(([key]) => (seating || key !== 'tables') && (finances || key !== 'payments')).map(([key, label]) =>
        <button key={key} aria-pressed={tab === key} onClick={() => selectTab(key)}>{label}{key === 'players' && <span>{data.stats.registered}</span>}</button>)}
    </div>
    {tab !== 'payments' && <button className="button narrow-timer" onClick={() => {
      const target = document.getElementById('tournament-controls');
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'start' });
    }}><Clock3 size={16} /> К таймеру</button>}
    <div className={'workspace live-workspace' + (mobileTimer ? ' mobile-timer-view' : '')}>
      <div className="work-main">
        {tab !== 'payments' && <div className="metrics" style={{ '--metric-cols': metrics.length } as CSSProperties} aria-label="Показатели турнира">
          {metrics.map(item =>
            <div key={item.label} title={item.title}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              {item.detail && <small className="metric-breakdown">{item.detail}</small>}
            </div>)}
        </div>}
        {(tab === 'players' || tab === 'tables') && <Waitlist data={data} run={run} busy={busy} open={open} />}
        {tab === 'tables' && <section aria-labelledby="tables-heading">
          <div className="section-head"><div><h2 id="tables-heading">Рассадка</h2><p>{data.tables.length} {plural(data.tables.length, 'стол', 'стола', 'столов')} · {capacity} {plural(capacity, 'место', 'места', 'мест')}</p></div>
            {live && <button className="button" disabled={busy || !waiting || data.stats.seated >= capacity} onClick={() => run({ type: 'autoSeat' })}><LayoutGrid size={16} /> Авторассадка</button>}
          </div>
          <div className="seating-toolbar actions">
            {data.tournament.state !== 'finished' && <button className="button compact" onClick={() => open({ mode: 'tables' })}><Settings2 size={15} /> Столы и места</button>}
            <button type="button" className="button compact cash-choice" aria-pressed={detailedTables} onClick={() => {
              const next = !detailedTables;
              setDetailedTables(next);
              try { localStorage.setItem('onetable-tables-detailed', next ? '1' : '0'); } catch { /* ignore */ }
            }}><UsersRound size={15} /> Имена и аватарки</button>
            {live && <>
              <button className="button compact" disabled={busy || !data.stats.active || data.stats.active > capacity} onClick={() => open({ mode: 'confirm', title: 'Провести жеребьёвку?', message: 'Все пришедшие игроки получат случайное место. Текущие назначения будут заменены.', label: 'Рассадить заново', action: { type: 'shuffleSeating' } })}>Жеребьёвка</button>
              <button className="button compact" disabled={busy || !data.stats.active || data.stats.active > capacity} onClick={() => open({ mode: 'confirm', title: 'Сбалансировать столы?', message: 'Игроки с перегруженных столов будут пересажены. Остальные сохранят свои места.', label: 'Сбалансировать', action: { type: 'balanceSeating' } })}>Балансировка</button>
              <button className="button compact" disabled={busy || !data.stats.seated} onClick={() => open({ mode: 'confirm', title: 'Очистить рассадку?', message: 'Все пришедшие игроки вернутся в очередь. Записи и оплаты сохранятся.', label: 'Очистить места', action: { type: 'clearSeating' } })}>Очистить</button>
            </>}
            <button className="button compact" disabled={busy} onClick={() => run({ type: 'displayMode', mode: data.display.mode === 'seating' ? 'clock' : 'seating' })}><Monitor size={15} />{data.display.mode === 'seating' ? 'Скрыть с ТВ' : 'Показать на ТВ'}</button>
          </div>
          <div ref={gridRef} className={'tables-grid' + (detailedTables ? ' detailed' : '') + (seatDrag?.active ? ' is-dragging' : '')}>
            {data.tables.map(item => <PokerTable key={item.number} number={item.number} capacity={item.capacity}
              entries={data.entries.filter(entry => entry.tableNo === item.number)} selected={table === item.number}
              detailed={detailedTables} interactive={live && !busy}
              draggingPlayerId={seatDrag?.active ? seatDrag.player.playerId : undefined}
              dropTarget={seatDrag?.active && seatDrag.target ? { tableNo: seatDrag.target.tableNo, seatNo: seatDrag.target.seatNo, swap: Boolean(seatDrag.target.occupant) } : null}
              onSelect={() => setTable(table === item.number ? null : item.number)}
              onSeatPointerDown={live && !busy ? (event, seatNo, occupant) => startSeatDrag(event, item.number, seatNo, occupant) : undefined}
              onSelectSeat={(seatNo, occupant) => {
                if (suppressClick.current) { suppressClick.current = false; return; }
                if (occupant) open({ mode: 'entry', entry: occupant });
                else if (live) open({ mode: 'seatBox', tableNo: item.number, seatNo });
              }} />)}
          </div>
          {seatDrag?.active && <div className={'seat-drag-ghost' + (seatDrag.target?.occupant ? ' swap' : seatDrag.target ? ' move' : '')}
            style={{ transform: `translate3d(${seatDrag.x}px, ${seatDrag.y}px, 0)` }} aria-hidden="true">
            <span className="seat-avatar">{initialsOf(seatDrag.player.name, seatDrag.player.nickname)}</span>
            <span className="seat-drag-meta">
              <strong>{seatDrag.player.nickname || seatDrag.player.name}</strong>
              {seatDrag.target && <small>
                {seatDrag.target.occupant
                  ? <><ArrowLeftRight size={11} /> Обмен с {seatDrag.target.occupant.nickname || seatDrag.target.occupant.name}</>
                  : <>Стол {pad(seatDrag.target.tableNo)} · Бокс {seatDrag.target.seatNo}</>}
              </small>}
            </span>
          </div>}
          {table !== null && data.tables.some(item => item.number === table) && <section className="panel roster">
            <div className="panel-head"><h3>Стол {pad(table)}</h3>{!nativeDealer && <button className="button compact" onClick={() => external('dealer', table)}>Планшет дилера <ArrowRight size={15} /></button>}</div>
            <EntryList entries={data.entries.filter(entry => entry.tableNo === table).sort((a, b) => a.seatNo! - b.seatNo!)}
              empty="Стол свободен" onSelect={entry => open({ mode: 'entry', entry })} />
          </section>}
          {live && <section className="panel roster">
            <div className="panel-head"><h3>Ожидают место</h3><span className="count">{waiting}</span></div>
            <EntryList entries={data.entries.filter(entry => entry.status === 'active' && entry.tableNo === null)} empty="Все пришедшие игроки рассажены"
              onSelect={entry => open({ mode: 'assign', entry })} seatAction />
          </section>}
        </section>}
        {tab === 'players' && <Players data={data} busy={busy} run={run} open={open} />}
        {finances && tab === 'payments' && <Finance data={data} open={open} run={run} busy={busy} exportPayments={exportPayments} />}
        {tab === 'settings' && <Settings data={data} busy={busy} run={run} />}
        {tab === 'results' && <ResultsPanel data={data} busy={busy} run={run} open={open} />}
        {tab === 'journal' && <section><div className="section-head"><h2>Журнал турнира</h2></div><div className="panel"><Journal data={data} /></div></section>}
      </div>
      <aside className="rail" aria-label="Таймер и события">
        <TimerControls data={data} busy={busy} run={run} open={open} />
        {tab !== 'journal' && <section className="panel events">
          <div className="panel-head"><h2><Activity size={17} /> Последние действия</h2></div>
          <Journal data={data} limit={3} />
          <button className="back event-link" onClick={() => selectTab('journal')}>Открыть журнал <ArrowRight size={15} /></button>
        </section>}
      </aside>
    </div>
    <MobileNav label="Управление турниром" busy={busy} items={[
      { label: 'Турниры', Icon: CalendarDays, action: back },
      { label: 'Игроки', Icon: UsersRound, action: () => selectTab('players'), active: !mobileTimer && tab === 'players' },
      { label: 'Таймер', Icon: Clock3, action: showTimer, active: mobileTimer },
      ...(finances ? [{ label: 'Оплаты', Icon: Wallet, action: () => selectTab('payments'), active: !mobileTimer && tab === 'payments' }] : []),
      { label: 'Ещё', Icon: Ellipsis, action: () => setMore(true), active: !mobileTimer && tab !== 'players' && tab !== 'payments', expanded: more },
    ]} />
    {more && <MobileSections close={closeMore}>
      {sections.filter(item => item.key !== 'tables' || seating).map(({ key, label, Icon }) =>
        <MobileSection key={key} label={label} Icon={Icon} active={!mobileTimer && tab === key} action={() => selectTab(key)} />)}
      {editable && <MobileSection label="Редактировать турнир" Icon={Pencil} action={() => { closeMore(); edit(); }} />}
      <MobileSection label="Открыть ТВ-дисплей" Icon={Monitor} action={() => { closeMore(); external('display'); }} />
      <MobileSection label="CRM клуба" Icon={UsersRound} action={() => { closeMore(); crm(); }} />
    </MobileSections>}
  </>;
}

