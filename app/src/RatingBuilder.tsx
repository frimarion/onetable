import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Snapshot } from '../shared/model';
import {
  baseRatingPresets, calculateRating, defaultRatingScheme, standardPercents,
  type DistributionMode, type ItmMode, type KnockoutRatingMode, type RatingMode, type RatingScheme,
} from '../shared/rating';
import type { Run } from './api';
import { Heading, format } from './widgets';

export function RatingSummary({ scheme, entries, addons }: { scheme: RatingScheme; entries: number; addons: number }) {
  const result = calculateRating(scheme, entries, addons);
  if (result.mode === 'none') return <p className="muted">Рейтинг для этого турнира отключён.</p>;
  if (!result.payouts.length) return <p className="empty">Расчёт появится после первого входа</p>;
  const parts: string[] = [];
  if (result.total > 0) parts.push('Всего ' + format.format(result.total) + ' очков');
  if (result.knockoutMode === 'per_ko' && result.knockoutPerKo > 0) {
    parts.push('за каждый нокаут +' + format.format(result.knockoutPerKo));
  } else if (result.knockoutMode === 'pool_per_entry' && result.knockoutPool > 0) {
    parts.push('за нокауты ' + format.format(result.knockoutPool));
  }
  if (result.participationPoints > 0) parts.push('за участие +' + format.format(result.participationPoints));
  return <>
    {parts.length > 0 && <p className="muted">{parts.join(' · ')}</p>}
    <ol className="payout-grid">
      {result.payouts.map((points, index) => <li key={index} className={index === 0 ? 'payout-top' : undefined}>
        <span>{index + 1} место</span>
        <strong>{format.format(points)}</strong>
      </li>)}
    </ol>
  </>;
}

