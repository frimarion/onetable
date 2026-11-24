import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import type { Command } from './shared/model.ts';
import { seed, sessions } from './server/seed.ts';
import { command, DomainError, snapshot } from './server/tournament.ts';
import { publicSchedule } from './server/definitions.ts';
import { onlineRegistration } from './server/registration.ts';
import { paymentWorkbook } from './server/paymentWorkbook.ts';

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 128_000) throw new DomainError('Запрос слишком большой', 413);
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DomainError('Неверный формат запроса', 400); }
}

function localApi(): Plugin {
  const connect = async () => {
    const directory = process.env.ONETABLE_DATA_DIR || '.data/postgres';
    await mkdir(dirname(directory), { recursive: true });
    const db = new PGlite(directory);
    await db.exec(await readFile(new URL('./server/schema.sql', import.meta.url), 'utf8'));
    await seed(db);
    return db;
  };
  let database: ReturnType<typeof connect> | undefined;
  async function api(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next();
    const send = (code: number, data: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    try {
      if (req.method === 'GET' && url.pathname === '/api/demo') return send(200, sessions);
      const schedule = /^[/]api[/]public[/]clubs[/]([a-zA-Z0-9_-]+)[/]schedule$/.exec(url.pathname);
      if (req.method === 'GET' && schedule) return send(200, await publicSchedule(await (database ??= connect()), schedule[1]));
      const registration = /^[/]api[/]public[/]clubs[/]([a-zA-Z0-9_-]+)[/]tournaments[/]([a-zA-Z0-9_-]+)[/]registration$/.exec(url.pathname);
      if (req.method === 'POST' && registration) return send(200, await onlineRegistration(await (database ??= connect()),
        registration[1], registration[2], await readJson(req)));
      const session = sessions.find(item => req.headers.authorization === 'Bearer ' + item.token);
      if (!session) return send(401, { error: 'Выберите профиль для входа' });
      const match = /^[/]api[/]tournaments[/]([a-zA-Z0-9_-]+)([/](?:commands|payments\.xlsx))?$/.exec(url.pathname);
      const create = url.pathname === '/api/clubs/' + session.club.id + '/tournaments';
      if (!match && !create) return send(404, { error: 'Страница не найдена' });
      const id = match?.[1] ?? null;
      const db = await (database ??= connect());
      if (req.method === 'GET' && id && match?.[2] === '/payments.xlsx') {
        if (session.role !== 'admin') throw new DomainError('Нет доступа к отчёту', 403);
        const data = await snapshot(db, session, id);
        const file = await paymentWorkbook(data);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('Оплаты — ' + data.tournament.name + '.xlsx').replaceAll("'", '%27'),
          'Cache-Control': 'no-store',
        });
        return res.end(file);
      }
      if (req.method === 'GET' && id && !match?.[2]) return send(200, await snapshot(db, session, id));
      if (req.method === 'POST' && (create || match?.[2] === '/commands')) {
        const payload: { id?: unknown; action?: Command } | null = await readJson(req);
        if (!payload?.action || typeof payload.id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(payload.id)) {
          throw new DomainError('Укажите идентификатор и действие', 400);
        }
        return send(200, await command(db, session, id, payload.id, payload.action));
      }
      send(405, { error: 'Метод не поддерживается' });
    } catch (error) {
      if (!(error instanceof DomainError)) console.error(error);
      send(error instanceof DomainError ? error.status : 500, {
        error: error instanceof DomainError ? error.message : 'Операция не выполнена. Попробуйте ещё раз',
      });
    }
  }
  return {
    name: 'onetable-app-local-api',
    configureServer(server) { server.middlewares.use(api); },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
  server: { host: '127.0.0.1', port: 4180, strictPort: true, fs: { allow: ['.'], deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.data/**'] } },
});
