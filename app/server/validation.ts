import { defaultConfig, type Config, type Level } from '../shared/operations.ts';
import { defaultRatingScheme, type DistributionMode, type ItmMode, type KnockoutRatingMode, type RatingMode, type RatingScheme } from '../shared/rating.ts';

export class DomainError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}
export function field(value: unknown, max: number, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new DomainError('Проверьте заполнение полей', 400);
  }
  return value.trim();
}
export function integer(value: unknown, min: number, max: number, message = 'Проверьте числовые значения') {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new DomainError(message, 400);
  return value;
}
export function validateStructure(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 60) throw new DomainError('Добавьте от 1 до 60 уровней', 400);
  const next = value.map((level): Level => {
    if (!level || !['play', 'break'].includes(level.kind)) throw new DomainError('Укажите тип каждого уровня', 400);
    const duration = integer(level.duration, 60, 10_800);
    if (level.kind === 'break') return { kind: 'break', duration, small: 0, big: 0, ante: 0 };
    const small = integer(level.small, 1, 10_000_000);
    return { kind: 'play', duration, small, big: integer(level.big, small, 10_000_000), ante: integer(level.ante, 0, 10_000_000) };
  });
  if (next[0].kind !== 'play') throw new DomainError('Первым должен идти игровой уровень');
  return next;
}

export function validateAnteEnabled(value: unknown, fallback: boolean) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new DomainError('Выберите режим анте', 400);
  return value;
}

export function validateRatingScheme(value: unknown): RatingScheme {
  if (!value || typeof value !== 'object') throw new DomainError('Укажите настройки рейтинга', 400);
  const raw = value as Record<string, unknown>;
  const mode = raw.mode;
  if (mode !== 'pool' && mode !== 'fixed' && mode !== 'none') throw new DomainError('Выберите режим рейтинга', 400);
  const knockoutMode = raw.knockoutMode ?? 'off';
  if (knockoutMode !== 'off' && knockoutMode !== 'per_ko' && knockoutMode !== 'pool_per_entry') {
    throw new DomainError('Выберите режим нокаутов', 400);
  }
  const itmMode = raw.itmMode ?? 'percent';
  if (itmMode !== 'percent' && itmMode !== 'fixed') throw new DomainError('Выберите режим призовой зоны', 400);
  const distribution = raw.distribution ?? 'percents';
  if (distribution !== 'percents' && distribution !== 'curve') throw new DomainError('Выберите способ распределения очков', 400);
  const roundStep = raw.roundStep ?? 1;
  if (roundStep !== 1 && roundStep !== 5 && roundStep !== 10) throw new DomainError('Выберите шаг округления (1, 5 или 10)', 400);
  const multiplier = Number(raw.multiplier ?? 1);
  if (!Number.isFinite(multiplier) || multiplier < 0.25 || multiplier > 10) throw new DomainError('Укажите множитель от 0.25 до 10', 400);
  const curveFactor = Number(raw.curveFactor ?? 0.8);
  if (!Number.isFinite(curveFactor) || curveFactor < 0.5 || curveFactor > 0.95) throw new DomainError('Укажите коэффициент кривой от 0.5 до 0.95', 400);
  const fixedPlaces = Array.isArray(raw.fixedPlaces)
    ? raw.fixedPlaces.slice(0, 30).map(item => integer(item, 0, 1_000_000))
    : [...defaultRatingScheme.fixedPlaces];
  if (mode === 'fixed' && !fixedPlaces.length) throw new DomainError('Добавьте хотя бы одно призовое место', 400);
  const percents = Array.isArray(raw.percents)
    ? raw.percents.slice(0, 30).map(item => integer(item, 0, 100))
    : [];
  return {
    mode: mode as RatingMode,
    entryPoints: integer(raw.entryPoints ?? defaultRatingScheme.entryPoints, 0, 100_000),
    addonPoints: integer(raw.addonPoints ?? defaultRatingScheme.addonPoints, 0, 100_000),
    guarantee: integer(raw.guarantee ?? 0, 0, 10_000_000),
    fixedPlaces,
    multiplier: Math.round(multiplier * 100) / 100,
    participationPoints: integer(raw.participationPoints ?? 0, 0, 100_000),
    knockoutMode: knockoutMode as KnockoutRatingMode,
    knockoutPoints: integer(raw.knockoutPoints ?? 0, 0, 100_000),
    itmMode: itmMode as ItmMode,
    itmPercent: integer(raw.itmPercent ?? 15, 1, 100),
    itmMinPlaces: integer(raw.itmMinPlaces ?? 3, 1, 30),
    itmFixedPlaces: integer(raw.itmFixedPlaces ?? 3, 1, 30),
    distribution: distribution as DistributionMode,
    percents,
    curveFactor: Math.round(curveFactor * 100) / 100,
    roundStep,
  };
}

export function validateConfig(value: unknown, structure: Level[], existingSeating?: boolean, existingAnte = defaultConfig.anteEnabled): Config {
  if (!value || typeof value !== 'object') throw new DomainError('Укажите настройки', 400);
  const raw = value as Record<string, unknown>;
  const next = { ...defaultConfig };
  next.anteEnabled = validateAnteEnabled(raw.anteEnabled, existingAnte);
  for (const key of ['buyIn', 'reentryFee', 'startStack', 'addonChips', 'addonCost', 'ratingGuarantee'] as const) {
    next[key] = integer(raw[key], key === 'startStack' ? 1 : 0, 10_000_000);
  }
  const playingLevels = structure.filter(level => level.kind === 'play').length;
  next.lateRegistration = integer(raw.lateRegistration, 0, playingLevels);
  next.registrationLimit = integer(raw.registrationLimit ?? 0, 0, 500);
  for (const key of ['addon2Cost', 'addon2Chips', 'addon3Cost', 'addon3Chips'] as const) {
    next[key] = integer(raw[key] ?? 0, 0, 10_000_000);
  }
  next.manualBreakMinutes = integer(raw.manualBreakMinutes, 1, 120);
  for (const key of ['addon', 'knockout', 'autoAdvance', 'seating'] as const) {
    const setting = key === 'seating' && existingSeating !== undefined ? existingSeating : raw[key];
    if (typeof setting !== 'boolean') throw new DomainError('Проверьте настройки', 400);
    next[key] = setting;
  }
  next.format = field(raw.format, 40, true);
  next.comment = field(raw.comment, 280);
  next.bonusHand = field(raw.bonusHand, 24);
  if (raw.ratingPreset !== undefined) {
    next.ratingPreset = raw.ratingPreset === null ? null : field(raw.ratingPreset, 50);
  }
  if (raw.rating !== undefined) {
    next.rating = validateRatingScheme(raw.rating);
    if (next.rating.mode === 'pool') next.ratingGuarantee = next.rating.guarantee;
  }
  return next;
}

export function scheduledDate(value: unknown) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new DomainError('Укажите корректные дату и время', 400);
  }
  return value;
}