export function RatingSchemeEditor({ scheme, onChange, disabled = false, showPreview = true }: {
  scheme: RatingScheme; onChange: (next: RatingScheme) => void; disabled?: boolean; showPreview?: boolean;
}) {
  const [simEntries, setSimEntries] = useState(25);
  const [simAddons, setSimAddons] = useState(10);
  const patch = (part: Partial<RatingScheme>) => onChange({ ...scheme, ...part });
  const intVal = (value: string, fallback = 0) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const customPlaces = scheme.itmMode === 'fixed' ? scheme.itmFixedPlaces : Math.max(scheme.itmMinPlaces, Math.floor(simEntries * scheme.itmPercent / 100));
  const activePercents = scheme.percents.length === customPlaces ? scheme.percents : standardPercents(customPlaces);
  const percentsSum = activePercents.reduce((sum, item) => sum + item, 0);

  return <div className="admin-form">
    <div className="fields-grid">
      <label>Способ расчёта очков
        <select value={scheme.mode} disabled={disabled} onChange={event => patch({ mode: event.target.value as RatingMode })}>
          <option value="pool">Пул от входов и аддонов</option>
          <option value="fixed">Фиксированные очки за места</option>
          <option value="none">Без рейтинга</option>
        </select>
      </label>
      {scheme.mode !== 'none' && <label>Бонус за участие (явку), очки
        <input type="number" inputMode="numeric" min={0} max={100000} disabled={disabled} value={scheme.participationPoints}
          onChange={event => patch({ participationPoints: intVal(event.target.value) })} />
      </label>}
    </div>

    {scheme.mode === 'pool' && <>
      <div className="fields-grid">
        <label>Очков за вход / реэнтри
          <input type="number" inputMode="numeric" min={0} max={100000} disabled={disabled} value={scheme.entryPoints}
            onChange={event => patch({ entryPoints: intVal(event.target.value) })} />
        </label>
        <label>Очков за аддон
          <input type="number" inputMode="numeric" min={0} max={100000} disabled={disabled} value={scheme.addonPoints}
            onChange={event => patch({ addonPoints: intVal(event.target.value) })} />
        </label>
        <label>Гарантия очков (0 — без гарантии)
          <input type="number" inputMode="numeric" min={0} max={10000000} disabled={disabled} value={scheme.guarantee}
            onChange={event => patch({ guarantee: intVal(event.target.value) })} />
        </label>
      </div>

      <div className="fields-grid">
        <label>Сколько игроков в призах (ITM)
          <select value={scheme.itmMode} disabled={disabled} onChange={event => patch({ itmMode: event.target.value as ItmMode })}>
            <option value="percent">Процент от входов</option>
            <option value="fixed">Фиксированное число мест</option>
          </select>
        </label>
        {scheme.itmMode === 'percent' ? <>
          <label>Процент призовых мест, %
            <input type="number" inputMode="numeric" min={1} max={100} disabled={disabled} value={scheme.itmPercent}
              onChange={event => patch({ itmPercent: Math.max(1, Math.min(100, intVal(event.target.value, 15))) })} />
          </label>
          <label>Минимум мест в призах
            <input type="number" inputMode="numeric" min={1} max={30} disabled={disabled} value={scheme.itmMinPlaces}
              onChange={event => patch({ itmMinPlaces: Math.max(1, Math.min(30, intVal(event.target.value, 3))) })} />
          </label>
        </> : <label>Количество призовых мест
          <input type="number" inputMode="numeric" min={1} max={30} disabled={disabled} value={scheme.itmFixedPlaces}
            onChange={event => patch({ itmFixedPlaces: Math.max(1, Math.min(30, intVal(event.target.value, 3))), percents: [] })} />
        </label>}
      </div>

      <div className="fields-grid">
        <label>Распределение по местам
          <select value={scheme.distribution} disabled={disabled} onChange={event => patch({ distribution: event.target.value as DistributionMode })}>
            <option value="percents">Процентная сетка</option>
            <option value="curve">Плавная кривая (формула)</option>
          </select>
        </label>
        {scheme.distribution === 'curve' && <label>Профиль кривой
          <select value={String(scheme.curveFactor)} disabled={disabled} onChange={event => patch({ curveFactor: Number(event.target.value) })}>
            <option value="0.85">Плавная (меньше разрыв)</option>
            <option value="0.8">Стандартная (как в Doyle)</option>
            <option value="0.7">Топ-хэви (максимум 1-му месту)</option>
          </select>
        </label>}
        <label>Округление очков
          <select value={String(scheme.roundStep)} disabled={disabled} onChange={event => patch({ roundStep: Number(event.target.value) as 1 | 5 | 10 })}>
            <option value="1">До 1 очка</option>
            <option value="5">До 5 очков</option>
            <option value="10">До 10 очков</option>
          </select>
        </label>
      </div>

      {scheme.distribution === 'percents' && scheme.itmMode === 'fixed' && <div className="admin-form">
        <p className="muted">Проценты по местам (сумма сейчас: {percentsSum}%)</p>
        <div className="fields-grid">
          {activePercents.map((pct, index) => <label key={index}>{index + 1} место, %
            <input type="number" inputMode="numeric" min={0} max={100} disabled={disabled} value={pct}
              onChange={event => {
                const next = [...activePercents];
                next[index] = Math.min(100, intVal(event.target.value));
                patch({ percents: next });
              }} />
          </label>)}
        </div>
      </div>}
    </>}

    {scheme.mode === 'fixed' && <>
      <div className="fields-grid">
        <label>Множитель турнира
          <input type="number" step="0.5" min={0.5} max={10} disabled={disabled} value={scheme.multiplier}
            onChange={event => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 0.25 && value <= 10) patch({ multiplier: value });
            }} />
        </label>
      </div>
      <div className="fields-grid">
        {scheme.fixedPlaces.map((points, index) => <label key={index}>{index + 1} место, очки
          <input type="number" inputMode="numeric" min={0} max={1000000} disabled={disabled} value={points}
            onChange={event => {
              const next = [...scheme.fixedPlaces];
              next[index] = intVal(event.target.value);
              patch({ fixedPlaces: next });
            }} />
        </label>)}
      </div>
      <div className="actions">
        <button type="button" className="button compact" disabled={disabled || scheme.fixedPlaces.length >= 30}
          onClick={() => patch({ fixedPlaces: [...scheme.fixedPlaces, Math.max(5, Math.round((scheme.fixedPlaces.at(-1) ?? 20) * 0.75))] })}>
          <Plus size={15} /> Добавить место
        </button>
        {scheme.fixedPlaces.length > 1 && <button type="button" className="button compact" disabled={disabled}
          onClick={() => patch({ fixedPlaces: scheme.fixedPlaces.slice(0, -1) })}>
          <Trash2 size={15} /> Убрать последнее
        </button>}
      </div>
    </>}

    {scheme.mode !== 'none' && <div className="fields-grid">
      <label>Очки за нокауты
        <select value={scheme.knockoutMode} disabled={disabled} onChange={event => patch({ knockoutMode: event.target.value as KnockoutRatingMode })}>
          <option value="off">Не начисляются</option>
          <option value="per_ko">Фиксированно за каждый нокаут</option>
          <option value="pool_per_entry">Выделенный нокаут-пул с каждого входа</option>
        </select>
      </label>
      {scheme.knockoutMode !== 'off' && <label>
        {scheme.knockoutMode === 'per_ko' ? 'Очков за 1 нокаут' : 'В нокаут-пул с каждого входа, очки'}
        <input type="number" inputMode="numeric" min={0} max={100000} disabled={disabled} value={scheme.knockoutPoints}
          onChange={event => patch({ knockoutPoints: intVal(event.target.value) })} />
      </label>}
    </div>}

    {showPreview && scheme.mode !== 'none' && <section className="panel admin-pane">
      <h3>Предпросмотр расчёта</h3>
      <div className="fields-grid">
        <label>Если входов (включая реэнтри)
          <input type="number" inputMode="numeric" min={1} max={500} value={simEntries}
            onChange={event => setSimEntries(Math.max(1, intVal(event.target.value, 1)))} />
        </label>
        {scheme.mode === 'pool' && <label>Если аддонов
          <input type="number" inputMode="numeric" min={0} max={500} value={simAddons}
            onChange={event => setSimAddons(intVal(event.target.value))} />
        </label>}
      </div>
      <RatingSummary scheme={scheme} entries={simEntries} addons={simAddons} />
    </section>}
  </div>;
}

