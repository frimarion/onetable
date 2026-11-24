import { useState, type FormEvent } from 'react';
import type { Entry, Snapshot } from '../shared/model';
import type { Run } from './api';
import { AddonControls } from './AddonControls';
import { TimerControls } from './TournamentControls';
import type { Modal } from './crm';
import { Heading, Person, SearchBox, State, Timer, pad, startLabel } from './widgets';
import { matchesQuery } from '../shared/search';

function Reentry({ entry, data, busy, run }: { entry: Entry; data: Snapshot; busy: boolean; run: Run }) {
  if (data.tournament.state !== 'live' || entry.status === 'registered') return null;
  return <button className="button compact" disabled={busy} onClick={() => void run(entry.status === 'out'
    ? { type: 'reenter', playerId: entry.playerId }
    : { type: 'adjustReentry', playerId: entry.playerId, delta: 1, expectedReentries: entry.reentries })}>
    {entry.status === 'out' ? 'Вернуть по реэнтри' : 'Реэнтри +1'}
  </button>;
}

export function StaffTournament({ data, tableNo, busy, run, setId, open }: {
  data: Snapshot; tableNo: number | null; busy: boolean; run: Run;
  setId: (id: string) => void; open: (modal: Modal) => void;
}) {
  const [query, setQuery] = useState('');
  const floor = data.role === 'floor';
  const table = data.tables.find(item => item.number === tableNo);
  const live = data.tournament.state === 'live';
  const emptySeats = Array.from({ length: table?.capacity ?? 0 }, (_, index) => index + 1)
    .filter(seat => !data.entries.some(entry => entry.seatNo === seat));
  const entries = floor ? data.entries.filter(entry => entry.status !== 'registered' && matchesQuery(query, [entry.name, entry.nickname]))
    : data.entries.slice().sort((a, b) => (a.seatNo ?? 99) - (b.seatNo ?? 99));

  function seat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const playerId = String(fields.get('player') ?? '');
    const seatNo = Number(fields.get('seat'));
    const name = String(fields.get('name') ?? '').trim();
    if (!playerId && !name) return;
    void run(playerId ? { type: 'dealerSeat', playerId, seatNo } : { type: 'dealerSeat', name, seatNo }, () => form.reset());
  }

  return <>
    <Heading title={floor ? 'Управление турниром' : tableNo ? 'Стол ' + pad(tableNo) : 'Планшет дилера'}
      subtitle={data.club.name} state={<State tournament={data.tournament} />} />
    <label className="inline-field staff-tournament-select">Турнир<select className="button" value={data.tournament.id} disabled={busy} onChange={event => setId(event.target.value)}>
      {data.schedule.map(item => <option key={item.id} value={item.id}>{item.name} · {startLabel(item.startsAt)}</option>)}
    </select></label>
    {!floor && !table && <p className="empty">{tableNo ? 'В этом турнире назначенный стол недоступен.' : 'Попросите владельца назначить вам стол.'}</p>}
    {(floor || table) && <div className="dealer-content">
      <section className="panel roster">
        <div className="panel-head"><h2>{floor ? 'Игроки турнира' : 'Игроки стола'}</h2>{floor && <SearchBox value={query} onChange={setQuery} placeholder="Ник или имя" />}</div>
        {entries.length ? entries.map(entry => <div className="person-row dealer-row" key={entry.playerId}>
          <Person name={entry.name} nickname={entry.nickname} detail={[
            entry.status === 'out' ? 'Вылетел' : entry.seatNo ? (!floor ? 'Место ' + entry.seatNo : 'Стол ' + entry.tableNo + ' · Место ' + entry.seatNo) : 'В игре',
            'Реэнтри ' + entry.reentries,
          ].join(' · ')} />
          <div className="actions">
            <Reentry entry={entry} data={data} busy={busy} run={run} />
            {!floor && <AddonControls entry={entry} data={data} busy={busy || entry.status !== 'active'} run={run} showPrice={false} />}
            {!floor && live && entry.status === 'active' && <label className="sr-only" htmlFor={'move-' + entry.playerId}>Пересадить {entry.nickname || entry.name}</label>}
            {!floor && live && entry.status === 'active' && <select id={'move-' + entry.playerId} className="button compact" value="" disabled={busy} onChange={event => {
              const seatNo = Number(event.target.value);
              if (!seatNo) return;
              const other = data.entries.find(item => item.seatNo === seatNo);
              void run(other ? { type: 'swapSeats', playerId: entry.playerId, withPlayerId: other.playerId } : { type: 'dealerSeat', playerId: entry.playerId, seatNo });
            }}>
              <option value="">Пересадить</option>
              {Array.from({ length: table?.capacity ?? 0 }, (_, index) => index + 1).filter(seat => seat !== entry.seatNo).map(seat => {
                const occupant = data.entries.find(item => item.seatNo === seat);
                return <option key={seat} value={seat}>{seat} · {occupant ? 'Обмен с ' + (occupant.nickname || occupant.name) : 'Свободно'}</option>;
              })}
            </select>}
          </div>
        </div>) : <p className="empty">Игроков пока нет</p>}
        {!floor && live && emptySeats.length > 0 && <form className="admin-form admin-pane" onSubmit={seat}>
          <h3>Посадить игрока</h3>
          {Boolean(data.dealerQueue?.length) && <label>Записанный игрок<select name="player" disabled={busy}>
            <option value="">Выберите игрока или введите имя ниже</option>
            {data.dealerQueue?.map(item => <option key={item.playerId} value={item.playerId}>{item.nickname ? item.nickname + ' · ' : ''}{item.name}</option>)}
          </select></label>}
          <label>Имя нового игрока<input name="name" maxLength={80} disabled={busy} required={!data.dealerQueue?.length} /></label>
          <label>Свободное место<select name="seat" required disabled={busy}>{emptySeats.map(seatNo => <option key={seatNo} value={seatNo}>{seatNo}</option>)}</select></label>
          <button className="button primary" disabled={busy}>Посадить</button>
        </form>}
      </section>
      {floor ? <TimerControls data={data} busy={busy} run={run} open={open} floor />
        : <section className="panel timer-panel"><h2>Таймер турнира</h2><Timer data={data} /></section>}
    </div>}
  </>;
}
