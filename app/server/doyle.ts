import { doyleQueries, optionalDoyleResources, type DoyleResource, type DoyleRows } from '../shared/doyleQueries.ts';
import type { AuthContext } from './auth.ts';
import { DomainError } from './validation.ts';

const linkedUserId = process.env.DOYLE_ONETABLE_USER_ID;
const serviceKey = process.env.DOYLE_SERVICE_ROLE_KEY;

export function hasDoyleAccess(ctx: AuthContext): boolean {
  return Boolean(serviceKey && linkedUserId === ctx.user.id && ctx.club.id === 'doyle' && ctx.memberRole === 'owner');
}

export async function readDoyleRows(ctx: AuthContext): Promise<DoyleRows> {
  if (!hasDoyleAccess(ctx)) throw new DomainError('Нет доступа к данным Doyle', 403);

  const entries = await Promise.all((Object.keys(doyleQueries) as DoyleResource[]).map(async resource => {
    try {
      const response = await fetch('http://127.0.0.1:8000/rest/v1/' + doyleQueries[resource], {
        headers: { apikey: serviceKey!, Authorization: 'Bearer ' + serviceKey! },
        redirect: 'error',
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid response');
      return [resource, rows] as const;
    } catch {
      if (optionalDoyleResources.has(resource)) return [resource, []] as const;
      throw new DomainError('Не удалось загрузить данные Doyle. Попробуйте ещё раз.', 502);
    }
  }));
  return Object.fromEntries(entries) as DoyleRows;
}
