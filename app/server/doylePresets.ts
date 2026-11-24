import type { Level, Preset } from '../shared/operations.ts';

// Doyle migrations: fix_blueprint_high_blinds.sql and doyles_final_september_structure.sql.
// Deep Stack durations are the last full version stored in SQL.
type BlindRow = [minutes: number, small: number, big: number];

const daily: BlindRow[] = [
  [16, 100, 100], [16, 100, 200], [16, 100, 300],
  [16, 200, 400], [16, 300, 600], [16, 400, 800],
  [15, 0, 0], [16, 500, 1000], [16, 600, 1200],
  [16, 800, 1600], [12, 1000, 2000], [12, 1000, 3000],
  [12, 2000, 4000], [12, 2000, 5000], [12, 3000, 6000],
  [12, 4000, 8000], [12, 5000, 10000], [12, 6000, 12000],
  [12, 8000, 16000], [12, 10000, 20000], [10, 15000, 30000],
  [10, 20000, 40000], [10, 30000, 60000], [10, 40000, 80000],
  [10, 50000, 100000], [10, 75000, 150000], [10, 100000, 200000],
  [10, 150000, 300000], [10, 200000, 400000], [10, 300000, 600000],
  [10, 400000, 800000], [10, 500000, 1000000],
];

const final: BlindRow[] = [
  [20, 100, 100], [20, 100, 200], [20, 100, 300],
  [20, 200, 400], [20, 200, 500], [20, 300, 600],
  [20, 0, 0], [20, 400, 800], [20, 500, 1000],
  [18, 600, 1200], [18, 700, 1400], [18, 800, 1600],
  [18, 1000, 2000], [18, 1500, 3000], [18, 2000, 4000],
  [18, 3000, 6000], [18, 4000, 8000], [18, 5000, 10000],
  [18, 6000, 12000], [18, 7000, 14000], [18, 8000, 16000],
  [18, 10000, 20000], [18, 15000, 30000], [18, 20000, 40000],
  [18, 25000, 50000], [18, 30000, 60000], [18, 40000, 80000],
];

function levels(rows: BlindRow[]): Level[] {
  return rows.map(([minutes, small, big]) => ({
    kind: big === 0 ? 'break' : 'play',
    duration: minutes * 60,
    small, big, ante: big,
  }));
}

export const doylePresets: Preset[] = [
  { name: 'Daily Tournament', structure: levels(daily), config: { startStack: 30_000, lateRegistration: 9, seating: false } },
  {
    name: 'Deep Stack Tournament',
    structure: levels(daily.map(([minutes, small, big], index) => [index < 6 ? 18 : minutes, small, big])),
    config: { startStack: 40_000, lateRegistration: 10, seating: false },
  },
  { name: "Doyle's Final", structure: levels(final), config: { startStack: 30_000, lateRegistration: 0, buyIn: 0, registrationLimit: 27, seating: true } },
];
