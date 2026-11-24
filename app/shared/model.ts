import type { MemberRole } from './access.ts';
import { formats, type CashCommand, type Config, type DisplaySettings, type Level, type MoneyMethod, type OperationsCommand, type Preset, type ManualStats, type Result } from './operations.ts';
import type { RatingPreset } from './rating.ts';
import type { CrmCommand, CrmData, PipelineStage } from './crm.ts';

export type Role = 'admin' | 'floor' | 'dealer' | 'display';
export type Status = 'registered' | 'active' | 'out';
export type PlayerIdentity = { name: string; nickname: string; photoUrl?: string | null };
export type Player = PlayerIdentity & {
  id: string;
  source: string;
  note: string;
  tags: string;
  phone: string;
  telegram: string;
  instagram: string;
  registeredAt: number;
  telegramConsent: boolean;
  stage: PipelineStage;
  owner: string;
};
export type Entry = {
  playerId: string; status: Status; tableNo: number | null; seatNo: number | null; reentries: number; confirmed: boolean; addon: boolean; knockouts: number; rate: number; bustedAt: number | null;
  addonTier: number; addonChips: number;
} & PlayerIdentity;
export type Table = { number: number; capacity: number };
export type Clock = {
  level: number; remaining: number; startedAt: number | null; duration: number; manualBreak: boolean;
};
export type JournalItem = { id: number; label: string; actor: string; time: number };
export type Visit = {
  playerId: string; tournamentId: string; tournamentName: string; time: number;
};
export type Payment = {
  playerId: string; tournamentId: string; tournamentName: string; time: number; amount: number; kind: 'payment' | 'reentry' | 'buyin' | 'addon'; id: number; method: MoneyMethod | 'prior' | null; waived: boolean; collectedAtTournament: string | null;
};
export type Club = { id: string; name: string; venue: string; accent: string };
export type Tournament = {
  id: string; name: string; clubId: string; state: 'draft' | 'scheduled' | 'live' | 'finished';
  startsAt: string | null; description: string; layout: string | null;
};
export type TournamentDetails = Pick<Tournament, 'name' | 'startsAt' | 'description' | 'layout'>;
export type TournamentDefinition = TournamentDetails & { config: Config; structure: Level[] };
export type WeekCopy = { sourceId: string; name: string; startsAt: string };
export type CommandResult = { message: string; tournamentId?: string };
export type PublicSchedule = {
  club: Club;
  tournaments: (Omit<Tournament, 'layout'> & { format: string; buyIn: number; startStack: number })[];
};
export type RegistrationStatus = {
  open: boolean; full: boolean; state: 'registered' | 'waiting' | 'admitted' | null; position: number | null;
};
export type Waitlist = {
  people: ({ playerId: string; arrived: boolean } & PlayerIdentity)[];
  canAdmit: boolean;
  blocked?: 'closed' | 'arrival' | 'full' | 'unseated';
};
export type Session = { token: string; club: Club; role: Role; table: number | null; memberRole?: MemberRole };
export type Snapshot = {
  tournament: Tournament; schedule: Tournament[]; club: Club; role: Role;
  revision: number; serverTime: number; clock: Clock; stats: { registered: number; active: number; seated: number; reentries: number; entered: number; addons: number; addonChips: number };
  waitlist: Waitlist;
  tvPayouts?: number[];
  dealerQueue?: ({ playerId: string } & PlayerIdentity)[];
  structure: Level[]; presets: Preset[]; ratingPresets: RatingPreset[]; manualStats: ManualStats; config: Config; display: DisplaySettings; results: Result[]; tables: Table[]; entries: Entry[]; roster: Player[]; visits: Visit[]; payments: Payment[]; journal: JournalItem[]; crm: CrmData;
};
export type Command =
  | OperationsCommand | CashCommand | CrmCommand
  | { type: 'register' | 'checkIn' | 'checkOut' | 'confirmSeat' | 'reenter'; playerId: string }
  | { type: 'bust'; playerId: string; knockouts?: number }
  | ({ type: 'dealerSeat'; seatNo: number } & ({ playerId: string } | { name: string }))
  | { type: 'assign'; playerId: string; tableNo: number; seatNo: number }
  | { type: 'addPlayer'; name: string; nickname?: string; source: string; note: string; tags: string; phone?: string; telegram?: string; instagram?: string; telegramConsent?: boolean; stage?: PipelineStage; owner?: string; enroll?: boolean }
  | { type: 'payment'; playerId: string; amount: number; method?: MoneyMethod }
  | { type: 'updatePlayer'; playerId: string; name?: string; nickname?: string; source: string; note: string; tags: string; phone?: string; telegram?: string; instagram?: string; telegramConsent?: boolean; stage?: PipelineStage; owner?: string }
  | ({ type: 'createTournament'; name: string; publish?: boolean } & Partial<Omit<TournamentDefinition, 'name'>>)
  | { type: 'copyTournamentWeek'; sourceWeek: string; targetWeek: string; tournaments: WeekCopy[]; publish: boolean }
  | ({ type: 'updateTournament' } & TournamentDefinition)
  | { type: 'publishTournament' }
  | { type: 'setWaitlistArrival'; playerId: string; arrived: boolean }
  | { type: 'admitWaitlist'; playerId: string; tableNo?: number; seatNo?: number }
  | { type: 'removeWaitlist'; playerId: string }
  | { type: 'start' | 'finish' | 'autoSeat' }
  | { type: 'toggleClock' | 'nextLevel'; revision?: number };
export const levels = formats.Deepstack;
export function remaining(clock: Clock, now: number) {
  return Math.max(0, clock.remaining - (clock.startedAt === null ? 0 : Math.max(0, Math.floor((now - clock.startedAt) / 1000))));
}

