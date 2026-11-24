import { useMemo, useState } from 'react';
import { Award, Check, ChevronRight, Clock3, Coffee, Copy, Crosshair, Monitor, Pause, Play, RotateCcw, SkipBack, SkipForward, Sparkles, Trophy, UsersRound } from 'lucide-react';
import type { Command, Entry, Snapshot } from '../shared/model';
import type { Result } from '../shared/operations';
import { calculateRating, ratingSchemeOf, type RatingCalculation } from '../shared/rating';
import type { Run } from './api';
import type { Modal } from './crm';
import { RatingSummary } from './RatingBuilder';
import { Person, SearchBox, Timer, format } from './widgets';
import { matchesQuery } from '../shared/search';

export function TimerControls({ data, busy, run, open, floor = false }: { data: Snapshot; busy: boolean; run: Run; open: (modal: Modal) => void; floor?: boolean }) {
  const tournament = data.tournament;
  const live = tournament.state === 'live';
  const { clock, revision } = data;
  const send = (operation: 'previous' | 'restart' | 'break' | 'minus' | 'plus') => run({ type: 'clockControl', operation, revision });
  const finish: Command = { type: 'finish' };
  return <div className="panel timer-panel" id="tournament-controls" tabIndex={-1}>
    <div className="timer-title"><Clock3 size={17} /><h2>Таймер турнира</h2></div>
    <Timer data={data} />
    {live && <>
      <div className="timer-buttons extended">
        <button className="button icon" aria-label="Предыдущий уровень" title="Предыдущий уровень" disabled={busy || !clock.level || clock.manualBreak} onClick={() => send('previous')}><SkipBack size={17} /></button>
        <button className="button primary" disabled={busy || clock.manualBreak} onClick={() => run({ type: 'toggleClock', revision })}>{clock.startedAt === null ? <><Play size={16} /> Запустить</> : <><Pause size={16} /> Пауза</>}</button>
        <button className="button icon" aria-label="Следующий уровень" title="Следующий уровень" disabled={busy || clock.manualBreak || clock.level + 1 >= data.structure.length} onClick={() => run({ type: 'nextLevel', revision })}><SkipForward size={17} /></button>
      </div>
      <div className="timer-adjust">
        <button className="button compact" disabled={busy} onClick={() => send('minus')}>−60 сек</button>
        <button className="button compact" disabled={busy} onClick={() => send('plus')}>+60 сек</button>
        <button className="button compact" disabled={busy || (!clock.manualBreak && data.structure[clock.level].kind === 'break')} onClick={() => send('break')}><Coffee size={15} />{clock.manualBreak ? 'Продолжить' : 'Перерыв'}</button>
      </div>
    </>}
    {tournament.state === 'scheduled' && <button className="button primary wide" disabled={busy} onClick={() => run({ type: 'start' })}><Play size={16} /> Открыть турнир</button>}
    {!floor && <details className="screen-controls">
      <summary>Управление дисплеем</summary>
      <div className="screen-controls-body">
        <label className="inline-field">Режим ТВ<select value={data.display.mode} disabled={busy} onChange={event => run({ type: 'displayMode', mode: event.target.value as Snapshot['display']['mode'] })}>
          <option value="clock">Таймер</option>{data.config.seating && <option value="seating">Рассадка</option>}<option value="payouts">Призовая зона</option><option value="results">Результаты</option>
        </select></label>
        <div className="actions">
          <button className="button compact" disabled={busy} aria-pressed={data.display.finalTable} onClick={() => run({ type: 'toggleFinalTable' })}><Trophy size={15} /> Финальный стол{data.display.finalTable ? ' · вкл' : ''}</button>
        </div>
      </div>
    </details>}
    {live && <details className="screen-controls">
      <summary>{floor ? 'Сброс таймера' : 'Сброс и завершение'}</summary>
      <div className="screen-controls-body">
        <button className="button" disabled={busy || clock.manualBreak} onClick={() => send('restart')}><RotateCcw size={15} /> Сбросить текущий уровень</button>
        <button className="button" disabled={busy} onClick={() => open({ mode: 'confirm', title: 'Сбросить таймер?', message: 'Таймер вернётся на первый уровень. Данные игроков и оплаты сохранятся.', label: 'Сбросить таймер', action: { type: 'clockControl', operation: 'reset', revision } })}>На первый уровень</button>
        {!floor && <button className="button" disabled={busy} onClick={() => open({ mode: 'confirm', title: 'Завершить турнир?', message: 'Таймер остановится. Оплаты, места и история сохранятся.', label: 'Завершить турнир', action: finish })}>Завершить турнир</button>}
      </div>
    </details>}
  </div>;
}

