import { useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, Check, ChevronDown, ChevronUp, CreditCard, Download, RotateCcw, Smartphone } from 'lucide-react';
import { methods, type MoneyMethod } from '../shared/operations';
import type { Entry, Payment, Player, Snapshot } from '../shared/model';
import { amountDue, isCashReceiptFor, paymentLabels, paymentMethodLabel } from '../shared/payments';
import { matchesQuery } from '../shared/search';
import type { Run } from './api';
import type { Modal } from './crm';
import { Person, SearchBox, money } from './widgets';

const tender = [
  { key: 'card', Icon: CreditCard },
  { key: 'cash', Icon: Banknote },
  { key: 'transfer', Icon: Smartphone },
] as const;

type Debt = { id: string; name: string; amount: number };
type Account = { player: Player; entry?: Entry; items: Payment[]; history: Payment[]; charged: number; paid: number; due: number; debts: Debt[] };

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    const group = groups.get(id);
    if (group) group.push(item);
    else groups.set(id, [item]);
  }
  return groups;
}

function accountsFor(data: Snapshot): Account[] {
  const byPlayer = groupBy(data.payments, item => item.playerId);
  const entries = new Map(data.entries.map(entry => [entry.playerId, entry]));
  const closed = new Set(data.schedule.filter(item => item.state === 'finished').map(item => item.id));
  const current = data.tournament.id;
  return data.roster.flatMap(player => {
    const entry = entries.get(player.id);
    const attended = !!entry && entry.status !== 'registered';
    const movements = byPlayer.get(player.id) ?? [];
    const items = movements.filter(item => item.tournamentId === current);
    const history = movements.filter(item => item.tournamentId === current || item.collectedAtTournament === current);
    if (!attended && !history.length) return [];
    const past = attended ? movements.filter(item => item.tournamentId !== current && closed.has(item.tournamentId)) : [];
    const debts = [...groupBy(past, item => item.tournamentId)].flatMap(([id, ledger]) => {
      const amount = amountDue(ledger);
      return amount > 0 ? [{ id, name: ledger[0].tournamentName, amount }] : [];
    });
    return [{
      player, entry, items, history, debts,
      charged: items.filter(item => item.kind !== 'payment' && !item.waived).reduce((sum, item) => sum + item.amount, 0),
      paid: items.filter(item => item.kind === 'payment').reduce((sum, item) => sum + item.amount, 0),
      due: amountDue(items),
    }];
  });
}

