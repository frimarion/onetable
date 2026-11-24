import ExcelJS from 'exceljs';
import type { Payment, Snapshot } from '../shared/model.ts';
import { methods } from '../shared/operations.ts';
import { isCashReceiptFor, paymentLabels, paymentMethodLabel } from '../shared/payments.ts';
import { moscowInput } from '../shared/schedule.ts';

const green = 'FF93C47D';
const paleGreen = 'FFD9EAD3';
const grid = 'FFC7D7C1';
const integerFormat = '#,##0;[Red]-#,##0;0';
const dateFormat = 'dd.mm.yyyy';

type CellValue = ExcelJS.CellValue;

function formatRow(row: ExcelJS.Row, columns: number, background: string, bold = false) {
  for (let column = 1; column <= columns; column++) {
    const cell = row.getCell(column);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: background } };
    cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF253323' }, bold };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: grid } } };
  }
}

function reportSheet(workbook: ExcelJS.Workbook, name: string, title: string, detail: string, headers: string[], widths: number[], frozen: number) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: frozen, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  sheet.columns = widths.map(width => ({ width }));
  for (const [row, value] of [[1, title], [2, detail]] as const) {
    sheet.mergeCells(row, 1, row, widths.length);
    const cell = sheet.getCell(row, 1);
    cell.value = value;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: row === 1 ? green : 'FFF2F8EF' } };
    cell.font = { name: 'Calibri', size: row === 1 ? 16 : 11, color: { argb: 'FF253323' }, bold: row === 1 };
    cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    sheet.getRow(row).height = row === 1 ? 34 : 24;
  }
  const headings = sheet.addRow(headers);
  formatRow(headings, widths.length, paleGreen, true);
  headings.height = 34;
  return sheet;
}

function sum(payments: Payment[]) {
  return payments.reduce((total, payment) => total + (payment.waived ? 0 : payment.amount), 0);
}

function sheetDate(time: number | string) {
  return new Date(moscowInput(new Date(time).toISOString()) + ':00Z');
}

