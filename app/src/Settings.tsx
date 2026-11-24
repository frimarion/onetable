import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy } from 'lucide-react';
import { formats, playingLevel } from '../shared/operations';
import type { Snapshot } from '../shared/model';
import type { Run } from './api';
import { ConfigFields } from './TournamentFields';
import { StructureFields } from './StructureFields';
import { scheduleHref } from './PublicSchedule';

export function Settings({ data, run, busy }: { data: Snapshot; run: Run; busy: boolean }) {
  const [config, setConfig] = useState(data.config);
  const [pendingSeating, setPendingSeating] = useState<boolean>();
  const seating = pendingSeating ?? data.config.seating;
  const [name, setName] = useState(data.tournament.name);
  const [structure, setStructure] = useState(data.structure);
  const [anteEnabled, setAnteEnabled] = useState(data.config.anteEnabled);
  const [preset, setPreset] = useState('base:Deepstack');
  const [presetName, setPresetName] = useState('');
  const [manual, setManual] = useState(data.manualStats);
  const [copy, setCopy] = useState('');

  const serverConfigKey = JSON.stringify({ name: data.tournament.name, config: data.config });
  const localConfigKey = JSON.stringify({ name, config });
  const syncedConfig = useRef(serverConfigKey);
  const configDirty = localConfigKey !== syncedConfig.current;
  const configOutdated = configDirty && serverConfigKey !== syncedConfig.current;

  const serverStructureKey = JSON.stringify({ structure: data.structure, anteEnabled: data.config.anteEnabled });
  const localStructureKey = JSON.stringify({ structure, anteEnabled });
  const syncedStructure = useRef(serverStructureKey);
  const structureDirty = localStructureKey !== syncedStructure.current;
  const structureOutdated = structureDirty && serverStructureKey !== syncedStructure.current;

  const serverManualKey = JSON.stringify(data.manualStats);
  const localManualKey = JSON.stringify(manual);
  const syncedManual = useRef(serverManualKey);

  useEffect(() => {
    if (serverConfigKey !== syncedConfig.current && !configDirty) {
      syncedConfig.current = serverConfigKey;
      setName(data.tournament.name);
      setConfig(data.config);
    }
  }, [serverConfigKey, configDirty, data.tournament.name, data.config]);

  useEffect(() => {
    if (serverStructureKey !== syncedStructure.current && !structureDirty) {
      syncedStructure.current = serverStructureKey;
      setStructure(data.structure);
      setAnteEnabled(data.config.anteEnabled);
    }
  }, [serverStructureKey, structureDirty, data.structure, data.config.anteEnabled]);

  useEffect(() => {
    if (serverManualKey !== syncedManual.current && localManualKey === syncedManual.current) {
      syncedManual.current = serverManualKey;
      setManual(data.manualStats);
    }
  }, [serverManualKey, localManualKey, data.manualStats]);

  const finished = data.tournament.state === 'finished';
  const activePreset = preset.startsWith('base:') ? { structure: formats[preset.slice(5)], config: null }
    : data.presets.find(item => item.name === preset.slice(5));
  const live = data.tournament.state === 'live';
  const fixed = live ? data.clock.level + 1 : 0;
  function save(event: FormEvent) {
    event.preventDefault();
    void run({ type: 'saveConfig', name, config }, () => { syncedConfig.current = localConfigKey; });
  }
  const link = new URL(window.location.href);
  link.hash = new URLSearchParams({ session: data.club.id + '-display', tournament: data.tournament.id }).toString();
  return <>
    <div className="section-head"><h2>Настройки турнира</h2></div>
    <section className="panel admin-pane seating-setting" aria-label="Режим турнира">
      <div><h3>Столы и рассадка</h3><p className="muted">{seating
        ? 'Назначения мест сохраняются, если отключить рассадку.'
        : 'Сейчас турнир ведётся по списку игроков.'}</p></div>
      <label className="attendance-check">
        <input type="checkbox" aria-label="Столы и рассадка" checked={seating} disabled={busy || finished}
          onChange={event => {
            const enabled = event.target.checked;
            setPendingSeating(enabled);
            void run({ type: 'setSeatingEnabled', enabled }).finally(() => setPendingSeating(undefined));
          }} />
        <span>{seating ? 'Включены' : 'Включить'}</span>
      </label>
    </section>
    <section className="panel admin-pane roster" aria-label="Параметры турнира">
      <form className="admin-form" onSubmit={save}>
        {configOutdated && <div className="alert" role="status">
          Настройки изменились в другой вкладке.
          {' '}<button type="button" className="button compact" onClick={() => {
            syncedConfig.current = serverConfigKey;
            setName(data.tournament.name);
            setConfig(data.config);
          }}>Загрузить актуальные</button>
        </div>}
        <div className="fields-grid">
          <label>Название турнира<input value={name} required maxLength={80} onChange={event => setName(event.target.value)} /></label>
        </div>
        <ConfigFields config={config} setConfig={setConfig} levelCount={playingLevel(data.structure, data.structure.length - 1)} ratingPresets={data.ratingPresets} />
        <div><button className="button primary" disabled={busy || !configDirty}>Сохранить настройки</button></div>
      </form>
    </section>
    {!finished && !data.entries.length && <>
      <div className="section-head"><h2>Счётчики без списка игроков</h2></div>
      <section className="panel admin-pane">
        <form className="admin-form" onSubmit={event => { event.preventDefault(); void run({ type: 'setManualStats', stats: manual }, () => { syncedManual.current = localManualKey; }); }}>
          <div className="fields-grid">
            {([['entered','Игроков'], ['reentries','Реэнтри'], ['out','Вылетело']] as const).map(([key, label]) => <label key={key}>
              {label}<input type="number" required min="0" max={key === 'entered' ? 500 : key === 'reentries' ? 1000 : manual.entered + manual.reentries} value={manual[key]}
                onChange={event => setManual(current => ({ ...current, [key]: Number(event.target.value) }))} />
            </label>)}
          </div>
          <button className="button" disabled={busy}>Сохранить счётчики</button>
        </form>
      </section>
    </>}
    <div className="section-head"><div><h2>Структура блайндов</h2>{live && <p>Текущий и сыгранные уровни закреплены.</p>}</div></div>
    <section className="panel admin-pane" aria-label="Структура блайндов">
      <form className="admin-form" onSubmit={event => { event.preventDefault(); void run({ type: 'saveStructure', structure, anteEnabled }, () => { syncedStructure.current = localStructureKey; }); }}>
        {structureOutdated && <div className="alert" role="status">
          Структура изменилась в другой вкладке.
          {' '}<button type="button" className="button compact" onClick={() => {
            syncedStructure.current = serverStructureKey;
            setStructure(data.structure);
            setAnteEnabled(data.config.anteEnabled);
          }}>Загрузить актуальную</button>
        </div>}
        {!live && !finished && <div className="actions">
          <label className="inline-field">Шаблон<select value={preset} onChange={event => setPreset(event.target.value)}>
                        {Object.keys(formats).map(label => <option key={label} value={'base:' + label}>{label}</option>)}
            {data.presets.map(item => <option key={item.name} value={'user:' + item.name}>{item.name}</option>)}
          </select></label>
          <button type="button" className="button" disabled={busy || !activePreset} onClick={() => {
            if (!activePreset) return;
            setStructure(activePreset.structure.map(level => ({ ...level })));
            setAnteEnabled(activePreset.config?.anteEnabled ?? true);
          }}>Загрузить шаблон</button>
          {preset.startsWith('user:') && activePreset && <button type="button" className="button" disabled={busy} onClick={() => run({ type: 'deletePreset', name: preset.slice(5) }, () => setPreset('base:Deepstack'))}>Удалить шаблон</button>}
        </div>}
        <StructureFields structure={structure} setStructure={setStructure} fixed={fixed} finished={finished} busy={busy}
          anteEnabled={anteEnabled} setAnteEnabled={setAnteEnabled} />
        {!finished && <div className="actions">
          <button className="button primary" disabled={busy || !structureDirty}>Сохранить структуру</button>
        </div>}
      </form>
    </section>
    {!finished && <form className="panel admin-pane admin-form roster" onSubmit={event => {
      event.preventDefault();
      void run({ type: 'savePreset', name: presetName, structure, anteEnabled }, () => { setPreset('user:' + presetName.trim()); setPresetName(''); });
    }}>
      <label>Название шаблона<input value={presetName} required maxLength={40} onChange={event => setPresetName(event.target.value)} /></label>
      <button className="button" disabled={busy}>Сохранить структуру как шаблон</button>
    </form>}
    <div className="section-head"><h2>Ссылки</h2></div>
    <div className="panel admin-pane"><div className="actions">
      {([['Админка', window.location.href], ['ТВ-дисплей', link.href]] as const).map(([label, href]) => <button className="button" key={label} onClick={async () => {
        try { await navigator.clipboard.writeText(href); setCopy(label + ' · ссылка скопирована'); }
        catch { setCopy(href); }
      }}><Copy size={16} /> {label}</button>)}
      <a className="button" href={scheduleHref(data.club.id, data.tournament.id)} target="_blank" rel="noreferrer">В расписании</a>
    </div>{copy && <p className="copy-status muted" role="status">{copy}</p>}</div>
  </>;
}

