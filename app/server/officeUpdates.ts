import type { ServerResponse } from 'node:http';

const subscribers = new Map<string, Set<ServerResponse>>();
const update = 'data: refresh\n\n';

function sendUpdate(res: ServerResponse) {
  if (!res.destroyed && !res.write(update)) res.destroy();
}

export function subscribeToOfficeUpdates(clubId: string, res: ServerResponse) {
  if (res.destroyed) return;
  const listeners = subscribers.get(clubId) ?? new Set<ServerResponse>();
  subscribers.set(clubId, listeners);
  listeners.add(res);
  const heartbeat = setInterval(() => sendUpdate(res), 20_000);
  const expiry = setTimeout(() => res.end(), 5 * 60_000);
  res.once('close', () => {
    clearInterval(heartbeat);
    clearTimeout(expiry);
    listeners.delete(res);
    if (!listeners.size) subscribers.delete(clubId);
  });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  sendUpdate(res);
}

export function notifyOfficeUpdate(clubId: string) {
  subscribers.get(clubId)?.forEach(sendUpdate);
}