function PaymentRow({ account, data, expanded, toggle, busy, run, open }: {
  account: Account; data: Snapshot; expanded: boolean; toggle: () => void; busy: boolean; run: Run; open: (modal: Modal) => void;
}) {
  const { player, entry, items, history, charged, paid, due, debts } = account;
  const [method, setMethod] = useState<MoneyMethod>('card');
  const [partialOpen, setPartialOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const partialInput = useRef<HTMLInputElement>(null);
  const [skippedDebts, setSkippedDebts] = useState<Set<string>>(new Set());
  const payments = items.filter(item => item.kind === 'payment');
  const paidByMethod = [...groupBy(history.filter(item => item.kind === 'payment'), item =>
    (item.method ?? 'none') + '|' + (item.tournamentId === data.tournament.id ? 'curr' : 'past'))]
    .map(([, group]) => ({
      method: group[0].method,
      label: paymentMethodLabel(group[0].method) + (group[0].tournamentId === data.tournament.id ? '' : ' · прошлый долг'),
      amount: group.reduce((sum, item) => sum + item.amount, 0),
    }));
  const balance = Math.max(0, due);
  // Полностью оплачено одним способом — способ дописываем в статус, без отдельной строки.
  const singleMethod = due === 0 && paid > 0 && paidByMethod.length === 1 && paidByMethod[0].amount === paid;
  const singleMethodKey = singleMethod && paidByMethod[0].method && paidByMethod[0].method !== 'prior' ? paidByMethod[0].method : null;
  const oldBalance = debts.reduce((sum, debt) => sum + debt.amount, 0);
  const canAdjust = !!entry && data.tournament.state !== 'finished';
  const attended = !!entry && entry.status !== 'registered';
  const compedEntry = items.some(item => (item.kind === 'buyin' || item.kind === 'reentry') && item.waived);
  const compedAddon = items.some(item => item.kind === 'addon' && item.waived);
  const chosenDebts = debts.filter(debt => !skippedDebts.has(debt.id));
  const chosenTotal = chosenDebts.reduce((sum, debt) => sum + debt.amount, 0);
  useEffect(() => {
    if (partialOpen) partialInput.current?.focus();
  }, [partialOpen]);
  const settle = (partial?: number) => run({ type: 'settleBalance', playerId: player.id, expectedDue: balance, method, amount: partial }, () => {
    setAmount('');
    if (partial === undefined || partial === balance) setPartialOpen(false);
  });
  const voidOne = (item: Payment) => open({
    mode: 'confirm', title: 'Отменить платёж?', message: player.name + ' · ' + money(item.amount) + ' · ' + paymentMethodLabel(item.method) + '. Сумма вернётся в остаток.',
    label: 'Отменить платёж', action: { type: 'voidPayment', paymentId: item.id },
  });
  function quickVoid() {
    if (payments.length === 1) return voidOne(payments[0]);
    open({ mode: 'confirm', title: 'Отменить все оплаты за этот турнир?', message: player.name + ' · ' + money(paid) + '. Начисления и льготы сохранятся.',
      label: 'Отменить все оплаты', action: { type: 'clearPayments', playerId: player.id, paymentIds: payments.map(item => item.id) } });
  }
  const settleOlder = (type: MoneyMethod | 'prior') => {
    const action = { type: 'settleOldDebts', playerId: player.id, method: type, debts: chosenDebts } as const;
    if (type !== 'prior') return run(action);
    open({ mode: 'confirm', title: 'Отметить долг как учтённый ранее?',
      message: player.name + ' · ' + money(chosenTotal) + '. Эта сумма не попадёт в поступления кассы.',
      label: 'Подтвердить', action });
  };
  return <article className="cash-account" aria-label={player.name}>
    <div className="cash-line">
      <div className="cash-identity">
        <button className="cash-person full-row" type="button" onClick={toggle} aria-expanded={expanded}>
          <Person name={player.name} nickname={player.nickname} photoUrl={player.photoUrl} detail={entry?.status === 'out' ? 'Вылетел'
            : entry?.status === 'registered' ? 'Ожидает прихода' : undefined} />
        </button>
      </div>
      <div className={'cash-balance' + (balance > 0 ? ' owing' : singleMethodKey ? ' method-' + singleMethodKey : '')}>
        <strong>{money(due < 0 ? -due : balance || paid)}</strong>
        <small>{due < 0 ? 'Переплата' : balance > 0 ? 'К оплате' : paid > 0 ? 'Оплачено' + (singleMethod ? ' · ' + paidByMethod[0].label.toLowerCase() : '') : 'Без начислений'}</small>
        {paidByMethod.length > 0 && !singleMethod && <small className="cash-paid-methods">
          Внесено: {paidByMethod.map((item, idx) => <span key={idx} className={item.method && item.method !== 'prior' ? 'pay-method-text method-' + item.method : undefined}>
            {idx > 0 ? ', ' : ''}{item.label.toLowerCase()} {money(item.amount)}
          </span>)}
        </small>}
        {oldBalance > 0 && <small className="previous-debt">Ранее {money(oldBalance)}</small>}
      </div>
      <div className="cash-actions">
        {(balance > 0 || oldBalance > 0) && <>
          <div className="cash-methods" role="group" aria-label={'Способ оплаты: ' + player.name}>
            {tender.map(({ key, Icon }) => <button key={key} className={'button icon cash-method method-' + key} aria-pressed={method === key} aria-label={methods[key]} title={methods[key]}
              disabled={busy} onClick={() => setMethod(key)}><Icon size={18} /></button>)}
          </div>
          {balance > 0 && <button className="button primary cash-save" disabled={busy} title={'Сохранить ' + money(balance) + ' · ' + methods[method]}
            aria-label={'Сохранить ' + money(balance) + ' · ' + methods[method]} onClick={() => settle()}><Check size={16} /> Сохранить</button>}
          {balance > 0 && <button type="button" className="button" disabled={busy} aria-expanded={partialOpen}
            onClick={() => setPartialOpen(current => !current)}>Частями</button>}
        </>}
        {payments.length > 0 && <button className={balance > 0 ? 'button icon' : 'button'} disabled={busy} title={payments.length === 1 ? 'Отменить оплату' : 'Отменить все оплаты'}
          aria-label={payments.length === 1 ? 'Отменить оплату' : 'Отменить все оплаты'} onClick={quickVoid}><RotateCcw size={17} />{balance === 0 && 'Отменить'}</button>}
      </div>
      <button className="button icon cash-toggle" title={expanded ? 'Свернуть расчёт' : 'Детали расчёта'} aria-label={expanded ? 'Свернуть расчёт' : 'Детали расчёта'} aria-expanded={expanded} onClick={toggle}>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
    </div>
    {balance > 0 && partialOpen && <div className="cash-details cash-partial-details">
      <div className="cash-detail-group">
        <strong>Частичная оплата</strong>
        <form className="cash-partial" onSubmit={event => {
          event.preventDefault();
          const sum = Number(amount);
          if (Number.isInteger(sum) && sum > 0 && sum <= balance) void settle(sum);
        }}>
          <div className="actions">
            <button className="button compact" type="button" disabled={busy}
              onClick={() => setAmount(String(Math.min(balance, Math.round(charged / 2))))}>50% начисления</button>
            <button className="button compact" type="button" disabled={busy} onClick={() => setAmount(String(balance))}>Остаток</button>
          </div>
          <div className="actions">
            <label className="inline-field">Сумма, ₽<input ref={partialInput} type="number" inputMode="numeric" required min={1} max={balance}
              value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} /></label>
            <button className="button" disabled={busy}>Записать · {methods[method]}</button>
          </div>
        </form>
      </div>
    </div>}
    {expanded && <div className="cash-details">
      {canAdjust && <div className="cash-detail-group">
        <strong>Тариф входов</strong>
        <div className="actions">
          {([100, 50, 0] as const).map(rate => <button key={rate} className="button compact cash-choice" aria-pressed={entry.rate === rate}
            disabled={busy} onClick={() => run({ type: 'setTariff', playerId: player.id, rate })}>{rate === 0 ? 'Бесплатно' : rate + '%'}</button>)}
          {attended && (compedEntry || items.some(item => (item.kind === 'buyin' || item.kind === 'reentry') && item.amount > 0)) &&
            <button className="button compact cash-choice" aria-pressed={compedEntry} disabled={busy}
              onClick={() => run({ type: 'compEntry', playerId: player.id, enabled: !compedEntry })}>Бесплатный вход / реэнтри</button>}
          {(payments.length > 0 || entry.rate !== 100 || compedEntry || entry.addon) && <button className="button compact" disabled={busy} onClick={() => open({
            mode: 'confirm', title: 'Сбросить расчёт игрока?',
            message: player.name + ' · Сохранённые оплаты, скидки и аддон будут отменены. Входы и реэнтри вернутся к полному тарифу.',
            label: 'Сбросить расчёт', action: { type: 'clearPayments', playerId: player.id, paymentIds: payments.map(item => item.id), resetTerms: true },
          })}>Сбросить расчёт</button>}
          {data.config.addon && (entry.status === 'active' || entry.addon) && <button className="button compact cash-choice" aria-pressed={compedAddon}
            disabled={busy} onClick={() => run({ type: 'compAddon', playerId: player.id, enabled: !compedAddon })}>Бесплатный аддон</button>}
        </div>
      </div>}
      {debts.length > 0 && <div className="cash-detail-group">
        <strong>Долги прошлых турниров</strong>
        {debts.map(debt => <label className="cash-debt" key={debt.id}>
          <input type="checkbox" checked={!skippedDebts.has(debt.id)} disabled={busy} onChange={event => {
            const next = new Set(skippedDebts);
            if (event.target.checked) next.delete(debt.id); else next.add(debt.id);
            setSkippedDebts(next);
          }} />
          <span>{debt.name}</span><strong>{money(debt.amount)}</strong>
        </label>)}
        <div className="actions">
          <button className="button" disabled={busy || !chosenTotal} onClick={() => settleOlder(method)}>Погасить {money(chosenTotal)} · {methods[method]}</button>
          <button className="button" disabled={busy || !chosenTotal} onClick={() => settleOlder('prior')}>Учтён ранее</button>
        </div>
      </div>}
      <div className="cash-detail-group cash-ledger">
        <strong>История операций</strong>
        {history.length ? history.map(item => {
          const methodClass = item.kind === 'payment' && item.method && item.method !== 'prior' ? ' method-' + item.method : '';
          return <div key={item.id} className={'cash-movement' + methodClass}>
          <span>{paymentLabels[item.kind]}{item.kind === 'payment' ? <> · <em className="cash-movement-method">{paymentMethodLabel(item.method)}</em></> : item.waived ? ' · Бесплатно' : ''}
            {item.tournamentId !== data.tournament.id && <small>{item.tournamentName}</small>}
          </span>
          <strong>{money(item.waived ? 0 : item.amount)}</strong>
          {item.kind === 'payment' && <div className="actions">
            {item.method !== 'prior' && <select className="button compact" aria-label={'Изменить способ оплаты · ' + money(item.amount)} disabled={busy} value={item.method ?? ''}
              onChange={event => run({ type: 'changePaymentMethod', paymentId: item.id, method: event.target.value as MoneyMethod })}>
              {!item.method && <option value="" disabled>Способ</option>}
              {tender.map(({ key }) => <option key={key} value={key}>{methods[key]}</option>)}
            </select>}
            <button className="button compact" disabled={busy} aria-label={'Отменить платёж · ' + money(item.amount)} onClick={() => voidOne(item)}>Отменить</button>
          </div>}
        </div>; }) : <p className="muted">Операций пока нет</p>}
      </div>
    </div>}
  </article>;
}

