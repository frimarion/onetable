import type { CSSProperties } from 'react';
import { registrationOpen } from '../shared/operations';
import type { Snapshot } from '../shared/model';
import { Payouts, Results } from './TournamentControls';
import { State, Timer, format, pad } from './widgets';
import { ThemeSwitch } from './Theme';

export function Display({ data, error }: { data: Snapshot; error: string }) {
  const chips = (data.stats.entered + data.stats.reentries) * data.config.startStack + data.stats.addonChips;
  return <main className="display standalone" style={{ '--club-accent': data.club.accent } as CSSProperties}>
    <div className="display-theme"><ThemeSwitch /></div>
    <span className="display-brand">{data.club.name}</span>
    <h1>{data.tournament.name}</h1>
    <div className="actions"><State tournament={data.tournament} />{data.display.finalTable && <span className="state live">Финальный стол</span>}</div>
    {data.display.mode === 'clock' && <>
      <Timer data={data} />
      <p>В игре {data.stats.active} · Входов {data.stats.entered + data.stats.reentries}</p>
      {data.stats.active > 0 && <p>Средний стек {format.format(Math.round(chips / data.stats.active))} · Фишек в игре {format.format(chips)}</p>}
      {data.config.lateRegistration > 0 && <p>{registrationOpen(data.config, data.structure, data.clock.level) ? 'Поздняя регистрация открыта' : 'Поздняя регистрация закрыта'}</p>}
      {data.config.bonusHand && <p>Бонусная рука: {data.config.bonusHand}</p>}
      {data.config.comment && <p>{data.config.comment}</p>}
    </>}
    {data.display.mode === 'seating' && <>
      <h2>Рассадка</h2>
      <div className="display-tables">{data.tables.map(table =>
        <section className="panel admin-pane" key={table.number}>
          <h3>Стол {pad(table.number)}</h3>
          <ol className="display-seats">{Array.from({ length: table.capacity }, (_, index) => {
            const entry = data.entries.find(player => player.tableNo === table.number && player.seatNo === index + 1);
            return <li key={index}><span>{index + 1}</span><strong>{entry?.name ?? 'Свободно'}</strong></li>;
          })}</ol>
        </section>)}</div>
    </>}
    {data.display.mode === 'payouts' && <><h2>Призовая зона</h2><Payouts data={data} /></>}
    {data.display.mode === 'results' && <><h2>Результаты</h2><Results data={data} /></>}
    {error && <p role="status">Связь прервана. Показано последнее состояние.</p>}
  </main>;
}