export async function paymentWorkbook(data: Snapshot) {
  const tournament = data.tournament;
  const id = tournament.id;
  const date = tournament.startsAt ? sheetDate(tournament.startsAt) : null;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OneTable';
  workbook.created = new Date(data.serverTime);
  const main = reportSheet(workbook, 'Оплаты', 'Оплаты · ' + tournament.name, data.club.name + ' · суммы в рублях',
    ['Дата', 'Турнир', 'Игрок', 'Входы', 'Аддон', 'Бай-ин', 'Бесплатный вход', 'Начислено', 'Получено в кассу',
      'Задолженность', methods.card, methods.cash, methods.transfer, 'Без способа', 'Прошлые долги', 'Учтено вне кассы'],
    [14, 24, 28, 9, 12, 12, 13, 14, 15, 16, 12, 12, 14, 14, 15, 16], 4);
  const totals = main.addRow(['Итого по турниру']);
  main.mergeCells('A4:C4');
  formatRow(totals, 16, paleGreen, true);
  totals.height = 25;

  const relevant = data.payments.filter(item => item.tournamentId === id || item.collectedAtTournament === id);
  const byPlayer = new Map<string, Payment[]>();
  for (const item of relevant) {
    const items = byPlayer.get(item.playerId);
    if (items) items.push(item);
    else byPlayer.set(item.playerId, [item]);
  }
  const entries = new Map(data.entries.filter(entry => entry.status !== 'registered').map(entry => [entry.playerId, entry]));
  const totalsByColumn = new Map<number, number>();
  for (const player of data.roster) {
    const entry = entries.get(player.id);
    const history = byPlayer.get(player.id) ?? [];
    if (!entry && !history.length) continue;
    const currentItems = history.filter(item => item.tournamentId === id);
    const charges = currentItems.filter(item => item.kind !== 'payment');
    const cashReceipts = history.filter(item => isCashReceiptFor(item, id));
    const priorDebtReceipts = cashReceipts.filter(item => item.tournamentId !== id);
    const offCashCurrent = currentItems.filter(item => item.kind === 'payment' && !isCashReceiptFor(item, id));
    const buyIn = charges.find(item => item.kind === 'buyin');
    const charged = sum(charges);
    const received = sum(cashReceipts);
    const priorDebtPaid = sum(priorDebtReceipts);
    const offCashPaid = sum(offCashCurrent);
    const paidCurrent = received - priorDebtPaid + offCashPaid;
    const due = Math.max(0, charged - paidCurrent);
    const rowValues = [date, tournament.name, player.name, entry ? 1 + entry.reentries : 0, sum(charges.filter(item => item.kind === 'addon')),
      buyIn?.amount ?? null, charges.filter(item => (item.kind === 'buyin' || item.kind === 'reentry') && (item.waived || !item.amount)).length,
      charged, received, due, sum(cashReceipts.filter(item => item.method === 'card')), sum(cashReceipts.filter(item => item.method === 'cash')),
      sum(cashReceipts.filter(item => item.method === 'transfer')), sum(cashReceipts.filter(item => item.method === null)),
      priorDebtPaid, offCashPaid];
    const row = main.addRow(rowValues);
    formatRow(row, 16, row.number % 2 ? 'FFEAF4E3' : 'FFF5FAF2');
    row.height = 33;
    row.getCell(9).value = { formula: `SUM(K${row.number}:N${row.number})`, result: received };
    row.getCell(10).value = { formula: `MAX(0,H${row.number}-(I${row.number}-O${row.number}+P${row.number}))`, result: due };
    if (due) row.getCell(10).font = { bold: true, color: { argb: 'FF9C261F' } };
    row.getCell(1).numFmt = dateFormat;
    for (let col = 4; col <= 16; col++) {
      row.getCell(col).numFmt = integerFormat;
      totalsByColumn.set(col, (totalsByColumn.get(col) ?? 0) + Number(rowValues[col - 1] ?? 0));
    }
  }
  for (const col of [4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    const letter = String.fromCharCode(64 + col);
    totals.getCell(col).value = main.rowCount > 4
      ? { formula: `SUM(${letter}5:${letter}${main.rowCount})`, result: totalsByColumn.get(col) ?? 0 }
      : 0;
    totals.getCell(col).numFmt = integerFormat;
  }
  if (main.rowCount === 4) main.addRow(['Пока нет начислений и оплат']);

  const ledger = reportSheet(workbook, 'Операции', 'Операции · ' + tournament.name,
    'Дата и время по Москве · погашения прошлых турниров отмечены отдельно',
    ['Дата и время', 'Игрок', 'Турнир начисления', 'Операция', 'Способ', 'Сумма, ₽', 'Учёт'],
    [22, 30, 32, 18, 22, 15, 26], 3);
  const names = new Map(data.roster.map(player => [player.id, player.name]));
  for (const item of relevant) {
    const note = item.waived ? 'Льгота' : item.method === 'prior' ? 'Учтён ранее'
      : item.tournamentId !== id ? 'Погашение прошлого долга' : null;
    const values: CellValue[] = [sheetDate(item.time), names.get(item.playerId) ?? null, item.tournamentName,
      paymentLabels[item.kind], item.kind === 'payment' ? paymentMethodLabel(item.method) : null, item.waived ? 0 : item.amount, note];
    const row = ledger.addRow(values);
    formatRow(row, 7, row.number % 2 ? 'FFF5FAF2' : 'FFFFFFFF');
    row.height = 30;
    row.getCell(1).numFmt = dateFormat + ' hh:mm';
    row.getCell(6).numFmt = integerFormat;
  }
  if (relevant.length) ledger.autoFilter = `A3:G${ledger.rowCount}`;
  else ledger.addRow(['Операций пока нет']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
