import { useState, type FormEvent } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import type { Snapshot, TournamentDefinition } from '../shared/model';
import { defaultConfig, formats, playingLevel } from '../shared/operations';
import { moscowInput, moscowIso } from '../shared/schedule';
import type { Run } from './api';
import { ConfigFields } from './TournamentFields';
import { StructureFields } from './StructureFields';
import { Heading, State, format } from './widgets';
import { scheduleHref } from './PublicSchedule';

const newConfig = { ...defaultConfig, seating: false };

export function TournamentEditor({ data, creating, busy, run, back, created, published }: {
  data: Snapshot; creating: boolean; busy: boolean; run: Run;
  back: () => void; created: () => void; published: () => void;
}) {
  const tournament = data.tournament;
  const draft = !creating && tournament.state === 'draft';
  const live = !creating && tournament.state === 'live';
  const [name, setName] = useState(creating ? '' : tournament.name);
  const [description, setDescription] = useState(creating ? '' : tournament.description);
  const [date, setDate] = useState(!creating && tournament.startsAt ? moscowInput(tournament.startsAt) : '');
  const [layout, setLayout] = useState(creating ? 'base:Deepstack' : tournament.layout ?? '');
  const [config, setConfig] = useState(creating ? newConfig : data.config);
  const [structure, setStructure] = useState(creating ? formats.Deepstack : data.structure);
  const [layoutName, setLayoutName] = useState('');
  const definition: TournamentDefinition = {
    name, description, startsAt: moscowIso(date), layout: layout || null, config, structure,
  };
  const current = JSON.stringify(definition);
  const [saved, setSaved] = useState(current);
  const dirty = current !== saved;
  const missingLayout = layout.startsWith('club:') && !data.presets.some(preset => 'club:' + preset.name === layout);
  const existingLayout = data.presets.some(item => item.name === layoutName.trim());
  const publicationReady = Boolean(tournament.startsAt) && !dirty;

  function applyLayout(value: string) {
    setLayout(value);
    if (!value) return;
    const label = value.slice(5);
    const preset = data.presets.find(item => item.name === label);
    const next = value.startsWith('base:') ? formats[label] : preset?.structure;
    if (!next) return;
    const rules = { ...newConfig, format: label, ...(value.startsWith('club:') ? preset?.config : null) };
    setStructure(next);
    setConfig({ ...rules, lateRegistration: Math.min(rules.lateRegistration, playingLevel(next, next.length - 1)) });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const publish = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'publish';
    if (creating) void run({ type: 'createTournament', ...definition, publish }, created);
    else void run({ type: 'updateTournament', ...definition }, () => setSaved(current));
  }

  return <div className="tournament-editor">
    <button className="back" disabled={busy} onClick={back}><ArrowLeft size={15} /> {creating || draft ? 'Все турниры' : 'К управлению турниром'}</button>
    <Heading title={creating ? 'Новый турнир' : draft ? tournament.name : 'Редактирование турнира'} subtitle={data.club.name + ' · ' + data.club.venue}
      state={!creating && <State tournament={tournament} />}
      actions={<>
        {draft && <button className="button" disabled={busy || !publicationReady}
          onClick={() => run({ type: 'publishTournament' }, published)}>Опубликовать</button>}
        {!creating && !draft && <a className="button" href={scheduleHref(data.club.id, tournament.id)} target="_blank" rel="noreferrer">
          В расписании <ExternalLink size={15} />
        </a>}
        <button className={creating ? 'button' : 'button primary'} type="submit" form="tournament-editor" disabled={busy || (!creating && !dirty)}>
          {creating || draft ? 'Сохранить черновик' : 'Сохранить изменения'}
        </button>
        {creating && <button className="button primary" type="submit" form="tournament-editor" value="publish" disabled={busy}>Опубликовать</button>}
      </>} />
    {draft && !publicationReady && <p className="editor-note muted">{date ? 'Сохраните изменения перед публикацией.' : 'Для публикации укажите дату и время.'}</p>}
    <form id="tournament-editor" className="admin-form" onSubmit={save}>
      <fieldset disabled={busy}>
        <div className={live ? undefined : 'editor-overview'}>
          <section className="panel admin-pane editor-section" aria-labelledby="event-details">
            <h2 id="event-details">О турнире</h2>
            <div className="fields-grid">
              <label>Название турнира<input value={name} required maxLength={80} onChange={event => setName(event.target.value)} /></label>
              <label>Дата и время (МСК)<input type="datetime-local" value={date} min="2000-01-01T00:00" max="9999-12-31T23:59"
                required={!creating && !draft && !!tournament.startsAt} onChange={event => setDate(event.target.value)} /></label>
            </div>
            <label>Описание для расписания<textarea value={description} maxLength={1000} rows={3} onChange={event => setDescription(event.target.value)} /></label>
          </section>
          {!live && <section className="panel admin-pane editor-section" aria-labelledby="event-layout">
            <h2 id="event-layout">Клубный макет</h2>
            <label>Макет турнира<select value={layout} onChange={event => applyLayout(event.target.value)}>
              <option value="">Свои настройки</option>
              <optgroup label="Клубные макеты">
                {data.presets.map(item => <option key={item.name} value={'club:' + item.name}>{item.name}</option>)}
                {missingLayout && <option value={layout}>{layout.slice(5)} (удалён)</option>}
              </optgroup>
              <optgroup label="Стандартные макеты">
                {Object.keys(formats).map(item => <option key={item} value={'base:' + item}>{item}</option>)}
              </optgroup>
            </select></label>
            <p className="muted">Выбор макета заполняет параметры и уровни. Их можно изменить для этого турнира.</p>
            <dl className="event-facts layout-facts">
              <div><dt>Уровней</dt><dd>{playingLevel(structure, structure.length - 1)}</dd></div>
              <div><dt>Первые блайнды</dt><dd>{format.format(structure[0].small)} / {format.format(structure[0].big)}</dd></div>
            </dl>
          </section>}
        </div>
        <section className="panel admin-pane editor-section editor-rules" aria-labelledby="event-rules">
          <h2 id="event-rules">Параметры турнира</h2>
          <ConfigFields key={layout} config={config} setConfig={setConfig} levelCount={playingLevel(structure, structure.length - 1)} ratingPresets={data.ratingPresets} />
          {!live && <div className="check-grid"><label><input type="checkbox" checked={config.seating}
            onChange={event => setConfig({ ...config, seating: event.target.checked })} /> Столы и рассадка</label></div>}
        </section>
        <section className="panel admin-pane editor-section" aria-labelledby="event-blinds">
          <h2 id="event-blinds">Структура блайндов</h2>
          {live && <p className="muted">Текущий и сыгранные уровни закреплены.</p>}
          <StructureFields structure={structure} setStructure={setStructure} fixed={live ? data.clock.level + 1 : 0} busy={busy}
            anteEnabled={config.anteEnabled} setAnteEnabled={anteEnabled => setConfig(current => ({ ...current, anteEnabled }))} />
        </section>
      </fieldset>
    </form>
    {!creating && !live && <form className="panel admin-pane admin-form editor-section" onSubmit={event => {
      event.preventDefault();
      void run({ type: 'savePreset', name: layoutName, structure, config }, () => setLayoutName(''));
    }}>
      <label>Название клубного макета<input value={layoutName} required maxLength={40} onChange={event => setLayoutName(event.target.value)} /></label>
      <button className="button" disabled={busy}>{existingLayout ? 'Обновить клубный макет' : 'Сохранить как клубный макет'}</button>
    </form>}
  </div>;
}
