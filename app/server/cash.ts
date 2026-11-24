import type { Transaction } from '@electric-sql/pglite';
import type { CashCommand, MoneyMethod } from '../shared/operations.ts';
import { methods } from '../shared/operations.ts';
import { charge } from './operations.ts';
import { configOf, type StateRow } from './runtime.ts';
import { DomainError, field, integer } from './validation.ts';

export const cashTypes = ['settleBalance', 'settleOldDebts', 'clearPayments', 'compEntry', 'compAddon', 'changePaymentMethod'] as const;

async function nameOf(tx: Transaction, row: StateRow, id: string) {
  const { rows: [player] } = await tx.query<{ name: string }>('SELECT name FROM players WHERE club_id=$1 AND id=$2', [row.clubId, id]);
  if (!player) throw new DomainError('Игрок не найден', 404);
  return player.name;
}

async function balance(tx: Transaction, clubId: string, tournamentId: string, playerId: string) {
  const { rows: [row] } = await tx.query<{ total: number }>(
    "SELECT COALESCE(SUM(CASE WHEN p.kind='payment' THEN -p.amount ELSE p.amount END),0)::int AS total FROM payments p LEFT JOIN entries e ON e.tournament_id=p.tournament_id AND e.player_id=p.player_id WHERE p.club_id=$1 AND p.tournament_id=$2 AND p.player_id=$3 AND NOT p.voided AND NOT p.waived AND (p.kind='payment' OR e.status IS DISTINCT FROM 'registered')",
    [clubId, tournamentId, playerId]);
  return Math.max(0, row.total);
}

function methodOf(value: unknown): MoneyMethod {
  if (typeof value !== 'string' || !Object.hasOwn(methods, value)) throw new DomainError('Выберите способ оплаты', 400);
  return value as MoneyMethod;
}

export async function postPayment(tx: Transaction, row: StateRow, playerId: string, amount: number, method: MoneyMethod | 'prior' | null, time: number, sourceId = row.id) {
  await tx.query("INSERT INTO payments (club_id,tournament_id,player_id,amount,kind,time,method,collected_at_tournament) VALUES ($1,$2,$3,$4,'payment',$5,$6,$7)", [row.clubId, sourceId, playerId, amount, time, method, row.id]);
}

