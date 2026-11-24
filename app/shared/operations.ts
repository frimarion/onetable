import type { RatingScheme } from './rating.ts';

export type Level = { kind: 'play' | 'break'; small: number; big: number; ante: number; duration: number };
export type MoneyMethod = 'cash' | 'card' | 'transfer';
export type DisplayMode = 'clock' | 'seating' | 'results' | 'payouts';
export type Config = {
  anteEnabled: boolean;
  buyIn: number; reentryFee: number; ratingGuarantee: number; startStack: number; lateRegistration: number;
  addon: boolean; addonCost: number; addonChips: number; knockout: boolean;
  addon2Cost: number; addon2Chips: number; addon3Cost: number; addon3Chips: number;
  registrationLimit: number;
  seating: boolean; manualBreakMinutes: number; autoAdvance: boolean; format: string;
  comment: string; bonusHand: string;
  ratingPreset?: string | null;
  rating?: RatingScheme;
};
export type ManualBreak = { endsAt: number; startedAt?: number; wasRunning: boolean };
export type DisplaySettings = {
  mode: DisplayMode; finalTable: boolean;
};
export type Preset = { name: string; structure: Level[]; config: Partial<Config> | null };
export type ManualStats = { entered: number; reentries: number; out: number };
export type Result = { playerId: string; name: string; place: number | null; knockouts: number };
export const defaultConfig: Config = {
  anteEnabled: true,
  buyIn: 1500, reentryFee: 1500, ratingGuarantee: 800, startStack: 30000, lateRegistration: 0,
  addon: false, addonCost: 1500, addonChips: 30000, knockout: false,
  addon2Cost: 0, addon2Chips: 0, addon3Cost: 0, addon3Chips: 0, registrationLimit: 0,
  seating: true, manualBreakMinutes: 10, autoAdvance: true, format: 'Deepstack', comment: '', bonusHand: '',
};
export const defaultDisplay: DisplaySettings = { mode: 'clock', finalTable: false };
export const methods: Record<MoneyMethod, string> = { cash: 'Наличные', card: 'Карта', transfer: 'Электронно' };
export const formats: Record<string, Level[]> = {
  Deepstack: [200, 400, 600, 800, 1000, 1600].map(big => ({ kind: 'play', small: big / 2, big, ante: big, duration: 1200 })),
  Turbo: [200, 400, 600, 800, 1200, 1600].map(big => ({ kind: 'play', small: big / 2, big, ante: big, duration: 600 })),
};
export type OperationsCommand =
  | { type: 'setSeatingEnabled'; enabled: boolean }
  | { type: 'saveConfig'; name: string; config: Config }
  | { type: 'saveStructure'; structure: Level[]; anteEnabled?: boolean }
  | { type: 'savePreset'; name: string; structure: Level[]; config?: Config; anteEnabled?: boolean }
  | { type: 'deletePreset'; name: string }
  | { type: 'saveRatingPreset'; name: string; scheme: RatingScheme }
  | { type: 'deleteRatingPreset'; name: string }
  | { type: 'setManualStats'; stats: ManualStats }
  | { type: 'setFinishPlace'; playerId: string; place: number }
  | { type: 'swapOutcome'; playerId: string; withPlayerId: string }
  | { type: 'clockControl'; operation: 'previous' | 'restart' | 'reset' | 'break' | 'minus' | 'plus'; revision: number }
  | { type: 'swapSeats'; playerId: string; withPlayerId: string }
  | { type: 'configureTables'; count: number; capacity: number }
  | { type: 'clearSeating' | 'shuffleSeating' | 'balanceSeating' }
  | { type: 'vacate' | 'unregister' | 'undoBust'; playerId: string }
  | { type: 'adjustReentry'; playerId: string; delta: 1 | -1; expectedReentries?: number }
  | { type: 'addon'; playerId: string; enabled?: boolean; tier?: number; expectedTier?: number }
  | { type: 'knockouts'; playerId: string; value: number }
  | { type: 'setTariff'; playerId: string; rate: 0 | 50 | 100 }
  | { type: 'voidPayment'; paymentId: number }
  | { type: 'displayMode'; mode: DisplayMode }
  | { type: 'toggleFinalTable' }
  | { type: 'importNames'; names: string[]; replace?: boolean };


export const playingLevel = (structure: Level[], index: number) => structure.slice(0, index + 1).filter(level => level.kind === 'play').length;
export const registrationOpen = (config: Config, structure: Level[], index: number) =>
  config.lateRegistration === 0 || playingLevel(structure, index) <= config.lateRegistration;

export const addonOptions = (config: Config) => [
  { tier: 1, cost: config.addonCost, chips: config.addonChips, label: 'Аддон' },
  { tier: 2, cost: config.addon2Cost, chips: config.addon2Chips, label: 'Двойной аддон' },
  { tier: 3, cost: config.addon3Cost, chips: config.addon3Chips, label: 'Тройной аддон' },
].filter(option => config.addon && (option.tier === 1 || option.chips > 0));

export type CashCommand =
  | { type: 'settleBalance'; playerId: string; method: MoneyMethod; expectedDue: number; amount?: number }
  | { type: 'settleOldDebts'; playerId: string; method: MoneyMethod | 'prior'; debts: { id: string; amount: number }[] }
  | { type: 'clearPayments'; playerId: string; paymentIds: number[]; resetTerms?: boolean }
  | { type: 'compEntry' | 'compAddon'; playerId: string; enabled: boolean }
  | { type: 'changePaymentMethod'; paymentId: number; method: MoneyMethod };
