import { useState, type Dispatch, type SetStateAction } from 'react';
import type { Config } from '../shared/operations';
import { baseRatingPresets, ratingSchemeOf, type RatingPreset, type RatingScheme } from '../shared/rating';
import { RatingSchemeEditor } from './RatingBuilder';

type NumberField = 'startStack' | 'lateRegistration' | 'buyIn' | 'reentryFee' | 'addonChips' | 'addonCost' |
  'addon2Chips' | 'addon2Cost' | 'addon3Chips' | 'addon3Cost' | 'registrationLimit' | 'manualBreakMinutes' | 'ratingGuarantee';

export function ConfigFields({ config, setConfig, levelCount, ratingPresets = [] }: {
  config: Config; setConfig: Dispatch<SetStateAction<Config>>; levelCount: number; ratingPresets?: RatingPreset[];
}) {
  const [emptyFields, setEmptyFields] = useState<Partial<Record<NumberField, boolean>>>({});
  const update = <K extends keyof Config>(key: K, value: Config[K]) => setConfig(current => ({ ...current, [key]: value }));
  const activeRating = ratingSchemeOf(config);
  const selectedPreset = config.ratingPreset ?? '';
  const missingRatingPreset = selectedPreset.startsWith('club:') && !ratingPresets.some(item => 'club:' + item.name === selectedPreset);

  function applyRatingPreset(value: string) {
    if (!value) {
      setConfig(current => ({ ...current, ratingPreset: null, rating: ratingSchemeOf(current) }));
      return;
    }
    const label = value.slice(5);
    const preset = value.startsWith('club:')
      ? ratingPresets.find(item => item.name === label)
      : baseRatingPresets.find(item => item.name === label);
    if (!preset) return;
    setConfig(current => ({
      ...current,
      ratingPreset: value,
      rating: { ...preset.scheme },
      ratingGuarantee: preset.scheme.mode === 'pool' ? preset.scheme.guarantee : current.ratingGuarantee,
    }));
  }

  function updateRating(next: RatingScheme) {
    setConfig(current => ({
      ...current,
      ratingPreset: null,
      rating: next,
      ratingGuarantee: next.mode === 'pool' ? next.guarantee : current.ratingGuarantee,
    }));
  }
  const numberField = (label: string, key: NumberField, min = 0, max = 10_000_000) =>
    <label key={key}>{label}<input type="number" inputMode="numeric" min={min} max={max} required
      value={emptyFields[key] ? '' : String(config[key])} onChange={event => {
        const value = event.currentTarget.valueAsNumber;
        const empty = Number.isNaN(value);
        setEmptyFields(current => current[key] === empty ? current : { ...current, [key]: empty });
        if (!empty) update(key, value);
      }} /></label>;
  return <>
    <div className="fields-grid">
      <label>Название формата<input value={config.format} required maxLength={40} onChange={event => update('format', event.target.value)} /></label>
      {numberField('Стартовый стек', 'startStack', 1)}
      {numberField('Вход, ₽', 'buyIn')}
      {numberField('Реэнтри, ₽', 'reentryFee')}
      {numberField('Поздняя регистрация, уровней (0 — без ограничения)', 'lateRegistration', 0, levelCount)}
      {numberField('Лимит онлайн-записи (0 — по местам за столами)', 'registrationLimit', 0, 500)}
      {numberField('Ручной перерыв, мин', 'manualBreakMinutes', 1, 120)}
    </div>
    <div className="fields-grid">
      <label>Макет рейтинга
        <select value={selectedPreset} onChange={event => applyRatingPreset(event.target.value)}>
          <option value="">Свои настройки</option>
          {ratingPresets.length > 0 && <optgroup label="Макеты клуба">
            {ratingPresets.map(item => <option key={item.name} value={'club:' + item.name}>{item.name}</option>)}
            {missingRatingPreset && <option value={selectedPreset}>{selectedPreset.slice(5)} (удалён)</option>}
          </optgroup>}
          <optgroup label="Готовые шаблоны">
            {baseRatingPresets.map(item => <option key={item.name} value={'base:' + item.name}>{item.name}</option>)}
          </optgroup>
        </select>
      </label>
      {activeRating.mode === 'pool' && <label>Гарантия очков (0 — без гарантии)
        <input type="number" inputMode="numeric" min={0} max={10_000_000} value={activeRating.guarantee}
          onChange={event => {
            const value = Number.parseInt(event.target.value, 10);
            updateRating({ ...activeRating, guarantee: Number.isFinite(value) && value >= 0 ? value : 0 });
          }} />
      </label>}
      {activeRating.mode === 'fixed' && <label>Множитель рейтинга
        <input type="number" step="0.5" min={0.5} max={10} value={activeRating.multiplier}
          onChange={event => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value >= 0.25 && value <= 10) updateRating({ ...activeRating, multiplier: value });
          }} />
      </label>}
    </div>
    <details className="screen-controls">
      <summary>Настроить параметры рейтинга для этого турнира</summary>
      <div className="screen-controls-body">
        <RatingSchemeEditor scheme={activeRating} onChange={updateRating} showPreview={false} />
      </div>
    </details>
    <div className="check-grid">
      {([['addon','Аддон'], ['knockout','Нокаут (PKO)']] as const).map(([key, label]) =>
        <label key={key}><input type="checkbox" checked={config[key]} onChange={event => update(key, event.target.checked)} />{label}</label>)}
    </div>
    {config.addon && <>
      <div className="fields-grid">
        {numberField('Стоимость аддона, ₽', 'addonCost')}{numberField('Фишки аддона', 'addonChips')}
        {numberField('Стоимость двойного аддона, ₽', 'addon2Cost')}{numberField('Фишки двойного аддона', 'addon2Chips')}
        {numberField('Стоимость тройного аддона, ₽', 'addon3Cost')}{numberField('Фишки тройного аддона', 'addon3Chips')}
      </div>
      <p className="muted">Двойной и тройной аддоны доступны, если для них указаны фишки.</p>
    </>}
    <div className="fields-grid">
      <label>Бонусная рука<input value={config.bonusHand} maxLength={24} onChange={event => update('bonusHand', event.target.value)} /></label>
      <label>Сообщение на ТВ<input value={config.comment} maxLength={280} onChange={event => update('comment', event.target.value)} /></label>
    </div>
  </>;
}