export async function cashOperation(tx: Transaction, row: StateRow, action: CashCommand, time: number) {
  if (action.type === 'changePaymentMethod') {
    const method = methodOf(action.method);
    const { rows } = await tx.query(
      "UPDATE payments SET method=$4 WHERE club_id=$1 AND (tournament_id=$2 OR collected_at_tournament=$2) AND id=$3 AND kind='payment' AND NOT voided AND method IS DISTINCT FROM 'prior' RETURNING id",
      [row.clubId, row.id, integer(action.paymentId, 1, Number.MAX_SAFE_INTEGER), method]);
    if (!rows.length) throw new DomainError('Платёж недоступен для изменения');
    return 'Способ оплаты изменён · ' + methods[method];
  }
  const playerId = field(action.playerId, 80, true);
  const name = await nameOf(tx, row, playerId);
  if (action.type === 'settleBalance') {
    const method = methodOf(action.method);
    const due = await balance(tx, row.clubId, row.id, playerId);
    if (due === 0 || due !== action.expectedDue) throw new DomainError('Остаток изменился. Проверьте сумму и повторите');
    const amount = action.amount === undefined ? due : integer(action.amount, 1, due, 'Сумма должна быть в пределах остатка');
    await postPayment(tx, row, playerId, amount, method, time);
    return name + ' · оплата ' + amount + ' ₽ · ' + methods[method];
  }
  if (action.type === 'settleOldDebts') {
    const method = action.method === 'prior' ? 'prior' : methodOf(action.method);
    if (!Array.isArray(action.debts) || !action.debts.length || action.debts.length > 100) throw new DomainError('Выберите долги', 400);
    const seen = new Set<string>();
    let total = 0;
    for (const debt of action.debts) {
      const id = field(debt?.id, 100, true);
      if (id === row.id || seen.has(id)) throw new DomainError('Спорный список долгов', 400);
      seen.add(id);
      const { rows } = await tx.query("SELECT id FROM tournaments WHERE id=$1 AND club_id=$2 AND state='finished'", [id, row.clubId]);
      if (!rows.length) throw new DomainError('Прошлый турнир не найден', 404);
      const due = await balance(tx, row.clubId, id, playerId);
      if (!due || due !== debt.amount) throw new DomainError('Долг за прошлый турнир изменился. Обновите суммы');
      await postPayment(tx, row, playerId, due, method, time, id);
      total += due;
    }
    return name + ' · ' + (method === 'prior' ? 'учтено ранее' : 'погашен прошлый долг') + ' · ' + total + ' ₽';
  }
  const params = [row.id, playerId];
  if (action.type === 'clearPayments') {
    const { rows } = await tx.query<{ id: number }>("SELECT id::int FROM payments WHERE tournament_id=$1 AND player_id=$2 AND kind='payment' AND NOT voided", params);
    if (!Array.isArray(action.paymentIds)) throw new DomainError('Укажите платежи для отмены', 400);
    const expected = new Set(action.paymentIds);
    if (expected.size !== rows.length || rows.some(item => !expected.has(item.id))) {
      throw new DomainError('Список оплат изменился. Проверьте его перед отменой');
    }
    await tx.query("UPDATE payments SET voided=true WHERE tournament_id=$1 AND player_id=$2 AND kind='payment' AND NOT voided", params);
    if (action.resetTerms) {
      if (row.state === 'finished') throw new DomainError('Тариф и льготы завершённого турнира зафиксированы');
      const updated = await tx.query('UPDATE entries SET rate=100,addon=false,addon_tier=0,addon_chips=NULL,addon_granted_free=false WHERE tournament_id=$1 AND player_id=$2 RETURNING player_id', params);
      if (!updated.rows.length) throw new DomainError('Игрок не записан на турнир', 404);
      await tx.query("UPDATE payments SET amount=COALESCE(original_amount,amount),waived=false WHERE tournament_id=$1 AND player_id=$2 AND kind IN ('buyin','reentry') AND NOT voided", params);
      await tx.query("UPDATE payments SET voided=true WHERE tournament_id=$1 AND player_id=$2 AND kind='addon' AND NOT voided", params);
      return name + ' · расчёт сброшен · отменено оплат: ' + rows.length;
    }
    if (!rows.length) throw new DomainError('У игрока нет сохранённых оплат');
    return name + ' · отменено оплат: ' + rows.length;
  }
  const { rows: [entry] } = await tx.query<{ addon: boolean; addonGrantedFree: boolean; status: string }>('SELECT addon,addon_granted_free AS "addonGrantedFree",status FROM entries WHERE tournament_id=$1 AND player_id=$2', params);
  if (!entry || entry.status === 'registered' || row.state === 'finished') throw new DomainError('Льготы доступны пришедшим игрокам действующего турнира');
  if (typeof action.enabled !== 'boolean') throw new DomainError('Укажите состояние льготы', 400);
  if (action.type === 'compEntry') {
    const { rows } = await tx.query<{ id: number; waived: boolean }>(
      "SELECT id::int,waived FROM payments WHERE tournament_id=$1 AND player_id=$2 AND NOT voided AND kind IN ('buyin','reentry') AND (amount>0 OR waived) ORDER BY waived DESC, CASE WHEN kind='reentry' THEN 0 ELSE 1 END,id DESC LIMIT 1", params);
    const charge = rows[0];
    if (!charge) throw new DomainError('У игрока нет начисления за вход или реэнтри');
    if (charge.waived !== action.enabled) await tx.query('UPDATE payments SET waived=$2 WHERE id=$1', [charge.id, action.enabled]);
    return name + (action.enabled ? ' · применён бесплатный вход или реэнтри' : ' · бесплатный вход или реэнтри отменён');
  }
  if (!configOf(row).addon) throw new DomainError('Аддон выключен в настройках турнира');
  if (entry.status !== 'active' && !entry.addon) throw new DomainError('Игрок должен быть в игре');
  if (action.enabled && !entry.addon) {
    await tx.query('UPDATE entries SET addon=true,addon_tier=1,addon_chips=$3,addon_granted_free=true WHERE tournament_id=$1 AND player_id=$2', [...params, configOf(row).addonChips]);
    await charge(tx, row, playerId, configOf(row).addonCost, 'addon', time, true);
  } else if (action.enabled) {
    await tx.query("UPDATE payments SET waived=true WHERE tournament_id=$1 AND player_id=$2 AND kind='addon' AND NOT voided", params);
  } else if (entry.addonGrantedFree) {
    const { rows } = await tx.query("UPDATE payments SET voided=true WHERE tournament_id=$1 AND player_id=$2 AND kind='addon' AND NOT voided AND waived RETURNING id", params);
    if (!rows.length) throw new DomainError('Бесплатный аддон не найден');
    await tx.query('UPDATE entries SET addon=false,addon_tier=0,addon_chips=NULL,addon_granted_free=false WHERE tournament_id=$1 AND player_id=$2', params);
  } else {
    const { rows } = await tx.query("UPDATE payments SET waived=false WHERE tournament_id=$1 AND player_id=$2 AND kind='addon' AND NOT voided AND waived RETURNING id", params);
    if (!rows.length) throw new DomainError('Бесплатный аддон не найден');
  }
  return name + (action.enabled ? ' · применён бесплатный аддон' : ' · бесплатный аддон отменён');
}

