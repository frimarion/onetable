import type { Transaction } from '@electric-sql/pglite';
import type { Clock, Tournament } from '../shared/model.ts';
import { defaultConfig, defaultDisplay, formats, type Config, type DisplaySettings, type Level, type ManualBreak, type ManualStats } from '../shared/operations.ts';
import { DomainError } from './validation.ts';

export type StateRow = Tournament & {
  level: number; remaining: number; startedAt: string | number | null; revision: number;
  config: Partial<Config>; structure: Level[] | null; manualBreak: ManualBreak | null; display: Partial<DisplaySettings>; manualStats: ManualStats;
};
export const configOf = (row: StateRow) => ({ ...defaultConfig, ...row.config });
export const structureOf = (row: StateRow) => row.structure ?? formats.Deepstack;
export const displayOf = (row: StateRow) => ({ ...defaultDisplay, ...row.display });

export function assertStructureEditable(row: StateRow, next: Level[]) {
  if (row.state !== 'live') return;
  const previous = structureOf(row);
  if (next.length <= row.level || next.slice(0, row.level + 1).some((level, index) => {
    const old = previous[index];
    return level.kind !== old.kind || level.duration !== old.duration || level.small !== old.small ||
      level.big !== old.big || level.ante !== old.ante;
  })) throw new DomainError('Во время игры можно менять только предстоящие уровни');
}

export function clock(row: StateRow, now: number): Clock {
  const structure = structureOf(row);
  if (row.manualBreak) {
    const startedAt = row.manualBreak.startedAt ?? row.manualBreak.endsAt - configOf(row).manualBreakMinutes * 60_000;
    const duration = Math.max(1, Math.ceil((row.manualBreak.endsAt - startedAt) / 1000));
    return { level: row.level, remaining: duration, duration, startedAt, manualBreak: true };
  }
  const level = Math.min(row.level, structure.length - 1);
  return { level, remaining: row.remaining, startedAt: row.startedAt === null ? null : Math.min(now, Number(row.startedAt)), duration: structure[level].duration, manualBreak: false };
}

export async function refreshClock(tx: Transaction, row: StateRow, now: number) {
  if (row.state !== 'live') return;
  const oldLevel = row.level;
  const oldBreak = row.manualBreak;
  if (row.manualBreak) {
    if (now < row.manualBreak.endsAt) return;
    row.startedAt = row.manualBreak.wasRunning ? row.manualBreak.endsAt : null;
    row.manualBreak = null;
  }
  const structure = structureOf(row);
  let end = row.startedAt === null ? null : Number(row.startedAt) + row.remaining * 1000;
  while (end !== null && end <= now && configOf(row).autoAdvance && row.level + 1 < structure.length) {
    row.level++;
    row.startedAt = end;
    row.remaining = structure[row.level].duration;
    end = Number(row.startedAt) + row.remaining * 1000;
  }
  if (oldLevel !== row.level || oldBreak !== row.manualBreak) {
    row.revision++;
    await tx.query('UPDATE tournaments SET level=$2,remaining=$3,started_at=$4,manual_break=$5,revision=$6 WHERE id=$1',
      [row.id, row.level, row.remaining, row.startedAt, row.manualBreak ? JSON.stringify(row.manualBreak) : null, row.revision]);
    const label = oldLevel !== row.level ? (structure[row.level].kind === 'break' ? 'Начался перерыв' : 'Начался следующий уровень') : 'Перерыв закончился';
    await tx.query("INSERT INTO journal (tournament_id,label,actor,time) VALUES ($1,$2,'Таймер',$3)", [row.id, label, now]);
  }
}

