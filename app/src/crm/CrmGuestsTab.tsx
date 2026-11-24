import { useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { GuestActivity, GuestSummary } from '../../shared/crm';
import { matchesQuery } from '../../shared/search';
import { Person, SearchBox, money } from '../widgets';

type VisitFilter = 'all' | '0' | '1' | '2-4' | '5+';
type ActivityFilter = 'all' | 'active' | 'inactive_14' | 'inactive_30' | 'never';
type SortKey = 'visits' | 'spent' | 'avgCheck' | 'lastVisit' | 'registeredAt' | 'name';

function relativeDays(days: number | null) {
  if (days === null) return 'Не приходил';
  if (days === 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  return `${days} дн. назад`;
}

function activityTitle(status: GuestActivity) {
  if (status === 'active') return 'Активный (≤ 14 дн.)';
  if (status === 'cooling') return 'Не был 15–30 дн.';
  if (status === 'inactive') return 'Неактивный (> 30 дн.)';
  return 'Не приходил';
}

export function CrmGuestsTab({
  guests,
  onSelect,
  onAdd,
}: {
  guests: GuestSummary[];
  onSelect: (playerId: string) => void;
  onAdd: () => void;
}) {
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [visitFilter, setVisitFilter] = useState<VisitFilter>('all');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('visits');

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const guest of guests) {
      if (guest.player.source.trim()) set.add(guest.player.source.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [guests]);

  const counts = useMemo(() => {
    const active = guests.filter(g => g.activity === 'active').length;
    const cooling = guests.filter(g => g.activity === 'cooling').length;
    const inactive = guests.filter(g => g.activity === 'inactive').length;
    const never = guests.filter(g => g.activity === 'never').length;
    return { total: guests.length, active, cooling, inactive, never };
  }, [guests]);

  const filtered = useMemo(() => {
    const list = guests.filter(g => {
      const p = g.player;
      if (
        query.trim() &&
        !matchesQuery(query, [p.name, p.nickname, p.phone, p.telegram, p.instagram, p.source, p.tags, p.note])
      ) {
        return false;
      }
      if (sourceFilter !== 'all' && (p.source.trim() || 'Не указан') !== sourceFilter) return false;
      if (visitFilter === '0' && g.visitsCount !== 0) return false;
      if (visitFilter === '1' && g.visitsCount !== 1) return false;
      if (visitFilter === '2-4' && (g.visitsCount < 2 || g.visitsCount > 4)) return false;
      if (visitFilter === '5+' && g.visitsCount < 5) return false;

      if (activityFilter === 'active' && g.activity !== 'active') return false;
      if (activityFilter === 'inactive_14' && (g.daysSinceLastVisit === null || g.daysSinceLastVisit < 14)) return false;
      if (activityFilter === 'inactive_30' && (g.daysSinceLastVisit === null || g.daysSinceLastVisit < 30)) return false;
      if (activityFilter === 'never' && g.activity !== 'never') return false;
      return true;
    });

    return list.sort((a, b) => {
      if (sortBy === 'visits') return b.visitsCount - a.visitsCount || b.totalSpent - a.totalSpent;
      if (sortBy === 'spent') return b.totalSpent - a.totalSpent || b.visitsCount - a.visitsCount;
      if (sortBy === 'avgCheck') return b.avgCheck - a.avgCheck || b.visitsCount - a.visitsCount;
      if (sortBy === 'lastVisit') return (b.lastVisitAt ?? 0) - (a.lastVisitAt ?? 0);
      if (sortBy === 'registeredAt') return b.player.registeredAt - a.player.registeredAt;
      return a.player.name.localeCompare(b.player.name, 'ru');
    });
  }, [guests, query, sourceFilter, visitFilter, activityFilter, sortBy]);

  const hasFilters = query.trim() !== '' || sourceFilter !== 'all' || visitFilter !== 'all' || activityFilter !== 'all';

  return (
    <div className="crm-stack">
      <div className="crm-stat-strip" role="group" aria-label="Быстрые фильтры базы">
        <button
          type="button"
          className={activityFilter === 'all' ? 'panel crm-stat-card active' : 'panel crm-stat-card'}
          onClick={() => setActivityFilter('all')}
        >
          <span>Всего гостей</span>
          <strong>{counts.total}</strong>
        </button>
        <button
          type="button"
          className={activityFilter === 'active' ? 'panel crm-stat-card active' : 'panel crm-stat-card'}
          onClick={() => setActivityFilter(activityFilter === 'active' ? 'all' : 'active')}
        >
          <span>Активные (≤ 14 дн.)</span>
          <strong className="accent">{counts.active}</strong>
        </button>
        <button
          type="button"
          className={activityFilter === 'inactive_14' ? 'panel crm-stat-card active' : 'panel crm-stat-card'}
          onClick={() => setActivityFilter(activityFilter === 'inactive_14' ? 'all' : 'inactive_14')}
        >
          <span>Не были 14+ дн.</span>
          <strong className="owing">{counts.cooling + counts.inactive}</strong>
        </button>
        <button
          type="button"
          className={activityFilter === 'never' ? 'panel crm-stat-card active' : 'panel crm-stat-card'}
          onClick={() => setActivityFilter(activityFilter === 'never' ? 'all' : 'never')}
        >
          <span>Не приходили</span>
          <strong>{counts.never}</strong>
        </button>
      </div>

      <div className="crm-toolbar">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Имя, ник, телефон, Telegram, Instagram, тег"
        />
        <div className="crm-filters">
          <select aria-label="Фильтр по источнику" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
            <option value="all">Все источники</option>
            {sources.map(src => (
              <option key={src} value={src}>{src}</option>
            ))}
          </select>
          <select aria-label="Фильтр по визитам" value={visitFilter} onChange={e => setVisitFilter(e.target.value as VisitFilter)}>
            <option value="all">Любые визиты</option>
            <option value="0">0 визитов</option>
            <option value="1">1 визит</option>
            <option value="2-4">2–4 визита</option>
            <option value="5+">5+ постоянные</option>
          </select>
          <select aria-label="Фильтр по активности" value={activityFilter} onChange={e => setActivityFilter(e.target.value as ActivityFilter)}>
            <option value="all">Любая активность</option>
            <option value="active">Активные (≤ 14 дн.)</option>
            <option value="inactive_14">Не были 14+ дн.</option>
            <option value="inactive_30">Не были 30+ дн.</option>
            <option value="never">Не приходили</option>
          </select>
          <select aria-label="Сортировка гостей" value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)}>
            <option value="visits">Визиты ↓</option>
            <option value="spent">Сумма покупок ↓</option>
            <option value="avgCheck">Средний чек ↓</option>
            <option value="lastVisit">Последний визит ↓</option>
            <option value="registeredAt">Дата регистрации ↓</option>
            <option value="name">Имя А→Я</option>
          </select>
        </div>
      </div>

      <div className="section-head">
        <span className="muted">Найдено гостей: {filtered.length}</span>
        <div className="actions">
          {hasFilters && (
            <button
              type="button"
              className="button compact"
              onClick={() => {
                setQuery('');
                setSourceFilter('all');
                setVisitFilter('all');
                setActivityFilter('all');
              }}
            >
              Сбросить фильтры
            </button>
          )}
          <button type="button" className="button primary compact" onClick={onAdd}>
            <Plus size={16} /> Добавить гостя
          </button>
        </div>
      </div>

      <section className="panel crm-guest-table" aria-label="Таблица гостей клуба">
        <div className="crm-guest-row crm-guest-head">
          <span>Гость</span>
          <span>Контакты</span>
          <span>Источник</span>
          <span className="num">Визиты</span>
          <span className="num">Покупки</span>
          <span className="num">Ср. чек</span>
          <span>Последний визит</span>
          <span />
        </div>
        {filtered.map(guest => {
          const p = guest.player;
          const contacts = [p.telegram, p.phone, p.instagram].filter(Boolean).slice(0, 2).join(' · ') || '—';
          return (
            <button
              type="button"
              className="crm-guest-row full-row"
              key={p.id}
              onClick={() => onSelect(p.id)}
            >
              <span className="crm-guest-cell-person">
                <span className={`crm-dot ${guest.activity}`} title={activityTitle(guest.activity)} />
                <Person name={p.name} nickname={p.nickname} detail={p.tags || undefined} />
              </span>
              <span className="crm-guest-contacts muted">{contacts}</span>
              <span className="crm-guest-source">{p.source || '—'}</span>
              <span className="num crm-guest-visits">
                <small>Визиты </small>
                {guest.visitsCount}
              </span>
              <span className="num crm-guest-spent">
                <small>Покупки </small>
                {money(guest.totalSpent)}
                {guest.due > 0 && <em className="crm-due-badge">долг {money(guest.due)}</em>}
              </span>
              <span className="num crm-guest-avg">
                <small>Ср. чек </small>
                {guest.avgCheck ? money(guest.avgCheck) : '—'}
              </span>
              <span className="crm-guest-last muted">{relativeDays(guest.daysSinceLastVisit)}</span>
              <ChevronRight size={16} />
            </button>
          );
        })}
        {!filtered.length && <p className="empty">По выбранным фильтрам гостей не найдено</p>}
      </section>
    </div>
  );
}
