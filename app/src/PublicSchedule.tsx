import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { PublicSchedule as Schedule } from '../shared/model';
import { request } from './api';
import { Brand, Heading, State, format, money, startLabel } from './widgets';
import { OnlineRegistration } from './OnlineRegistration';
import { ThemeSwitch } from './Theme';

export function scheduleHref(club: string, tournament?: string) {
  const params = new URLSearchParams({ schedule: club });
  if (tournament) params.set('tournament', tournament);
  return location.pathname + '#' + params;
}

export function PublicSchedule({ club, tournament }: { club: string; tournament: string | null }) {
  const [schedule, setSchedule] = useState<Schedule>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    request<Schedule>('/api/public/clubs/' + encodeURIComponent(club) + '/schedule', { signal: controller.signal })
      .then(setSchedule).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [club]);
  const selected = schedule?.tournaments.find(item => item.id === tournament);
  return <main className="public-schedule">
    <header className="public-header"><Brand /><ThemeSwitch /></header>
    {!schedule && <h1>{error || 'Загружаем расписание'}</h1>}
    {schedule && (tournament ? <>
      <a className="back" href={scheduleHref(club)}><ArrowLeft size={15} /> Расписание клуба</a>
      {selected ? <>
        <Heading title={selected.name} subtitle={schedule.club.name + ' · ' + schedule.club.venue} state={<State tournament={selected} />} />
        <div className="panel admin-pane">
          <dl className="event-facts">
            <div><dt>Начало</dt><dd>{startLabel(selected.startsAt)}</dd></div>
            <div><dt>Формат</dt><dd>{selected.format}</dd></div>
            <div><dt>Вход</dt><dd>{money(selected.buyIn)}</dd></div>
            <div><dt>Стартовый стек</dt><dd>{format.format(selected.startStack)}</dd></div>
          </dl>
          {selected.description && <p className="event-description">{selected.description}</p>}
        </div>
        {selected.state !== 'finished' && <OnlineRegistration key={selected.id} club={club} tournament={selected.id} />}
      </> : <h1>Турнир недоступен</h1>}
    </> : <>
      <Heading title={'Расписание · ' + schedule.club.name} subtitle={schedule.club.venue} />
      <section className="panel schedule" aria-label="Расписание турниров">
        {schedule.tournaments.map(item => <a className="schedule-row" href={scheduleHref(club, item.id)} key={item.id}>
          <span><strong>{item.name}</strong><small>{startLabel(item.startsAt)}</small></span>
          <State tournament={item} /><ChevronRight size={17} />
        </a>)}
        {!schedule.tournaments.length && <p className="empty">В расписании пока нет турниров</p>}
      </section>
    </>)}
  </main>;
}
