export type RatingMode = 'pool' | 'fixed' | 'none';
export type KnockoutRatingMode = 'off' | 'per_ko' | 'pool_per_entry';
export type ItmMode = 'percent' | 'fixed';
export type DistributionMode = 'percents' | 'curve';

export type RatingScheme = {
  mode: RatingMode;
  entryPoints: number;
  addonPoints: number;
  guarantee: number;
  fixedPlaces: number[];
  multiplier: number;
  participationPoints: number;
  knockoutMode: KnockoutRatingMode;
  knockoutPoints: number;
  itmMode: ItmMode;
  itmPercent: number;
  itmMinPlaces: number;
  itmFixedPlaces: number;
  distribution: DistributionMode;
  percents: number[];
  curveFactor: number;
  roundStep: 1 | 5 | 10;
};

export type RatingPreset = { name: string; scheme: RatingScheme };

export type RatingCalculation = {
  mode: RatingMode;
  total: number;
  knockoutMode: KnockoutRatingMode;
  knockoutPool: number;
  knockoutPerKo: number;
  participationPoints: number;
  payouts: number[];
};

const standardTable: Record<number, number[]> = {
  1: [100],
  2: [65, 35],
  3: [50, 30, 20],
  4: [45, 27, 18, 10],
  5: [40, 25, 17, 11, 7],
  6: [36, 23, 16, 11, 8, 6],
  7: [34, 21, 15, 11, 8, 6, 5],
  8: [32, 20, 14, 10, 8, 6, 5, 5],
  9: [30, 19, 13, 10, 8, 6, 5, 5, 4],
};

export function standardPercents(places: number): number[] {
  if (places <= 0) return [];
  if (standardTable[places]) return [...standardTable[places]];
  const weights = Array.from({ length: places }, (_, index) => 0.8 ** index);
  const sum = weights.reduce((a, b) => a + b, 0);
  const pct = weights.map(w => Math.max(1, Math.round(w * 100 / sum)));
  pct[0] += 100 - pct.reduce((a, b) => a + b, 0);
  return pct;
}

export const defaultRatingScheme: RatingScheme = {
  mode: 'pool',
  entryPoints: 10,
  addonPoints: 20,
  guarantee: 800,
  fixedPlaces: [100, 80, 65, 50, 40, 30, 25, 20, 15],
  multiplier: 1,
  participationPoints: 0,
  knockoutMode: 'off',
  knockoutPoints: 5,
  itmMode: 'percent',
  itmPercent: 15,
  itmMinPlaces: 3,
  itmFixedPlaces: 3,
  distribution: 'percents',
  percents: [],
  curveFactor: 0.8,
  roundStep: 5,
};

export const baseRatingPresets: RatingPreset[] = [
  {
    name: 'Классический (проценты)',
    scheme: { ...defaultRatingScheme, guarantee: 0, knockoutMode: 'off', distribution: 'percents', roundStep: 5 },
  },
  {
    name: 'Нокаут (PKO)',
    scheme: { ...defaultRatingScheme, guarantee: 0, knockoutMode: 'per_ko', knockoutPoints: 5, distribution: 'percents', roundStep: 5 },
  },
  {
    name: 'Клубная лига (фикс за места)',
    scheme: {
      ...defaultRatingScheme,
      mode: 'fixed',
      guarantee: 0,
      fixedPlaces: [100, 80, 65, 50, 40, 30, 25, 20, 15],
      multiplier: 1,
      participationPoints: 5,
      knockoutMode: 'off',
    },
  },
  {
    name: 'Формула Doyle',
    scheme: {
      ...defaultRatingScheme,
      mode: 'pool',
      entryPoints: 10,
      addonPoints: 20,
      guarantee: 800,
      knockoutMode: 'pool_per_entry',
      knockoutPoints: 2,
      itmMode: 'percent',
      itmPercent: 15,
      itmMinPlaces: 3,
      distribution: 'curve',
      curveFactor: 0.8,
      roundStep: 1,
    },
  },
  {
    name: 'Без рейтинга',
    scheme: { ...defaultRatingScheme, mode: 'none', guarantee: 0, knockoutMode: 'off', participationPoints: 0 },
  },
];

export function ratingSchemeOf(config: { rating?: RatingScheme; ratingGuarantee: number; knockout: boolean }): RatingScheme {
  if (config.rating) return config.rating;
  return {
    ...defaultRatingScheme,
    guarantee: config.ratingGuarantee,
    knockoutMode: 'pool_per_entry',
    knockoutPoints: config.knockout ? 4 : 2,
    distribution: 'curve',
    curveFactor: 0.8,
    roundStep: 1,
  };
}

export function calculateRating(scheme: RatingScheme, entries: number, addons: number): RatingCalculation {
  if (scheme.mode === 'none' || entries <= 0) {
    return {
      mode: scheme.mode, total: 0, knockoutMode: scheme.knockoutMode,
      knockoutPool: 0, knockoutPerKo: 0, participationPoints: 0, payouts: [],
    };
  }
  const participationPoints = scheme.participationPoints;
  if (scheme.mode === 'fixed') {
    const payouts = scheme.fixedPlaces.slice(0, entries).map(points => Math.round(points * scheme.multiplier));
    const total = payouts.reduce((sum, value) => sum + value, 0);
    const knockoutPerKo = scheme.knockoutMode === 'per_ko' ? scheme.knockoutPoints : 0;
    const knockoutPool = scheme.knockoutMode === 'pool_per_entry' ? scheme.knockoutPoints * entries : 0;
    return { mode: 'fixed', total, knockoutMode: scheme.knockoutMode, knockoutPool, knockoutPerKo, participationPoints, payouts };
  }

  const rawPool = scheme.entryPoints * entries + scheme.addonPoints * addons;
  const total = Math.max(scheme.guarantee, rawPool);
  const knockoutPool = scheme.knockoutMode === 'pool_per_entry' ? Math.min(total, scheme.knockoutPoints * entries) : 0;
  const knockoutPerKo = scheme.knockoutMode === 'per_ko' ? scheme.knockoutPoints : 0;
  const available = Math.max(0, total - knockoutPool);

  const rawPlaces = scheme.itmMode === 'fixed'
    ? scheme.itmFixedPlaces
    : Math.max(scheme.itmMinPlaces, Math.floor(entries * scheme.itmPercent / 100));
  const places = Math.min(entries, Math.max(1, rawPlaces));

  let weights: number[];
  if (scheme.distribution === 'curve') {
    weights = Array.from({ length: places }, (_, index) => scheme.curveFactor ** index);
  } else {
    const custom = scheme.percents.length === places && scheme.percents.some(v => v > 0);
    weights = custom ? scheme.percents : standardPercents(places);
  }
  const sum = weights.reduce((acc, w) => acc + w, 0) || 1;
  const step = scheme.roundStep || 1;
  const payouts = weights.map(w => Math.round((available * w / sum) / step) * step);
  const diff = available - payouts.reduce((acc, v) => acc + v, 0);
  if (payouts.length) payouts[0] = Math.max(0, payouts[0] + diff);

  return { mode: 'pool', total, knockoutMode: scheme.knockoutMode, knockoutPool, knockoutPerKo, participationPoints, payouts };
}

export function calculatePayouts(entries: number, addons: number, guarantee: number, knockout: boolean) {
  const result = calculateRating(ratingSchemeOf({ ratingGuarantee: guarantee, knockout }), entries, addons);
  return { total: result.total, knockoutPool: result.knockoutPool, payouts: result.payouts };
}
