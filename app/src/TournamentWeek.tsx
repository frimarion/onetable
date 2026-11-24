import { useState, type FormEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Snapshot } from '../shared/model';
import { inWeek, moscowInput, moscowIso, moveDate, scheduleKey, weekStart } from '../shared/schedule';
import type { Run } from './api';
import { Heading, startLabel } from './widgets';

type WeekRow = { sourceId: string; name: string; date: string; selected: boolean };

export function TournamentWeek({ data, busy, run, back }: { data: Snapshot; busy: boolean; run: Run; back: () => void }) {
  const currentWeek = weekStart(moscowInput(new Date(data.serverTime).toISOString()).slice(0, 10));
  const [sourceWeek, setSourceWeek] = useState(() => moveDate(currentWeek, -7));
  const [targetWeek, setTargetWeek] = useState(() => moveDate(currentWeek, 7));
  const [edits, setEdits] = useState<Record<string, Partial<WeekRow>>>({});
  const sources = data.schedule.flatMap(item => item.state !== 'draft' && item.startsAt && inWeek(item.startsAt, sourceWeek)
    ? [{ ...item, startsAt: item.startsAt }] : []).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.name.localeCompare(b.name, 'ru'));
  const rows = sources.map(item => {
    const local = moscowInput(item.startsAt);
    const day = Math.round((Date.parse(local.slice(0, 10)) - Date.parse(sourceWeek)) / 86_400_000);
    return { sourceId: item.id, name: item.name, date: moveDate(targetWeek, day) + local.slice(10), selected: true, ...edits[item.id] };
  });
  const existing = new Set(data.schedule.flatMap(item => item.startsAt ? [scheduleKey(item.name, item.startsAt)] : []));
  const votes = new Map<string, number>();
  for (const row of rows) {
    const iso = moscowIso(row.date);
    if (!iso || !row.selected) continue;
    const key = scheduleKey(row.name, iso);
    votes.set(key, (votes.get(key) ?? 0) + 1);
  }
  const selected = rows.filter(row => row.selected).map(row => {
    const startsAt = moscowIso(row.date);
    const key = startsAt && scheduleKey(row.name, startsAt);
    const problem = !row.name.trim() ? 'Укажите название.' : !startsAt || !inWeek(startsAt, targetWeek) ? 'Выберите дату в неделе назначения.'
      : key && (existing.has(key) || (votes.get(key) ?? 0) > 1) ? 'Турнир с этим названием уже есть на это время.' : '';
    return { sourceId: row.sourceId, name: row.name, startsAt, problem };
  });
  const canSave = !busy && targetWeek > sourceWeek && selected.length > 0 && selected.length <= 100 && !selected.some(row => row.problem);

  function changeWeek(value: string, setter: (value: string) => void) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    setter(weekStart(value));
    setEdits({});
  }
  function edit(id: string, patch: Partial<WeekRow>) {
    setEdits(current => ({ ...current, [id]: { ...current[id], ...patch } }));
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    const publish = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'publish';
    const tournaments = selected.flatMap(({ sourceId, name, startsAt }) => startsAt ? [{ sourceId, name, startsAt }] : []);
    void run({ type: 'copyTournamentWeek', sourceWeek, targetWeek, tournaments, publish }, back);
  }
  return <div className="tournament-editor tournament-week">
    <button className="back" disabled={busy} onClick={back}><ArrowLeft size={15} /> Все турниры</button>
    <Heading title="Создать неделю" subtitle={data.club.name + ' · ' + data.club.venue} actions={<>
      <button className="button" type="submit" form="week-copy" disabled={!canSave}>Сохранить черновики</button>
      <button className="button primary" type="submit" form="week-copy" value="publish" disabled={!canSave}>Опубликовать неделю</button>
    </>} />
    <form id="week-copy" className="admin-form" onSubmit={save}>
      <section className="panel admin-pane editor-section">
        <div className="fields-grid">
          <label>Неделя-образец (дата с понедельника)<input type="date" value={sourceWeek} disabled={busy}
            onChange={event => changeWeek(event.target.value, setSourceWeek)} /></label>
          <label>Новая неделя (дата с понедельника)<input type="date" value={targetWeek} disabled={busy}
            onChange={event => changeWeek(event.target.value, setTargetWeek)} /></label>
        </div>
        {targetWeek <= sourceWeek && <p className="alert" role="status">Выберите неделю позже исходной.</p>}
        <p className="muted">Скопируются настройки, блайнды и столы выбранных турниров. Время указано по Москве.</p>
      </section>
      <section className="panel admin-pane editor-section" aria-label="Турниры для копирования">
        <h2>Турниры для копирования <span className="muted">· {selected.length}</span></h2>
        {!rows.length && <p className="muted">На этой неделе нет опубликованных турниров с датой. Выберите другую неделю.</p>}
        {selected.length > 100 && <p className="alert" role="status">За один раз можно скопировать до 100 турниров.</p>}
        {rows.map((row, index) => {
          const problem = selected.find(item => item.sourceId === row.sourceId)?.problem;
          return <div className="week-row" key={row.sourceId}>
            <label className="attendance-check"><input type="checkbox" checked={row.selected} disabled={busy}
              aria-label={'Копировать ' + sources[index].name + ' · ' + startLabel(sources[index].startsAt)}
              onChange={event => edit(row.sourceId, { selected: event.target.checked })} /> Копировать</label>
            <div className="fields-grid">
              <label>Название турнира<input value={row.name} maxLength={80} required disabled={busy || !row.selected}
                onChange={event => edit(row.sourceId, { name: event.target.value })} /></label>
              <label>Дата и время (МСК)<input type="datetime-local" value={row.date} required disabled={busy || !row.selected}
                min={targetWeek + 'T00:00'} max={moveDate(targetWeek, 6) + 'T23:59'}
                onChange={event => edit(row.sourceId, { date: event.target.value })} /></label>
            </div>
            {problem && <p className="alert" role="status">{problem}</p>}
          </div>;
        })}
      </section>
    </form>
  </div>;
}
