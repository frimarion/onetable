import { useState } from 'react';
import type { Snapshot } from '../shared/model';
import type { Run } from './api';
import type { Modal } from './crm';
import { Person } from './widgets';

const blockedLabels = {
  closed: 'Регистрация закрыта.',
  arrival: 'Отметьте пришедших игроков. Посадка идёт по очереди среди тех, кто уже на месте.',
  full: 'Свободных мест нет. Подтверждённые записи тоже занимают места.',
  unseated: 'Сначала рассадите игроков, которых уже допустили к игре.',
};

export function Waitlist({ data, run, busy, open }: { data: Snapshot; run: Run; busy: boolean; open: (modal: Modal) => void }) {
  const [arrival, setArrival] = useState<{ playerId: string; arrived: boolean }>();
  const { people, canAdmit, blocked } = data.waitlist;
  if (!people.length) return null;
  const scheduled = data.tournament.state === 'scheduled';
  const finished = data.tournament.state === 'finished';
  const next = people.find(person => scheduled || person.arrived);
  return <section className="panel waitlist" aria-labelledby="waitlist-title">
    <div className="panel-head"><h2 id="waitlist-title">Лист ожидания</h2><span className="count">{people.length}</span></div>
    {blocked && <p className="muted waitlist-note">{blockedLabels[blocked]}</p>}
    {people.map((person, index) => <div key={person.playerId} className="person-row waitlist-row">
      <Person name={person.name} nickname={person.nickname} detail={'№ ' + (index + 1) + ' в очереди'} />
      <div className="actions">
        <label className="attendance-check"><input type="checkbox" checked={arrival?.playerId === person.playerId ? arrival.arrived : person.arrived}
          aria-label={'Пришёл в листе ожидания: ' + person.name} disabled={busy || finished}
          onChange={event => {
            const update = { playerId: person.playerId, arrived: event.target.checked };
            setArrival(update);
            void run({ type: 'setWaitlistArrival', ...update }).finally(() => setArrival(undefined));
          }} /> Пришёл</label>
        {person === next && !finished && <button className={canAdmit ? 'button compact primary' : 'button compact'} disabled={busy || !canAdmit}
          onClick={() => void run({ type: 'admitWaitlist', playerId: person.playerId })}>
          {scheduled ? 'Подтвердить запись' : data.config.seating ? 'Посадить' : 'Допустить к игре'}
        </button>}
        {person === next && data.tournament.state === 'live' && data.config.seating && canAdmit && <button className="button compact" disabled={busy}
          onClick={() => open({ mode: 'admitSeat', player: person })}>
          Выбрать бокс
        </button>}
        {!finished && <button className="button compact" disabled={busy} onClick={() => open({
          mode: 'confirm', title: 'Убрать из листа ожидания?', message: person.name,
          label: 'Убрать из очереди', action: { type: 'removeWaitlist', playerId: person.playerId },
        })}>Убрать</button>}
      </div>
    </div>)}
  </section>;
}
