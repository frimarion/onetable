import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight, ArrowUpRight, Banknote, Calendar, ChevronRight,
  CreditCard, Smartphone, TrendingUp, Wallet,
} from 'lucide-react';
import type { Payment, Snapshot, Tournament } from '../shared/model';
import { amountDue, isCashReceiptFor } from '../shared/payments';
import { Heading, State, format, money } from './widgets';

type FinancePeriod = 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom';
type ChartMode = 'per_tournament' | 'cumulative';

type TournamentFinanceRow = {
  tournament: Tournament;
  dateMs: number;
  guests: number;
  charged: number;
  received: number;
  card: number;
  cash: number;
  transfer: number;
  other: number;
  due: number;
  cumulative: number;
  deltaPct: number | null;
};

const DAY_MS = 86_400_000;

const periodOptions: { id: FinancePeriod; label: string }[] = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'quarter', label: 'Квартал' },
  { id: 'year', label: 'Год' },
  { id: 'all', label: 'Всё время' },
  { id: 'custom', label: 'Период' },
];

function dateInputValue(ms: number) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shortDate(ms: number) {
  return new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', timeZone: 'Europe/Moscow' });
}

function fullDate(ms: number) {
  return new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Moscow' });
}

function compactRub(value: number) {
  if (value === 0) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.0', '')} млн`;
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)} тыс.`;
  return format.format(value);
}

function startOfDayMs(iso: string) {
  const parsed = Date.parse(`${iso}T00:00:00+03:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function endOfDayMs(iso: string) {
  const parsed = Date.parse(`${iso}T23:59:59.999+03:00`);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function resolveBounds(period: FinancePeriod, now: number, customFrom: string, customTo: string, earliestMs: number) {
  if (period === 'all') return { start: earliestMs, end: now, duration: null as number | null };
  if (period === 'custom') {
    const start = startOfDayMs(customFrom) || (now - 29 * DAY_MS);
    const end = Math.max(start, endOfDayMs(customTo) || now);
    return { start, end, duration: end - start };
  }
  const days = period === 'week' ? 7 : period === 'month' ? 30 : period === 'quarter' ? 90 : 365;
  const start = now - (days - 1) * DAY_MS;
  return { start, end: now, duration: days * DAY_MS };
}

function smoothPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function buildRows(data: Snapshot): TournamentFinanceRow[] {
  const byTournament = new Map<string, Payment[]>();
  for (const item of data.payments) {
    const list = byTournament.get(item.tournamentId);
    if (list) list.push(item);
    else byTournament.set(item.tournamentId, [item]);
  }
  const visitsByTournament = new Map<string, Set<string>>();
  for (const visit of data.visits) {
    const set = visitsByTournament.get(visit.tournamentId) ?? new Set<string>();
    set.add(visit.playerId);
    visitsByTournament.set(visit.tournamentId, set);
  }

  const rows: TournamentFinanceRow[] = [];
  for (const tournament of data.schedule) {
    const ledger = byTournament.get(tournament.id) ?? [];
    const receipts = data.payments.filter(item => isCashReceiptFor(item, tournament.id));
    const hasActivity = tournament.state === 'finished' || tournament.state === 'live' || ledger.length > 0 || receipts.length > 0;
    if (!hasActivity) continue;

    const parsedStart = tournament.startsAt ? Date.parse(tournament.startsAt) : NaN;
    const fallbackTime = receipts[0]?.time ?? ledger[0]?.time ?? data.serverTime;
    const dateMs = Number.isFinite(parsedStart) ? parsedStart : fallbackTime;

    const charged = ledger
      .filter(item => item.kind !== 'payment' && !item.waived)
      .reduce((sum, item) => sum + item.amount, 0);
    const card = receipts.filter(item => item.method === 'card').reduce((sum, item) => sum + item.amount, 0);
    const cash = receipts.filter(item => item.method === 'cash').reduce((sum, item) => sum + item.amount, 0);
    const transfer = receipts.filter(item => item.method === 'transfer').reduce((sum, item) => sum + item.amount, 0);
    const other = receipts.filter(item => !item.method).reduce((sum, item) => sum + item.amount, 0);
    const received = card + cash + transfer + other;
    const due = Math.max(0, amountDue(ledger));
    const guests = visitsByTournament.get(tournament.id)?.size ?? 0;

    rows.push({
      tournament, dateMs, guests, charged, received, card, cash, transfer, other, due,
      cumulative: 0, deltaPct: null,
    });
  }

  rows.sort((a, b) => a.dateMs - b.dateMs || a.tournament.id.localeCompare(b.tournament.id));
  return rows;
}

function RevenueChart({ rows, mode, openTournament }: {
  rows: TournamentFinanceRow[];
  mode: ChartMode;
  openTournament: (tournamentId: string) => void;
}) {
  const chartBox = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(480);
  const [previewId, setPreviewId] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [focusedId, setFocusedId] = useState<string>();
  const hasRows = rows.length > 0;
  useLayoutEffect(() => {
    const box = chartBox.current;
    if (!box) return;
    const measure = () => setBoxWidth(box.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [hasRows]);

  if (!hasRows) {
    return <p className="empty">За выбранный период нет турниров для построения графика</p>;
  }

  const selectedRow = rows.find(row => row.tournament.id === selectedId);
  const activeRow = selectedRow ?? rows.find(row => row.tournament.id === previewId) ?? rows[rows.length - 1];
  const keyboardId = rows.some(row => row.tournament.id === focusedId) ? focusedId : activeRow.tournament.id;
  const height = 260;
  const padLeft = 62;
  const padRight = 32;
  const padTop = 22;
  const padBottom = 34;
  const width = Math.max(boxWidth, 480, padLeft + padRight + (rows.length - 1) * 9);
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const hitWidth = Math.min(44, plotW / Math.max(1, rows.length - 1));

  const values = rows.map(row => mode === 'cumulative' ? row.cumulative : row.received);
  const rawMax = Math.max(1, ...values);
  const niceStep = rawMax <= 5000 ? 1000 : rawMax <= 25000 ? 5000 : rawMax <= 100000 ? 20000 : Math.ceil(rawMax / 4 / 10000) * 10000;
  const maxVal = Math.max(niceStep, Math.ceil(rawMax / niceStep) * niceStep);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(ratio => Math.round(maxVal * ratio));

  const xFor = (index: number) => rows.length === 1
    ? padLeft + plotW / 2
    : padLeft + (index / (rows.length - 1)) * plotW;
  const yFor = (value: number) => padTop + plotH - (value / maxVal) * plotH;

  const points = rows.map((row, index) => ({
    x: xFor(index),
    y: yFor(values[index]),
    row,
    value: values[index],
  }));

  const lineD = smoothPath(points);
  const areaD = points.length > 1
    ? `${lineD} L ${points[points.length - 1].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`
    : '';

  const avg = rows.reduce((sum, row) => sum + row.received, 0) / rows.length;
  const avgY = yFor(avg);

  const labelStep = Math.max(1, Math.ceil(rows.length / 7));

  return (
    <div className="finance-chart-wrap">
      <div className="finance-svg-box" ref={chartBox}>
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="finance-svg" role="group" aria-label={mode === 'cumulative' ? 'График выручки нарастающим итогом' : 'График динамики выручки по турнирам'}>
          <defs>
            <linearGradient id="finance-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.26" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {ticks.map((tick, idx) => {
            const y = yFor(tick);
            return (
              <g key={idx}>
                <line x1={padLeft} x2={width - padRight} y1={y} y2={y} className="finance-grid-line" />
                <text x={padLeft - 10} y={y + 4} textAnchor="end" className="finance-axis-label">{compactRub(tick)}</text>
              </g>
            );
          })}

          {mode === 'per_tournament' && rows.length > 1 && avg > 0 && (
            <g>
              <line x1={padLeft} x2={width - padRight} y1={avgY} y2={avgY} className="finance-avg-line" />
              <text x={width - padRight} y={avgY - 6} textAnchor="end" className="finance-avg-label">
                Средняя · {compactRub(Math.round(avg))}
              </text>
            </g>
          )}

          {areaD && <path d={areaD} fill="url(#finance-area-grad)" />}

          {mode === 'per_tournament' && rows.length === 1 && (
            <rect
              x={points[0].x - 22}
              y={points[0].y}
              width={44}
              height={Math.max(2, padTop + plotH - points[0].y)}
              rx={8}
              className="finance-single-bar"
            />
          )}

          {points.length > 1 && <path d={lineD} fill="none" className="finance-line" />}

          {points.map((pt, index) => {
            const id = pt.row.tournament.id;
            const isActive = pt.row === activeRow;
            const showXLabel = index === 0 || index === rows.length - 1 || index % labelStep === 0;
            return (
              <g key={id}>
                {isActive && (
                  <line x1={pt.x} x2={pt.x} y1={padTop} y2={padTop + plotH} className="finance-cursor-line" />
                )}
                {showXLabel && (
                  <text x={pt.x} y={height - 12} textAnchor="middle" className="finance-axis-label">
                    {shortDate(pt.row.dateMs)}
                  </text>
                )}
              </g>
            );
          })}
          {points.map((pt, index) => {
            const id = pt.row.tournament.id;
            const isActive = pt.row === activeRow;
            const select = () => {
              setFocusedId(id);
              setSelectedId(id);
            };
            return (
              <g
                key={id}
                className="finance-point-group"
                role="button"
                aria-label={`${pt.row.tournament.name} · ${fullDate(pt.row.dateMs)} · ${money(pt.value)}`}
                aria-pressed={selectedRow?.tournament.id === id}
                tabIndex={id === keyboardId ? 0 : -1}
                onPointerEnter={() => setPreviewId(id)}
                onFocus={() => { setFocusedId(id); setPreviewId(id); }}
                onClick={select}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    select();
                  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    const next = index + (event.key === 'ArrowLeft' ? -1 : 1);
                    chartBox.current?.querySelectorAll<SVGGElement>('.finance-point-group')[next]?.focus();
                  } else if (event.key === 'Escape') {
                    setSelectedId(undefined);
                  }
                }}
              >
                <rect x={pt.x - hitWidth / 2} y={padTop - 8} width={hitWidth} height={plotH + 16} fill="transparent" />
                <circle cx={pt.x} cy={pt.y} r={isActive ? 5 : 3.5} className={isActive ? 'finance-dot active' : 'finance-dot'} aria-hidden="true" />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="finance-chart-inspector">
        <div className="finance-inspector-summary" aria-live="polite">
          <div className="finance-inspector-main">
            <strong>{activeRow.tournament.name}</strong>
            <span className="muted">{fullDate(activeRow.dateMs)}</span>
          </div>
          <div className="finance-inspector-values">
            <span className="finance-inspector-total">
              {mode === 'cumulative' ? 'Накоплено: ' : 'Выручка: '}
              <strong>{money(mode === 'cumulative' ? activeRow.cumulative : activeRow.received)}</strong>
              {mode === 'cumulative' && <small className="muted"> (+{money(activeRow.received)})</small>}
            </span>
            {mode === 'per_tournament' && activeRow.deltaPct !== null && (
              <span className={'finance-delta' + (activeRow.deltaPct >= 0 ? ' up' : ' down')}>
                {activeRow.deltaPct >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {activeRow.deltaPct >= 0 ? '+' : ''}{activeRow.deltaPct}%
              </span>
            )}
            <span className="finance-inspector-split">
              <span className="pay-method-text method-card">Карта {money(activeRow.card)}</span>
              <span className="muted">·</span>
              <span className="pay-method-text method-cash">Нал {money(activeRow.cash)}</span>
              <span className="muted">·</span>
              <span className="pay-method-text method-transfer">Эл. {money(activeRow.transfer)}</span>
            </span>
          </div>
        </div>
        {selectedRow && (
          <button
            type="button"
            className="button primary compact"
            aria-label={`Открыть турнир «${selectedRow.tournament.name}» · ${fullDate(selectedRow.dateMs)}`}
            onClick={() => openTournament(selectedRow.tournament.id)}
          >
            Открыть турнир <ChevronRight size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

export function ClubFinance({ data, openTournament }: {
  data: Snapshot;
  openTournament: (tournamentId: string) => void;
}) {
  const [period, setPeriod] = useState<FinancePeriod>('all');
  const [chartMode, setChartMode] = useState<ChartMode>('per_tournament');
  const [onlyFinished, setOnlyFinished] = useState(false);
  const [customFrom, setCustomFrom] = useState(() => dateInputValue(data.serverTime - 29 * DAY_MS));
  const [customTo, setCustomTo] = useState(() => dateInputValue(data.serverTime));

  const allRows = useMemo(() => buildRows(data), [data]);
  const earliestMs = allRows[0]?.dateMs ?? data.serverTime;

  const bounds = useMemo(
    () => resolveBounds(period, data.serverTime, customFrom, customTo, earliestMs),
    [period, data.serverTime, customFrom, customTo, earliestMs],
  );

  const filteredRows = useMemo(() => {
    const inRange = allRows.filter(row => {
      if (onlyFinished && row.tournament.state !== 'finished') return false;
      return row.dateMs >= bounds.start && row.dateMs <= bounds.end;
    });
    let running = 0;
    return inRange.map((row, index) => {
      running += row.received;
      const prev = index > 0 ? inRange[index - 1].received : null;
      const deltaPct = prev !== null && prev > 0 ? Math.round(((row.received - prev) / prev) * 100) : null;
      return { ...row, cumulative: running, deltaPct };
    });
  }, [allRows, bounds.start, bounds.end, onlyFinished]);

  const prevPeriodRevenue = useMemo(() => {
    if (!bounds.duration) return null;
    const prevStart = bounds.start - bounds.duration;
    const prevEnd = bounds.start - 1;
    const prevRows = allRows.filter(row => {
      if (onlyFinished && row.tournament.state !== 'finished') return false;
      return row.dateMs >= prevStart && row.dateMs <= prevEnd;
    });
    if (!prevRows.length) return null;
    return prevRows.reduce((sum, row) => sum + row.received, 0);
  }, [allRows, bounds.start, bounds.duration, onlyFinished]);

  const totals = useMemo(() => {
    const charged = filteredRows.reduce((sum, r) => sum + r.charged, 0);
    const received = filteredRows.reduce((sum, r) => sum + r.received, 0);
    const card = filteredRows.reduce((sum, r) => sum + r.card, 0);
    const cash = filteredRows.reduce((sum, r) => sum + r.cash, 0);
    const transfer = filteredRows.reduce((sum, r) => sum + r.transfer, 0);
    const other = filteredRows.reduce((sum, r) => sum + r.other, 0);
    const due = filteredRows.reduce((sum, r) => sum + r.due, 0);
    const guests = filteredRows.reduce((sum, r) => sum + r.guests, 0);
    const avgPerTournament = filteredRows.length ? Math.round(received / filteredRows.length) : 0;
    const avgPerGuest = guests ? Math.round(received / guests) : 0;
    const collectionRate = charged > 0 ? Math.min(100, Math.round((received / charged) * 100)) : 0;
    const periodDelta = prevPeriodRevenue && prevPeriodRevenue > 0
      ? Math.round(((received - prevPeriodRevenue) / prevPeriodRevenue) * 100)
      : null;
    return { charged, received, card, cash, transfer, other, due, guests, avgPerTournament, avgPerGuest, collectionRate, periodDelta };
  }, [filteredRows, prevPeriodRevenue]);

  const share = (amount: number) => totals.received > 0 ? Math.round((amount / totals.received) * 100) : 0;
  const methodCards = [
    { key: 'card', label: 'Карта', amount: totals.card, share: share(totals.card), Icon: CreditCard },
    { key: 'cash', label: 'Наличные', amount: totals.cash, share: share(totals.cash), Icon: Banknote },
    { key: 'transfer', label: 'Электронно', amount: totals.transfer, share: share(totals.transfer), Icon: Smartphone },
  ] as const;

  const tableRows = useMemo(() => filteredRows.slice().reverse(), [filteredRows]);

  return (
    <section className="finance-screen" aria-labelledby="club-finance-heading">
      <Heading
        title="Финансы клуба"
        subtitle={`${data.club.name} · сводка по турнирам и способам оплаты`}
      />

      <div className="crm-filter-bar finance-filter-bar">
        <div className="crm-segmented" role="group" aria-label="Период финансовой сводки">
          {periodOptions.map(option => (
            <button
              key={option.id}
              type="button"
              className={period === option.id ? 'crm-seg-btn active' : 'crm-seg-btn'}
              aria-pressed={period === option.id}
              onClick={() => setPeriod(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="crm-date-range">
            <Calendar size={15} className="muted" />
            <input type="date" aria-label="Дата начала" value={customFrom} onChange={event => setCustomFrom(event.target.value)} />
            <span className="muted">—</span>
            <input type="date" aria-label="Дата окончания" value={customTo} onChange={event => setCustomTo(event.target.value)} />
          </div>
        )}

        <label className="finance-toggle-check">
          <input type="checkbox" checked={onlyFinished} onChange={event => setOnlyFinished(event.target.checked)} />
          <span>Только завершённые</span>
        </label>

        <span className="crm-period-caption muted">
          {fullDate(bounds.start)} — {fullDate(bounds.end)}
        </span>
      </div>

      <section className="panel finance-kpis" aria-label="Ключевые финансовые показатели">
        <div className="finance-kpi-cell">
          <span>Выручка за период</span>
          <div className="finance-kpi-value">
            <strong className="accent">{money(totals.received)}</strong>
            {totals.periodDelta !== null && (
              <span className={'finance-delta' + (totals.periodDelta >= 0 ? ' up' : ' down')}>
                {totals.periodDelta >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {totals.periodDelta >= 0 ? '+' : ''}{totals.periodDelta}%
              </span>
            )}
          </div>
          <small className="muted">турниров: {filteredRows.length} · визитов: {totals.guests}</small>
        </div>
        <div className="finance-kpi-cell">
          <span>Начислено</span>
          <strong>{money(totals.charged)}</strong>
          <small className="muted">собираемость: {totals.collectionRate}%</small>
        </div>
        <div className="finance-kpi-cell">
          <span>Средняя за турнир</span>
          <strong>{money(totals.avgPerTournament)}</strong>
          <small className="muted">средний чек: {money(totals.avgPerGuest)}</small>
        </div>
        <div className="finance-kpi-cell">
          <span>Остаток к оплате</span>
          <strong className={totals.due > 0 ? 'owing' : ''}>{money(totals.due)}</strong>
          <small className="muted">{totals.due > 0 ? 'непогашенные долги периода' : 'все расчёты закрыты'}</small>
        </div>
      </section>

      <section className="panel finance-methods-panel" aria-label="Выручка по способам оплаты">
        <div className="finance-methods-grid">
          {methodCards.map(({ key, label, amount, share: pct, Icon }) => (
            <div key={key} className={'finance-method-card method-' + key}>
              <div className="finance-method-head">
                <span className="finance-method-label"><Icon size={16} /> {label}</span>
                <span className="finance-method-share">{pct}%</span>
              </div>
              <strong>{money(amount)}</strong>
            </div>
          ))}
        </div>
        {totals.received > 0 && (
          <div className="finance-mix-bar" aria-hidden="true">
            {totals.card > 0 && <span className="method-card" style={{ width: `${(totals.card / totals.received) * 100}%` }} />}
            {totals.cash > 0 && <span className="method-cash" style={{ width: `${(totals.cash / totals.received) * 100}%` }} />}
            {totals.transfer > 0 && <span className="method-transfer" style={{ width: `${(totals.transfer / totals.received) * 100}%` }} />}
            {totals.other > 0 && <span className="method-other" style={{ width: `${(totals.other / totals.received) * 100}%` }} />}
          </div>
        )}
        {totals.other > 0 && (
          <p className="muted finance-other-note">Без указанного способа: {money(totals.other)}</p>
        )}
      </section>

      <section className="panel finance-chart-panel" aria-label="График выручки">
        <div className="panel-head">
          <h2><TrendingUp size={17} /> Динамика выручки</h2>
          <div className="crm-segmented" role="group" aria-label="Режим графика">
            <button
              type="button"
              className={chartMode === 'per_tournament' ? 'crm-seg-btn active' : 'crm-seg-btn'}
              aria-pressed={chartMode === 'per_tournament'}
              onClick={() => setChartMode('per_tournament')}
            >
              По турнирам
            </button>
            <button
              type="button"
              className={chartMode === 'cumulative' ? 'crm-seg-btn active' : 'crm-seg-btn'}
              aria-pressed={chartMode === 'cumulative'}
              onClick={() => setChartMode('cumulative')}
            >
              Нарастающим итогом
            </button>
          </div>
        </div>
        <RevenueChart rows={filteredRows} mode={chartMode} openTournament={openTournament} />
      </section>

      <section className="panel finance-table-panel" aria-label="Финансы по турнирам">
        <div className="panel-head">
          <h2><Wallet size={17} /> Турниры за период</h2>
          <span className="count">{tableRows.length}</span>
        </div>

        {tableRows.length ? (
          <div className="finance-table">
            <div className="finance-table-row finance-table-head" aria-hidden="true">
              <span>Турнир</span>
              <span>Карта</span>
              <span>Наличные</span>
              <span>Электронно</span>
              <span>Выручка</span>
              <span>Накопл.</span>
              <span />
            </div>

            {tableRows.map(row => (
              <button
                key={row.tournament.id}
                type="button"
                className="finance-table-row finance-table-item"
                onClick={() => openTournament(row.tournament.id)}
              >
                <span className="finance-t-name">
                  <strong>{row.tournament.name}</strong>
                  <small>
                    {fullDate(row.dateMs)}
                    {row.guests > 0 ? ` · ${row.guests} гост.` : ''}
                    {row.due > 0 ? ` · долг ${money(row.due)}` : ''}
                  </small>
                  <State tournament={row.tournament} />
                </span>
                <span className="finance-num pay-method-text method-card" data-label="Карта">
                  {row.card > 0 ? money(row.card) : <em className="muted">—</em>}
                </span>
                <span className="finance-num pay-method-text method-cash" data-label="Наличные">
                  {row.cash > 0 ? money(row.cash) : <em className="muted">—</em>}
                </span>
                <span className="finance-num pay-method-text method-transfer" data-label="Электронно">
                  {row.transfer > 0 ? money(row.transfer) : <em className="muted">—</em>}
                </span>
                <span className="finance-num finance-t-total" data-label="Выручка">
                  <strong>{money(row.received)}</strong>
                  {row.deltaPct !== null && (
                    <small className={'finance-delta' + (row.deltaPct >= 0 ? ' up' : ' down')}>
                      {row.deltaPct >= 0 ? '+' : ''}{row.deltaPct}%
                    </small>
                  )}
                </span>
                <span className="finance-num finance-t-cum" data-label="Накопл.">
                  {money(row.cumulative)}
                </span>
                <ChevronRight size={16} className="muted" aria-hidden="true" />
              </button>
            ))}

            <div className="finance-table-row finance-table-foot">
              <span className="finance-t-name">
                <strong>Итого за период</strong>
                <small>{filteredRows.length} турн. · начислено {money(totals.charged)}</small>
              </span>
              <span className="finance-num pay-method-text method-card">{money(totals.card)}</span>
              <span className="finance-num pay-method-text method-cash">{money(totals.cash)}</span>
              <span className="finance-num pay-method-text method-transfer">{money(totals.transfer)}</span>
              <span className="finance-num finance-t-total"><strong>{money(totals.received)}</strong></span>
              <span className="finance-num finance-t-cum">{totals.due > 0 ? <small className="owing">долг {money(totals.due)}</small> : '—'}</span>
              <span />
            </div>
          </div>
        ) : (
          <p className="empty">За выбранный период нет турниров с финансовыми операциями</p>
        )}
      </section>
    </section>
  );
}
