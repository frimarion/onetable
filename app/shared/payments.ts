import type { Payment } from './model.ts';
import { methods } from './operations.ts';

export const paymentLabels: Record<Payment['kind'], string> = {
  payment: 'Оплата', reentry: 'Реэнтри', buyin: 'Вход', addon: 'Аддон',
};

export const paymentMethodLabel = (method: Payment['method']) =>
  method === 'prior' ? 'Учтён ранее' : method ? methods[method] : 'Способ не указан';

export function amountDue(items: Payment[]) {
  return items.reduce((sum, item) => sum + (item.waived ? 0 : item.kind === 'payment' ? -item.amount : item.amount), 0);
}

export function isCashReceiptFor(item: Payment, tournamentId: string) {
  return item.kind === 'payment' && (item.collectedAtTournament ?? item.tournamentId) === tournamentId && item.method !== 'prior';
}

