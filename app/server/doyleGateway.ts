import { randomToken } from './auth.ts';

const TICKET_LIFETIME_MS = 30_000;
const GRANT_IDLE_LIFETIME_MS = 15 * 60_000;
const MAX_TICKETS = 512;
const tickets = new Map<string, { sessionToken: string; expires: number; renewable: boolean }>();

// Both types are restricted to Doyle reads. A grant stays usable during active polling.
export function issueDoyleReadTicket(sessionToken: string, { now = Date.now(), renewable = false } = {}): string {
  for (const [ticket, entry] of tickets) {
    if (entry.expires <= now || tickets.size >= MAX_TICKETS) tickets.delete(ticket);
  }
  const ticket = randomToken();
  const lifetime = renewable ? GRANT_IDLE_LIFETIME_MS : TICKET_LIFETIME_MS;
  tickets.set(ticket, { sessionToken, expires: now + lifetime, renewable });
  return ticket;
}

export function redeemDoyleReadTicket(authorization: string | undefined, now = Date.now()): string | undefined {
  const ticket = /^Bearer ([\w-]{43})$/.exec(authorization ?? '')?.[1];
  if (!ticket) return;
  const entry = tickets.get(ticket);
  tickets.delete(ticket);
  if (!entry || entry.expires <= now) return;
  if (entry.renewable) {
    entry.expires = now + GRANT_IDLE_LIFETIME_MS;
    tickets.set(ticket, entry);
  }
  return entry.sessionToken;
}
