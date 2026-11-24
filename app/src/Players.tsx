import { useState } from 'react';
import { ChevronRight, RotateCcw, X } from 'lucide-react';
import type { Entry, Snapshot, Status } from '../shared/model';
import { matchesQuery } from '../shared/search';
import type { Run } from './api';
import { bustModal, cancelEntry, type Modal } from './crm';
import { Person, SearchBox, entryDetail } from './widgets';
import { AddonControls } from './AddonControls';

export function Players({ data, busy, open, run }: { data: Snapshot; busy: boolean; run: Run; open: (modal: Modal) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [pending, setPending] = useState<{ playerId: string; checked: boolean }>();
  const live = data.tournament.state === 'live';
  const canMark = data.tournament.state !== 'finished';
  const places = new Map(data.results.map(item => [item.playerId, item.place]));
  const filtered = data.entries.filter(entry => (status === 'all' || entry.status === status)
    && matchesQuery(query, [entry.name, entry.nickname]))
    .sort((a, b) => Number(a.status === 'out') - Number(b.status === 'out'));

  function mark(playerId: string, checked: boolean) {
    setPending({ playerId, checked });
    void run({ type: checked ? 'checkIn' : 'checkOut', playerId }).finally(() => setPending(undefined));
  }
  function adjust(entry: Entry, delta: 1 | -1) {
    open({ mode: 'confirm', title: delta === 1 ? 'Подтвердить реэнтри?' : 'Отменить реэнтри?',
      message: entry.name + ' · всего входов после изменения: ' + (1 + entry.reentries + delta),
      label: delta === 1 ? 'Подтвердить реэнтри' : 'Отменить реэнтри',
      action: { type: 'adjustReentry', playerId: entry.playerId, delta, expectedReentries: entry.reentries } });
  }
  return <section className="players-section">
    <div className="section-head">
      <h2>Игроки турнира</h2>
      {canMark && <button className="button" onClick={() => open({ mode: 'import' })}>Импорт списка</button>}
    </div>
    <div className="player-tools actions">
      <SearchBox value={query} onChange={setQuery} placeholder="Ник или имя" />
      <label className="sr-only" htmlFor="filter-player-status">Статус игрока</label>
      <select id="filter-player-status" className="button" value={status} onChange={event => setStatus(event.target.value as typeof status)}>
        <option value="all">Все статусы</option><option value="registered">Ожидают прихода</option><option value="active">В игре</option><option value="out">Вылетели</option>
      </select>
    </div>
    <div className="panel attendance-list">
      {filtered.map(entry => {
        const present = entry.status !== 'registered';
        const queued = pending?.playerId === entry.playerId ? pending : undefined;
        const marked = queued?.checked ?? present;
        const place = places.get(entry.playerId);
        const detail = [
          entryDetail(entry, data.config.seating) + (entry.status === 'out' && place ? ' · ' + place + ' место' : ''),
          data.config.knockout && present && (entry.knockouts > 0 || entry.status === 'out') ? 'Нокауты: ' + entry.knockouts : '',
        ].filter(Boolean).join(' · ');
        return <article className="attendance-row" aria-label={entry.name} key={entry.playerId}>
          <button className="cash-person full-row attendance-player" onClick={() => open({ mode: 'entry', entry })}>
            <Person name={entry.name} nickname={entry.nickname} photoUrl={entry.photoUrl} detail={detail} />
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <div className="attendance-controls">
            <label className="attendance-check">
              <input type="checkbox" aria-label={'Пришёл: ' + entry.name} checked={marked} disabled={busy || !canMark}
                onChange={event => mark(entry.playerId, event.target.checked)} />
              <span>Пришёл</span>
            </label>
            <div className="attendance-reentries" role="group" aria-label={'Реэнтри: ' + entry.name}>
              <button className="button attendance-step" disabled={busy || !live || !present || entry.reentries === 0}
                aria-label={'Уменьшить реэнтри: ' + entry.name} onClick={() => adjust(entry, -1)}>R−</button>
              <span aria-label={'Реэнтри: ' + entry.reentries}>{entry.reentries}</span>
              <button className="button attendance-step" disabled={busy || !live || !present}
                aria-label={'Добавить реэнтри: ' + entry.name} onClick={() => adjust(entry, 1)}>R+</button>
            </div>
            <AddonControls entry={entry} data={data} busy={busy} run={run} />
          </div>
          {canMark && !present && <button type="button" className="button icon attendance-outcome attendance-remove" disabled={busy}
            aria-label={'Отменить запись: ' + entry.name} title="Отменить запись"
            onClick={() => open(cancelEntry(entry))}><X size={17} aria-hidden="true" /></button>}
          {live && entry.status === 'active' && <button className="button compact attendance-outcome attendance-bust" disabled={busy}
              aria-label={'Подтвердить вылет: ' + entry.name} onClick={() => open(bustModal(entry, data))}>Вылет</button>}
            {live && entry.status === 'out' && <div className="actions attendance-outcome">
              <button className="button compact" disabled={busy} onClick={() => open({ mode: 'entry', entry })}>Исправить</button>
              <button className="button compact" disabled={busy} onClick={() => open({
                mode: 'confirm', title: 'Вернуть игрока по реэнтри?', message: entry.name + ' · всего входов после возвращения: ' + (entry.reentries + 2),
                label: 'Вернуть в игру', action: { type: 'reenter', playerId: entry.playerId },
              })}><RotateCcw size={15} /> Реэнтри</button>
            </div>}
            {!canMark && entry.status === 'out' && <button className="button compact attendance-outcome" disabled={busy}
              onClick={() => open({ mode: 'entry', entry })}>Исправить</button>}
        </article>;
      })}
      {!filtered.length && <p className="empty">Игроки не найдены</p>}
    </div>
  </section>;
}

