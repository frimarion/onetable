import { useMemo, useState } from 'react';
import { ChevronRight, Send } from 'lucide-react';
import type { Snapshot } from '../../shared/model';
import {
  computeRetention,
  type BroadcastSegment,
  type GuestSummary,
} from '../../shared/crm';
import { Person, money } from '../widgets';

type SegmentKey = 'inactive14' | 'inactive30' | 'oneVisitOnly' | 'registeredNoVisit';

const segmentMeta: Record<
  SegmentKey,
  { title: string; subtitle: string; broadcastSegment: BroadcastSegment }
> = {
  inactive14: {
    title: 'Не приходили 14+ дней',
    subtitle: 'Остывающие гости — самое время вернуть приглашением',
    broadcastSegment: 'inactive_14',
  },
  inactive30: {
    title: 'Не приходили 30+ дней',
    subtitle: 'Потерянные или спящие гости, требуется реактивация',
    broadcastSegment: 'inactive_30',
  },
  oneVisitOnly: {
    title: 'Пришли 1 раз',
    subtitle: 'Первое впечатление получено — подтолкнуть ко второму визиту',
    broadcastSegment: 'one_visit',
  },
  registeredNoVisit: {
    title: 'Зарегистрировались, но не пришли',
    subtitle: 'Есть контакт в базе, но первого визита ещё не было',
    broadcastSegment: 'no_visits',
  },
};

export function CrmRetentionTab({
  guests,
  data,
  onSelectGuest,
  onStartBroadcast,
}: {
  guests: GuestSummary[];
  data: Snapshot;
  onSelectGuest: (playerId: string) => void;
  onStartBroadcast: (segment: BroadcastSegment) => void;
}) {
  const [activeList, setActiveList] = useState<SegmentKey>('inactive14');

  const retention = useMemo(
    () => computeRetention(guests, data.visits, data.serverTime),
    [guests, data.visits, data.serverTime],
  );

  const currentList = retention.segments[activeList];
  const currentMeta = segmentMeta[activeList];
  const eligibleCount = currentList.filter(g => g.player.telegramConsent && g.player.telegram.trim() !== '').length;

  return (
    <div className="crm-stack">
      <section className="panel crm-metrics-grid" aria-label="Метрики удержания гостей">
        <div className="crm-metric-cell">
          <span>Пришли 1 раз</span>
          <strong>{retention.oneVisitCount}</strong>
          <small className="muted">из {retention.totalAttendedGuests} приходивших</small>
        </div>
        <div className="crm-metric-cell">
          <span>Пришли 2+ раза</span>
          <strong className="accent">{retention.twoPlusVisitsCount}</strong>
          <small className="muted">
            {retention.totalAttendedGuests
              ? Math.round((retention.twoPlusVisitsCount / retention.totalAttendedGuests) * 100)
              : 0}
            % повторных гостей
          </small>
        </div>
        <div className="crm-metric-cell">
          <span>Вернулись за 7 дней</span>
          <strong>{retention.returnedIn7Days}</strong>
          <small className="muted">{retention.returnedIn7DaysPct}% от приходивших</small>
        </div>
        <div className="crm-metric-cell">
          <span>Вернулись за 30 дней</span>
          <strong>{retention.returnedIn30Days}</strong>
          <small className="muted">{retention.returnedIn30DaysPct}% от приходивших</small>
        </div>
        <div className="crm-metric-cell">
          <span>Перестали посещать</span>
          <strong className="owing">{retention.churnedCount}</strong>
          <small className="muted">не были более 30 дней</small>
        </div>
        <div className="crm-metric-cell">
          <span>Среднее визитов</span>
          <strong>{retention.avgVisitsPerGuest}</strong>
          <small className="muted">посещений на одного гостя</small>
        </div>
      </section>

      <section className="panel crm-panel" aria-label="Автоматические списки неактивных гостей">
        <div className="panel-head">
          <div>
            <h2>Списки для возврата и рассылок</h2>
            <p className="muted crm-panel-sub">Формируются автоматически по истории визитов</p>
          </div>
          <button
            type="button"
            className="button primary"
            disabled={!eligibleCount}
            onClick={() => onStartBroadcast(currentMeta.broadcastSegment)}
          >
            <Send size={15} /> Рассылка по сегменту ({eligibleCount})
          </button>
        </div>

        <div className="crm-panel-body crm-retention-controls">
          <div className="crm-segmented crm-retention-tabs" role="tablist">
            {(Object.keys(segmentMeta) as SegmentKey[]).map(key => {
              const count = retention.segments[key].length;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={activeList === key}
                  className={activeList === key ? 'crm-seg-btn active' : 'crm-seg-btn'}
                  onClick={() => setActiveList(key)}
                >
                  {segmentMeta[key].title} <span className="crm-count-pill">{count}</span>
                </button>
              );
            })}
          </div>

          <p className="muted crm-retention-sub">
            {currentMeta.subtitle} · с согласием на Telegram: <strong>{eligibleCount}</strong> из {currentList.length}
          </p>
        </div>

        <div className="crm-retention-list">
          {currentList.map(guest => {
            const canTg = guest.player.telegramConsent && guest.player.telegram.trim() !== '';
            return (
              <button
                type="button"
                className="crm-retention-row full-row"
                key={guest.player.id}
                onClick={() => onSelectGuest(guest.player.id)}
              >
                <Person
                  name={guest.player.name}
                  nickname={guest.player.nickname}
                  detail={[guest.player.telegram || guest.player.phone, guest.player.source].filter(Boolean).join(' · ')}
                />
                <span className="muted">
                  {guest.daysSinceLastVisit === null ? 'Не приходил' : `Был ${guest.daysSinceLastVisit} дн. назад`}
                </span>
                <span className="num">{guest.visitsCount} виз.</span>
                <span className="num">{money(guest.totalSpent)}</span>
                <span className={canTg ? 'crm-consent-pill ok' : 'crm-consent-pill'}>
                  {canTg ? 'TG согласие' : 'Нет TG'}
                </span>
                <ChevronRight size={16} />
              </button>
            );
          })}
          {!currentList.length && <p className="empty">В этом сегменте сейчас нет гостей</p>}
        </div>
      </section>
    </div>
  );
}
