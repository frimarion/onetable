import { useMemo, useState } from 'react';
import { Calendar } from 'lucide-react';
import type { Snapshot } from '../../shared/model';
import { computeCrmAnalytics, periodBounds, type CrmPeriod } from '../../shared/crm';
import { money } from '../widgets';

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

const periodOptions: { id: CrmPeriod; label: string }[] = [
  { id: 'day', label: 'День' },
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'custom', label: 'Период' },
];

export function CrmAnalyticsTab({ data }: { data: Snapshot }) {
  const [period, setPeriod] = useState<CrmPeriod>('month');
  const [customFrom, setCustomFrom] = useState(() => dateInputValue(data.serverTime - 29 * 86_400_000));
  const [customTo, setCustomTo] = useState(() => dateInputValue(data.serverTime));

  const bounds = useMemo(
    () => periodBounds(period, data.serverTime, customFrom, customTo),
    [period, data.serverTime, customFrom, customTo],
  );

  const analytics = useMemo(
    () => computeCrmAnalytics(data.roster, data.crm.registrations, data.visits, data.payments, data.schedule, bounds.start, bounds.end),
    [data.roster, data.crm.registrations, data.visits, data.payments, data.schedule, bounds.start, bounds.end],
  );

  const maxSourceGuests = analytics.sources[0]?.guests ?? 1;

  return (
    <div className="crm-stack">
      <div className="crm-filter-bar">
        <div className="crm-segmented" role="group" aria-label="Период аналитики">
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
            <input
              type="date"
              aria-label="Дата начала периода"
              value={customFrom}
              onChange={event => setCustomFrom(event.target.value)}
            />
            <span className="muted">—</span>
            <input
              type="date"
              aria-label="Дата окончания периода"
              value={customTo}
              onChange={event => setCustomTo(event.target.value)}
            />
          </div>
        )}
        <span className="crm-period-caption muted">
          {shortDate(bounds.start)} — {shortDate(bounds.end)}
        </span>
      </div>

      <section className="panel crm-metrics-grid" aria-label="Ключевые показатели">
        <div className="crm-metric-cell">
          <span>Новые регистрации</span>
          <strong>{analytics.newRegistered}</strong>
          <small className="muted">новых гостей в базе</small>
        </div>
        <div className="crm-metric-cell">
          <span>Пришли в клуб</span>
          <strong className="accent">{analytics.attendedGuests}</strong>
          <small className="muted">всего визитов: {analytics.totalVisits}</small>
        </div>
        <div className="crm-metric-cell">
          <span>Новые / повторные</span>
          <strong>
            {analytics.newAttended} <span className="crm-kpi-sep">/</span> {analytics.returningAttended}
          </strong>
          <small className="muted">повторных посещений: {analytics.repeatVisitRate}%</small>
        </div>
        <div className="crm-metric-cell">
          <span>Конверсия в приход</span>
          <strong>{analytics.registrationConversion}%</strong>
          <small className="muted">
            {analytics.registrationsAttended} из {analytics.registrationsTotal} записей
          </small>
        </div>
        <div className="crm-metric-cell">
          <span>Потрачено гостями</span>
          <strong>{money(analytics.revenue)}</strong>
          <small className="muted">фактические оплаты за период</small>
        </div>
        <div className="crm-metric-cell">
          <span>Средний чек</span>
          <strong>{money(analytics.avgCheck)}</strong>
          <small className="muted">в среднем на один визит</small>
        </div>
      </section>

      <div className="crm-two-col">
        <section className="panel crm-panel" aria-label="Источники привлечения">
          <div className="panel-head">
            <h2>Источники привлечения</h2>
            <span className="count">{analytics.sources.length}</span>
          </div>
          {analytics.sources.length ? (
            <div className="crm-panel-body crm-bars">
              {analytics.sources.map(item => (
                <div className="crm-bar-row" key={item.source}>
                  <div className="crm-bar-head">
                    <strong>{item.source}</strong>
                    <span className="muted">
                      {item.guests} гост. · пришли {item.attended} · <b>{item.share}%</b>
                    </span>
                  </div>
                  <div className="crm-bar-track" aria-hidden="true">
                    <div
                      className="crm-bar-fill"
                      style={{ width: `${Math.max(4, Math.round((item.guests / maxSourceGuests) * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">За выбранный период нет данных по источникам</p>
          )}
        </section>

        <section className="panel crm-panel" aria-label="Турниры за период">
          <div className="panel-head">
            <h2>Турниры за период</h2>
            <span className="count">{analytics.tournaments.length}</span>
          </div>
          {analytics.tournaments.length ? (
            <div className="crm-mini-table">
              <div className="crm-mini-head">
                <span>Турнир</span>
                <span>Записи</span>
                <span>Пришли</span>
                <span>Выручка</span>
              </div>
              {analytics.tournaments.map(row => (
                <div className="crm-mini-row" key={row.id}>
                  <span className="crm-mini-name">
                    <strong>{row.name}</strong>
                    <small className="muted">{shortDate(row.date)}</small>
                  </span>
                  <span className="num">{row.registered}</span>
                  <span className="num">
                    {row.attended} <small className="muted">({row.conversion}%)</small>
                  </span>
                  <strong className="num">{money(row.revenue)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">За выбранный период турниров с активностью нет</p>
          )}
        </section>
      </div>
    </div>
  );
}