export function Payouts({ data }: { data: Snapshot }) {
  const scheme = ratingSchemeOf(data.config);
  return <RatingSummary scheme={scheme} entries={data.stats.entered + data.stats.reentries} addons={data.stats.addons} />;
}

function pointsForResult(result: Result, rating: RatingCalculation, totalKnockouts: number) {
  if (rating.mode === 'none' || result.place === null) return { total: 0, place: 0, ko: 0, participation: 0 };
  const place = rating.payouts[result.place - 1] ?? 0;
  const ko = rating.knockoutMode === 'per_ko'
    ? result.knockouts * rating.knockoutPerKo
    : rating.knockoutMode === 'pool_per_entry' && totalKnockouts > 0
      ? Math.round((rating.knockoutPool * result.knockouts) / totalKnockouts)
      : 0;
  const participation = rating.participationPoints;
  return { total: place + ko + participation, place, ko, participation };
}

function resultDetail(result: Result, entry: Entry | undefined, itmPlaces: number, seating: boolean) {
  const parts: string[] = [];
  if (entry) {
    if (entry.status === 'active') {
      parts.push(seating && entry.tableNo ? `Стол ${entry.tableNo} · Бокс ${entry.seatNo}` : 'В игре');
    } else if (result.place !== null && result.place <= itmPlaces) {
      parts.push('Призовая зона');
    }
    if (entry.reentries > 0) parts.push(`Реэнтри ×${entry.reentries}`);
    if (entry.addon) parts.push(entry.addonTier > 1 ? `Аддон ×${entry.addonTier}` : 'Аддон');
  } else if (result.place === null) {
    parts.push('В игре');
  } else if (result.place <= itmPlaces) {
    parts.push('Призовая зона');
  }
  return parts.join(' · ') || undefined;
}