export function RatingStudio({ data, busy, run }: { data: Snapshot; busy: boolean; run: Run }) {
  const [selected, setSelected] = useState<string>(() => data.ratingPresets[0] ? 'club:' + data.ratingPresets[0].name : 'base:' + baseRatingPresets[0].name);
  const [name, setName] = useState(() => data.ratingPresets[0]?.name ?? baseRatingPresets[0].name);
  const [scheme, setScheme] = useState<RatingScheme>(() => data.ratingPresets[0]?.scheme ?? baseRatingPresets[0].scheme ?? defaultRatingScheme);

  const isClubPreset = selected.startsWith('club:') && data.ratingPresets.some(item => 'club:' + item.name === selected);
  const existingClub = data.ratingPresets.some(item => item.name === name.trim());

  function pick(key: string, presetName: string, presetScheme: RatingScheme) {
    setSelected(key);
    setName(presetName);
    setScheme({ ...defaultRatingScheme, ...presetScheme });
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    void run({ type: 'saveRatingPreset', name: trimmed, scheme }, () => setSelected('club:' + trimmed));
  }

  function remove() {
    if (!isClubPreset) return;
    const presetName = selected.slice(5);
    void run({ type: 'deleteRatingPreset', name: presetName }, () => {
      const fallback = baseRatingPresets[0];
      pick('base:' + fallback.name, fallback.name, fallback.scheme);
    });
  }

  return <>
    <Heading title="Макеты рейтинга" subtitle={data.club.name + ' · Настройка правил начисления очков для турниров клуба'} />
    <div className="rating-studio">
      <section className="panel admin-pane rating-presets-pane">
        <h2>Макеты клуба</h2>
        {data.ratingPresets.length ? <div className="rating-preset-list">
          {data.ratingPresets.map(preset => <button key={preset.name} type="button"
            className={'rating-preset-item' + (selected === 'club:' + preset.name ? ' selected' : '')}
            disabled={busy} onClick={() => pick('club:' + preset.name, preset.name, preset.scheme)}>
            <strong>{preset.name}</strong>
            <small>{preset.scheme.mode === 'none' ? 'Без рейтинга' : preset.scheme.mode === 'fixed' ? 'Фикс за места' : 'Пул от входов'}</small>
          </button>)}
        </div> : <p className="muted">Своих макетов пока нет. Выберите шаблон ниже и сохраните под свой клуб.</p>}

        <h2>Готовые шаблоны</h2>
        <div className="rating-preset-list">
          {baseRatingPresets.map(preset => <button key={preset.name} type="button"
            className={'rating-preset-item' + (selected === 'base:' + preset.name ? ' selected' : '')}
            disabled={busy} onClick={() => pick('base:' + preset.name, preset.name, preset.scheme)}>
            <strong>{preset.name}</strong>
            <small>{preset.scheme.mode === 'none' ? 'Без рейтинга' : preset.scheme.mode === 'fixed' ? 'Фикс за места' : 'Пул от входов'}</small>
          </button>)}
        </div>
      </section>

      <section className="panel admin-pane editor-section">
        <h2>Конструктор макета</h2>
        <form className="admin-form" onSubmit={save}>
          <label>Название макета клуба
            <input value={name} required maxLength={40} disabled={busy} onChange={event => setName(event.target.value)} />
          </label>
          <RatingSchemeEditor scheme={scheme} onChange={setScheme} disabled={busy} showPreview />
          <div className="actions">
            <button type="submit" className="button primary" disabled={busy || !name.trim()}>
              {existingClub ? 'Обновить макет клуба' : 'Сохранить как макет клуба'}
            </button>
            {isClubPreset && <button type="button" className="button" disabled={busy} onClick={remove}>
              <Trash2 size={15} /> Удалить макет
            </button>}
          </div>
        </form>
      </section>
    </div>
  </>;
}
