import { randomToken } from './auth.ts';

const TICKET_LIFETIME_MS = 30_000;
const MAX_TICKETS = 512;
const tickets = new Map<string, { sessionToken: string; expires: number }>();

// One use, for the Doyle snapshot only. The browser never receives the session cookie value.
export function issueDoyleReadTicket(sessionToken: string, now = Date.now()): string {
  for (const [ticket, entry] of tickets) {
    if (entry.expires > now && tickets.size < MAX_TICKETS) break;
    tickets.delete(ticket);
  }
  const ticket = randomToken();
  tickets.set(ticket, { sessionToken, expires: now + TICKET_LIFETIME_MS });
  return ticket;
}

export function redeemDoyleReadTicket(authorization: string | undefined, now = Date.now()): string | undefined {
  const ticket = /^Bearer ([\w-]{43})$/.exec(authorization ?? '')?.[1];
  if (!ticket) return;
  const entry = tickets.get(ticket);
  tickets.delete(ticket);
  if (entry && entry.expires > now) return entry.sessionToken;
}