export function Finance({ data, open, run, busy, exportPayments }: {
  data: Snapshot; open: (modal: Modal) => void; run: Run; busy: boolean; exportPayments: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const id = data.tournament.id;
  const accounts = useMemo(() => accountsFor(data), [data]);
  const hasDebt = (account: Account) => account.due > 0 || account.debts.length > 0;
  const isPaid = (account: Account) => !hasDebt(account) && account.history.some(item => item.kind === 'payment');
  const visible = accounts.filter(account => matchesQuery(query, [account.player.name, account.player.nickname]) &&
    (filter === 'all' || (filter === 'debt' ? hasDebt(account) : isPaid(account))))
    .sort((left, right) => {
      const leftOut = left.entry?.status === 'out';
      const rightOut = right.entry?.status === 'out';
      return Number(isPaid(left)) - Number(isPaid(right)) || Number(rightOut) - Number(leftOut) ||
        (leftOut && rightOut ? (right.entry?.bustedAt ?? 0) - (left.entry?.bustedAt ?? 0) : 0) ||
        Number(hasDebt(right)) - Number(hasDebt(left));
    });
  const receipts = data.payments.filter(item => isCashReceiptFor(item, id));
  const charged = accounts.reduce((sum, item) => sum + item.charged, 0);
  const received = receipts.reduce((sum, item) => sum + item.amount, 0);
  const debt = accounts.reduce((sum, item) => sum + Math.max(0, item.due), 0);
  async function download() {
    setExporting(true);
    setExportError('');
    try { await exportPayments(); }
    catch (error) { setExportError(error instanceof Error ? error.message : 'Не удалось скачать отчёт'); }
    finally { setExporting(false); }
  }
  return <section className="cash-screen" aria-labelledby="cash-heading">
    <div className="section-head"><h2 id="cash-heading">Оплаты турнира</h2>
      <button className="button" disabled={busy || exporting} onClick={() => void download()}>
        <Download size={16} /> {exporting ? 'Готовим отчёт…' : 'Отчёт Excel'}
      </button>
    </div>
    {exportError && <p className="alert" role="alert">{exportError}</p>}
    <dl className="panel cash-summary">
      {([['Начислено', charged], ['Получено', received], ['К оплате', debt]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}
    </dl>
    <div className="cash-totals" aria-label="Поступления по способам">
      {tender.map(({ key, Icon }) => <span key={key} className={'cash-total-pill method-' + key}><Icon size={15} />{methods[key]} <strong>{money(receipts.filter(item => item.method === key).reduce((sum, item) => sum + item.amount, 0))}</strong></span>)}
      {receipts.some(item => !item.method) && <span className="cash-total-pill">Без способа <strong>{money(receipts.filter(item => !item.method).reduce((sum, item) => sum + item.amount, 0))}</strong></span>}
    </div>
    <div className="section-head cash-toolbar">
      <SearchBox value={query} onChange={setQuery} placeholder="Ник или имя" />
      <label className="sr-only" htmlFor="cash-filter">Фильтр оплат</label>
      <select id="cash-filter" className="button" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">Все игроки</option><option value="debt">С долгом</option><option value="paid">Оплачено</option>
      </select>
    </div>
    <div className="panel cash-list">
      {visible.map(account => <PaymentRow key={account.player.id} account={account} data={data} busy={busy} run={run} open={open}
        expanded={selected === account.player.id} toggle={() => setSelected(selected === account.player.id ? undefined : account.player.id)} />)}
      {!visible.length && <p className="empty">Игроки не найдены</p>}
    </div>
  </section>;
}