export function Results({ data, items, open, busy = false }: {
  data: Snapshot; items?: Result[]; open?: (modal: Modal) => void; busy?: boolean;
}) {
  const list = items ?? data.results;
  const entriesById = useMemo(() => new Map(data.entries.map(item => [item.playerId, item])), [data.entries]);
  const scheme = ratingSchemeOf(data.config);
  const rating = useMemo(
    () => calculateRating(scheme, data.stats.entered + data.stats.reentries, data.stats.addons),
    [scheme, data.stats.entered, data.stats.reentries, data.stats.addons],
  );
  const itmPlaces = rating.mode !== 'none' ? rating.payouts.length : 0;
  const totalKnockouts = data.results.reduce((sum, item) => sum + item.knockouts, 0);
  const maxKo = data.results.reduce((max, item) => Math.max(max, item.knockouts), 0);
  const canEdit = Boolean(open) && (data.tournament.state === 'live' || data.tournament.state === 'finished');

  if (!list.length) return <p className="empty">Результатов пока нет</p>;

  return <ol className="results-list">
    {list.map(result => {
      const entry = entriesById.get(result.playerId);
      const isItm = result.place !== null && result.place <= itmPlaces;
      const isPodium = result.place !== null && result.place <= 3;
      const isActive = result.place === null;
      const pts = pointsForResult(result, rating, totalKnockouts);
      const isKoLeader = data.config.knockout && maxKo > 0 && result.knockouts === maxKo;
      const detail = resultDetail(result, entry, itmPlaces, data.config.seating);
      const rankClass = 'result-rank'
        + (result.place === 1 ? ' place-1' : result.place === 2 ? ' place-2' : result.place === 3 ? ' place-3' : '')
        + (isItm ? ' is-itm' : '')
        + (isActive ? ' is-active' : '');
      const rankContent = result.place === 1
        ? <><Trophy size={14} aria-hidden="true" /><span>1</span></>
        : result.place !== null
          ? <span>{result.place}</span>
          : <i className="result-live-dot" aria-hidden="true" />;
      const canEditPlace = canEdit && Boolean(entry) && result.place !== null && entry?.status === 'out';
      const canEditKo = canEdit && Boolean(entry) && data.config.knockout && entry?.status !== 'registered';
      const pointsTitle = pts.total > 0
        ? [
            pts.place > 0 ? `Место: ${format.format(pts.place)}` : '',
            pts.ko > 0 ? `Нокауты: ${format.format(pts.ko)}` : '',
            pts.participation > 0 ? `Участие: ${format.format(pts.participation)}` : '',
          ].filter(Boolean).join(' · ')
        : undefined;

      return <li key={result.playerId} className={'result-row' + (isPodium ? ' is-podium' : '') + (isItm ? ' is-itm' : '') + (isActive ? ' is-active' : '')}>
        {canEditPlace && entry ? (
          <button type="button" className={rankClass + ' interactive'} disabled={busy}
            title={`Изменить место (${result.place})`} aria-label={`Изменить место: ${result.name}`}
            onClick={() => open?.({ mode: 'place', entry })}>
            {rankContent}
          </button>
        ) : (
          <span className={rankClass} title={isActive ? 'В игре' : `${result.place} место`} aria-label={isActive ? 'В игре' : `${result.place} место`}>
            {rankContent}
          </span>
        )}

        {open && entry ? (
          <button type="button" className="result-person full-row" disabled={busy} onClick={() => open({ mode: 'entry', entry })}>
            <Person name={entry.name} nickname={entry.nickname} photoUrl={entry.photoUrl} detail={detail} />
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        ) : (
          <div className="result-person">
            <Person name={entry?.name ?? result.name} nickname={entry?.nickname} photoUrl={entry?.photoUrl} detail={detail} />
          </div>
        )}

        <div className="result-meta">
          {data.config.knockout && (
            canEditKo && entry ? (
              <button type="button" disabled={busy}
                className={'result-ko interactive' + (result.knockouts > 0 ? ' has-ko' : ' is-zero') + (isKoLeader ? ' is-leader' : '')}
                title={`Нокауты: ${result.knockouts}${isKoLeader ? ' (лидер)' : ''}. Нажмите, чтобы изменить`}
                aria-label={`Нокауты ${result.name}: ${result.knockouts}`}
                onClick={() => open?.({ mode: 'knockouts', entry })}>
                <Crosshair size={14} aria-hidden="true" />
                <span>{result.knockouts}</span>
              </button>
            ) : (
              <span className={'result-ko' + (result.knockouts > 0 ? ' has-ko' : ' is-zero') + (isKoLeader ? ' is-leader' : '')}
                title={`Нокауты: ${result.knockouts}${isKoLeader ? ' (лидер)' : ''}`}>
                <Crosshair size={14} aria-hidden="true" />
                <span>{result.knockouts}</span>
              </span>
            )
          )}

          {rating.mode !== 'none' && (
            <div className={'result-points' + (pts.total > 0 ? ' has-points' : '') + (result.place === 1 ? ' place-1' : '')} title={pointsTitle}>
              {result.place === null
                ? <span className="state live"><i />В игре</span>
                : pts.total > 0
                  ? <><strong>+{format.format(pts.total)}</strong><small>очк.</small></>
                  : <small>—</small>}
            </div>
          )}

          {rating.mode === 'none' && isActive && <span className="state live"><i />В игре</span>}
        </div>
      </li>;
    })}
  </ol>;
}

type ResultFilter = 'all' | 'itm' | 'active' | 'out';

