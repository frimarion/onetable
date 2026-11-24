const dayMs = 86_400_000;
const moscowOffset = 3 * 3_600_000;

export function moveDate(date: string, days: number) {
  return new Date(Date.parse(date) + days * dayMs).toISOString().slice(0, 10);
}

export function weekStart(date: string) {
  const weekday = new Date(date).getUTCDay();
  return moveDate(date, -((weekday + 6) % 7));
}

export function moscowInput(iso: string) {
  return new Date(Date.parse(iso) + moscowOffset).toISOString().slice(0, 16);
}

export function moscowIso(input: string) {
  return input ? new Date(input + ':00+03:00').toJSON() : null;
}

export function inWeek(iso: string, week: string) {
  return weekStart(moscowInput(iso).slice(0, 10)) === week;
}

export function scheduleKey(name: string, startsAt: string) {
  return startsAt + '/' + name.trim().toLocaleLowerCase('ru-RU');
}
