import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Bot, ChevronDown, ChevronUp, ExternalLink, Send, ShieldCheck } from 'lucide-react';
import type { Snapshot } from '../../shared/model';
import {
  broadcastSegmentLabels,
  selectBroadcastRecipients,
  type BroadcastSegment,
  type GuestSummary,
} from '../../shared/crm';
import type { Run } from '../api';
import { money } from '../widgets';

function formatSentAt(ms: number | null) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}

export function CrmBroadcastsTab({
  guests,
  data,
  run,
  busy,
  initialSegment,
}: {
  guests: GuestSummary[];
  data: Snapshot;
  run: Run;
  busy: boolean;
  initialSegment?: BroadcastSegment;
}) {
  const [segment, setSegment] = useState<BroadcastSegment>(initialSegment ?? 'all');
  const [tag, setTag] = useState('');
  const [title, setTitle] = useState('');
  const [tournamentId, setTournamentId] = useState<string>('');
  const [message, setMessage] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [showRecipients, setShowRecipients] = useState(false);

  useEffect(() => {
    if (initialSegment) {
      setSegment(initialSegment);
      setExcluded(new Set());
    }
  }, [initialSegment]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const g of guests) {
      for (const t of g.tagList) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [guests]);

  useEffect(() => {
    if (segment === 'tag' && !tag && allTags.length) setTag(allTags[0]);
  }, [segment, tag, allTags]);

  const selection = useMemo(
    () => selectBroadcastRecipients(guests, segment, data.serverTime, tag),
    [guests, segment, data.serverTime, tag],
  );

  const activeRecipients = useMemo(
    () => selection.eligible.filter(g => !excluded.has(g.player.id)),
    [selection.eligible, excluded],
  );

  const toggleExclude = (playerId: string) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim() || !activeRecipients.length) return;
    void run(
      {
        type: 'sendBroadcast',
        title: title.trim() || broadcastSegmentLabels[segment],
        segment,
        tag: segment === 'tag' ? tag : undefined,
        tournamentId: tournamentId || null,
        message: message.trim(),
        linkUrl: linkUrl.trim(),
        recipientIds: activeRecipients.map(g => g.player.id),
      },
      () => {
        setTitle('');
        setMessage('');
        setLinkUrl('');
        setExcluded(new Set());
      },
    );
  }

  return (
    <div className="crm-stack">
      <div className="panel crm-bot-banner">
        <div className="crm-bot-status">
          <Bot size={18} />
          <div>
            <strong>
              {data.crm.botConfigured ? 'Telegram-бот подключён' : 'Telegram-бот · локальный демо-контур'}
            </strong>
            <small className="muted">
              Соблюдение лимитов Telegram Bot API: до {data.crm.rateLimitPerSec} сообщ./сек с очередью. Отправка только гостям с подтверждённым согласием.
            </small>
          </div>
        </div>
        <span className="crm-consent-pill ok">
          <ShieldCheck size={14} /> Лимит {data.crm.rateLimitPerSec}/с
        </span>
      </div>

      <div className="crm-broadcast-layout">
        <section className="panel crm-panel" aria-label="Создание Telegram-рассылки">
          <div className="panel-head">
            <h2>Новая рассылка</h2>
          </div>
          <form className="crm-panel-body crm-broadcast-form" onSubmit={handleSend}>
            <label>
              Название кампании
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Например, Приглашение на пятничный Deepstack"
              />
            </label>

            <label>
              Сегмент получателей
              <select
                value={segment}
                onChange={e => {
                  setSegment(e.target.value as BroadcastSegment);
                  setExcluded(new Set());
                }}
              >
                {(Object.keys(broadcastSegmentLabels) as BroadcastSegment[]).map(key => (
                  <option key={key} value={key}>
                    {broadcastSegmentLabels[key]}
                  </option>
                ))}
              </select>
            </label>

            {segment === 'tag' && (
              <label>
                Тег
                <select value={tag} onChange={e => setTag(e.target.value)}>
                  {allTags.length ? (
                    allTags.map(item => (
                      <option key={item} value={item}>{item}</option>
                    ))
                  ) : (
                    <option value="">Тегов пока нет</option>
                  )}
                </select>
              </label>
            )}

            <label>
              Связанный турнир (для расчёта записей, приходов и выручки)
              <select value={tournamentId} onChange={e => setTournamentId(e.target.value)}>
                <option value="">Без привязки к турниру</option>
                {data.schedule.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>

            <div className="crm-preview-box">
              <div className="crm-preview-head">
                <div>
                  <strong>Получателей к отправке: {activeRecipients.length}</strong>
                  <small className="muted">
                    В сегменте {selection.matched.length} · без согласия или Telegram: {selection.skippedNoConsent}
                  </small>
                </div>
                <button
                  type="button"
                  className="button compact"
                  onClick={() => setShowRecipients(prev => !prev)}
                >
                  {showRecipients ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  Список
                </button>
              </div>
              {showRecipients && (
                <div className="crm-recipient-list">
                  {selection.eligible.length ? (
                    selection.eligible.map(g => {
                      const checked = !excluded.has(g.player.id);
                      return (
                        <label key={g.player.id} className="crm-recipient-item">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleExclude(g.player.id)}
                          />
                          <span>{g.player.nickname || g.player.name}</span>
                          <small className="muted">{g.player.telegram}</small>
                        </label>
                      );
                    })
                  ) : (
                    <p className="muted">Нет гостей с согласием на Telegram-рассылку в этом сегменте</p>
                  )}
                </div>
              )}
            </div>

            <label>
              Текст сообщения
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={5}
                maxLength={4096}
                required
                placeholder="Привет! В пятницу играем вечерний турнир. Забронировать место можно по ссылке ниже…"
              />
              <small className="muted crm-char-count">
                Telegram Markdown: *жирный*, _курсив_ · {message.length} / 4096
              </small>
            </label>

            <label>
              Ссылка для отслеживания переходов (необязательно)
              <input
                type="url"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                maxLength={400}
                placeholder="https://t.me/club_bot?start=tournament"
              />
            </label>

            <button
              type="submit"
              className="button primary wide"
              disabled={busy || !message.trim() || !activeRecipients.length}
            >
              <Send size={16} /> Отправить рассылку ({activeRecipients.length})
            </button>
          </form>
        </section>

        <section className="panel crm-panel" aria-label="История рассылок и эффективность">
          <div className="panel-head">
            <h2>История рассылок</h2>
            <span className="count">{data.crm.broadcasts.length}</span>
          </div>

          {data.crm.broadcasts.length ? (
            <div className="crm-broadcast-history">
              {data.crm.broadcasts.map(item => {
                const ctr = item.sentCount ? Math.round((item.clicksCount / item.sentCount) * 100) : 0;
                const attendRate = item.registeredCount
                  ? Math.round((item.attendedCount / item.registeredCount) * 100)
                  : 0;
                return (
                  <article className="crm-broadcast-item" key={item.id}>
                    <div className="crm-broadcast-item-head">
                      <div>
                        <strong>{item.title}</strong>
                        <small className="muted">
                          {item.segmentLabel}
                          {item.tournamentName ? ` · ${item.tournamentName}` : ''} · {formatSentAt(item.sentAt)}
                        </small>
                      </div>
                      <span className="crm-consent-pill ok">
                        {item.mode === 'live' ? 'Отправлено' : 'Демо'}
                      </span>
                    </div>

                    <p className="crm-broadcast-excerpt">{item.message}</p>

                    {item.linkUrl && (
                      <p className="crm-broadcast-link muted">
                        <ExternalLink size={12} /> {item.linkUrl}
                      </p>
                    )}

                    <dl className="crm-funnel-grid">
                      <div>
                        <dt>Отправлено</dt>
                        <dd>{item.sentCount}</dd>
                      </div>
                      <div>
                        <dt>Переходы</dt>
                        <dd>
                          {item.clicksCount} <small>({ctr}%)</small>
                        </dd>
                      </div>
                      <div>
                        <dt>Записались</dt>
                        <dd>{item.registeredCount}</dd>
                      </div>
                      <div>
                        <dt>Пришли</dt>
                        <dd>
                          {item.attendedCount}
                          {item.registeredCount > 0 && <small> ({attendRate}%)</small>}
                        </dd>
                      </div>
                      <div>
                        <dt>Выручка</dt>
                        <dd className="accent">{money(item.revenue)}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="empty">Рассылок пока не было</p>
          )}
        </section>
      </div>
    </div>
  );
}