export function ResultsPanel({ data, busy, run, open }: { data: Snapshot; busy: boolean; run: Run; open?: (modal: Modal) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [postScope, setPostScope] = useState<'itm' | 'all'>('all');

  const entriesById = useMemo(() => new Map(data.entries.map(item => [item.playerId, item])), [data.entries]);
  const scheme = ratingSchemeOf(data.config);
  const totalEntries = data.stats.entered + data.stats.reentries;
  const rating = useMemo(
    () => calculateRating(scheme, totalEntries, data.stats.addons),
    [scheme, totalEntries, data.stats.addons],
  );
  const itmPlaces = rating.mode !== 'none' ? rating.payouts.length : 0;
  const totalKnockouts = data.results.reduce((sum, item) => sum + item.knockouts, 0);
  const maxKo = data.results.reduce((max, item) => Math.max(max, item.knockouts), 0);
  const koLeaders = maxKo > 0 ? data.results.filter(item => item.knockouts === maxKo) : [];
  const finishedCount = data.results.filter(item => item.place !== null).length;

  const visibleResults = useMemo(() => data.results.filter(result => {
    const entry = entriesById.get(result.playerId);
    if (!matchesQuery(query, [result.name, entry?.name ?? '', entry?.nickname ?? ''])) return false;
    if (filter === 'itm') return result.place !== null && result.place <= itmPlaces;
    if (filter === 'active') return result.place === null;
    if (filter === 'out') return result.place !== null;
    return true;
  }), [data.results, entriesById, query, filter, itmPlaces]);

  function buildPost() {
    setCopied(false);
    const ranked = data.results
      .filter(result => result.place !== null)
      .filter(result => postScope === 'all' || (itmPlaces > 0 && result.place! <= itmPlaces));
    const statsLine = [
      `Входов: ${totalEntries}`,
      data.stats.addons > 0 ? `Аддонов: ${data.stats.addons}` : '',
      data.config.knockout && totalKnockouts > 0 ? `Нокаутов: ${totalKnockouts}` : '',
    ].filter(Boolean).join(' · ');
    const lines = ranked.map(result => {
      const pts = pointsForResult(result, rating, totalKnockouts);
      const extras = [
        data.config.knockout && result.knockouts > 0 ? `${result.knockouts} КО` : '',
        rating.mode !== 'none' && pts.total > 0 ? `+${format.format(pts.total)} очк.` : '',
      ].filter(Boolean).join(' · ');
      return `${result.place}. ${result.name}${extras ? ' (' + extras + ')' : ''}`;
    });
    setDraft([data.tournament.name, statsLine, '', ...(lines.length ? lines : ['Финишировавших игроков пока нет'])].join('\n'));
  }

  return <section className="results-screen">
    <div className="section-head">
      <div>
        <h2>Места и вылеты</h2>
        <p>{finishedCount > 0 ? `Зафиксировано мест: ${finishedCount} из ${data.results.length}` : 'Итоговая таблица формируется по мере вылетов'}</p>
      </div>
      <button className="button" disabled={busy} onClick={() => run({ type: 'displayMode', mode: data.display.mode === 'results' ? 'clock' : 'results' })}><Monitor size={16} />
        {data.display.mode === 'results' ? 'Скрыть с ТВ' : 'Результаты на ТВ'}
      </button>
    </div>

    {data.results.length > 0 && <div className="results-totals" aria-label="Сводка результатов">
      <span><UsersRound size={15} /> В таблице <strong>{data.results.length}</strong></span>
      {itmPlaces > 0 && <span><Award size={15} /> Призовая зона <strong>Топ-{itmPlaces}</strong></span>}
      {data.config.knockout && <span><Crosshair size={15} /> Нокауты <strong>{totalKnockouts}</strong>
        {koLeaders.length > 0 && <small> · лидер: {koLeaders[0].name}{koLeaders.length > 1 ? ` +${koLeaders.length - 1}` : ''} ({maxKo})</small>}
      </span>}
    </div>}

    {data.results.length > 0 && <div className="results-toolbar actions">
      <SearchBox value={query} onChange={setQuery} placeholder="Ник или имя" />
      <label className="sr-only" htmlFor="filter-results-status">Фильтр результатов</label>
      <select id="filter-results-status" className="button" value={filter} onChange={event => setFilter(event.target.value as ResultFilter)}>
        <option value="all">Все участники</option>
        {itmPlaces > 0 && <option value="itm">Призовая зона (Топ-{itmPlaces})</option>}
        <option value="active">В игре</option>
        <option value="out">Зафиксированные места</option>
      </select>
    </div>}

    <section className="panel results-panel">
      <Results data={data} items={visibleResults} open={open} busy={busy} />
    </section>

    <div className="section-head">
      <h2>Призовая зона</h2>
      <button className="button" disabled={busy} onClick={() => run({ type: 'displayMode', mode: data.display.mode === 'payouts' ? 'clock' : 'payouts' })}><Monitor size={16} />
        {data.display.mode === 'payouts' ? 'Скрыть с ТВ' : 'Призовая зона на ТВ'}
      </button>
    </div>
    <section className="panel admin-pane"><Payouts data={data} /></section>

    <div className="section-head"><h2>Пост для Telegram</h2></div>
    <section className="panel admin-pane admin-form telegram-post">
      <div className="actions">
        {itmPlaces > 0 && <select className="button" aria-label="Кого включить в пост" value={postScope} onChange={event => setPostScope(event.target.value as 'itm' | 'all')}>
          <option value="all">Все места</option>
          <option value="itm">Только призовая зона (Топ-{itmPlaces})</option>
        </select>}
        <button className="button" type="button" onClick={buildPost}><Sparkles size={15} /> {draft ? 'Обновить пост' : 'Сформировать пост'}</button>
        {draft && <button className="button primary" type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(draft); setCopied(true); }
          catch { setCopied(false); }
        }}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Скопировано' : 'Копировать'}</button>}
      </div>
      {draft && <textarea aria-label="Текст поста" rows={8} value={draft} onChange={event => { setDraft(event.target.value); setCopied(false); }} />}
    </section>
  </section>;
}

