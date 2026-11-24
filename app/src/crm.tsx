import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import type { Command, Entry, Player, Snapshot } from '../shared/model';
import type { Run } from './api';
import { AddonControls } from './AddonControls';
import { paymentLabels } from '../shared/payments';
import { matchesQuery } from '../shared/search';
import { Person, SearchBox, entryDetail, money, pad } from './widgets';
import { CrmWorkspace } from './crm/CrmWorkspace';

export type Modal =
  | { mode: 'register' | 'add' | 'addEntry' | 'tables' | 'import' }
  | { mode: 'entry' | 'assign' | 'knockouts' | 'place' | 'bust' | 'swapOutcome'; entry: Entry }
  | { mode: 'seatBox'; tableNo: number; seatNo: number }
  | { mode: 'admitSeat'; player: Snapshot['waitlist']['people'][number] }
  | { mode: 'player'; player: Player }
  | { mode: 'confirm'; title: string; message: string; label: string; action: Command };

export function bustModal(entry: Entry, data: Snapshot): Modal {
  if (data.config.knockout) return { mode: 'bust', entry };
  return {
    mode: 'confirm', title: 'Подтвердить вылет?',
    message: entry.name + (entry.tableNo !== null ? ' освободит место за столом.' : ' выйдет из игры.'),
    label: 'Подтвердить вылет', action: { type: 'bust', playerId: entry.playerId },
  };
}

export function cancelEntry(entry: Entry): Modal {
  return {
    mode: 'confirm', title: 'Отменить запись?', message: entry.name + ' будет удалён из списка турнира.',
    label: 'Отменить запись', action: { type: 'unregister', playerId: entry.playerId },
  };
}

function account(data: Snapshot, id: string) {
  const visits = data.visits.filter(item => item.playerId === id);
  const payments = data.payments.filter(item => item.playerId === id);
  const balance = new Map<string, number>();
  for (const item of payments) balance.set(item.tournamentId,
    (balance.get(item.tournamentId) ?? 0) + (item.waived ? 0 : item.kind === 'payment' ? -item.amount : item.amount));
  const due = [...balance.values()].reduce((total, amount) => total + Math.max(0, amount), 0);
  return { visits, payments, due };
}

export function Crm({ data, run, busy, open }: { data: Snapshot; run: Run; busy: boolean; open: (modal: Modal) => void }) {
  return <CrmWorkspace data={data} run={run} busy={busy} open={open} />;
}

export function Dialog({ modal, data, run, close, busy, notice, change, finances = true }: { modal: Modal; data: Snapshot; run: Run; close: () => void; busy: boolean; notice: string; change: (modal: Modal) => void; finances?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  const live = data.tournament.state === 'live';
  const entryId = 'entry' in modal ? modal.entry.playerId : undefined;
  const entry = data.entries.find(item => item.playerId === entryId);
  const playerId = modal.mode === 'player' ? modal.player.id : undefined;
  const player = data.roster.find(item => item.id === playerId);
  const profile = modal.mode === 'entry' && data.roster.find(item => item.id === entryId);
  const creating = modal.mode === 'add' || modal.mode === 'addEntry';
  const title = modal.mode === 'tables' ? 'Столы и места' : modal.mode === 'import' ? 'Импорт списка игроков' :
    modal.mode === 'knockouts' ? 'Нокауты · ' + entry?.name : modal.mode === 'place' ? 'Место · ' + entry?.name :
    modal.mode === 'bust' ? 'Подтвердить вылет?' : modal.mode === 'swapOutcome' ? 'Поменять вылет / место · ' + (entry?.nickname || entry?.name) :
    modal.mode === 'seatBox' ? 'Стол ' + pad(modal.tableNo) + ' · Бокс ' + modal.seatNo :
    modal.mode === 'admitSeat' ? 'Посадить из листа ожидания' :
    modal.mode === 'register' ? 'Записать игрока' : creating ? 'Новый игрок' :
    player ? player.nickname || player.name : modal.mode === 'confirm' ? modal.title : modal.mode === 'assign' ? 'Назначить место' : entry?.nickname || entry?.name || 'Игрок турнира';
  const submit = (event: FormEvent<HTMLFormElement>, getAction: (fields: FormData) => Command) => {
    event.preventDefault();
    void run(getAction(new FormData(event.currentTarget)), close);
  };
  const people = data.roster.filter(item => !data.entries.some(existing => existing.playerId === item.id) &&
    !data.waitlist.people.some(queued => queued.playerId === item.id) &&
    matchesQuery(filter, [item.name, item.nickname]));
  const totals = player && account(data, player.id);

  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <div className="dialog-head"><h2 id="dialog-title">{title}</h2><button className="button icon" aria-label="Закрыть" disabled={busy} onClick={close}><X size={20} /></button></div>
    {notice && <p className="alert" role="status">{notice}</p>}
    {modal.mode === 'confirm' && <><p>{modal.message}</p><button className="button primary wide" disabled={busy} onClick={() => run(modal.action, close)}>{modal.label}</button></>}
    {modal.mode === 'register' && <>
      <SearchBox value={filter} onChange={setFilter} placeholder="Найти в CRM" />
      <div className="dialog-list">{people.map(item => <button className="person-row full-row" key={item.id} disabled={busy} onClick={() => run({ type: 'register', playerId: item.id }, close)}><Person name={item.name} nickname={item.nickname} /><Plus size={17} /></button>)}
        {!people.length && <p className="empty">Подходящих игроков для записи нет</p>}
      </div>
      <button className="button wide" disabled={busy} onClick={() => change({ mode: 'addEntry' })}><Plus size={17} /> Добавить нового игрока</button>
    </>}
    {(creating || player) && <form key={player?.id ?? 'new'} onSubmit={event => submit(event, fields => {
      const details = {
        name: String(fields.get('name')),
        nickname: String(fields.get('nickname')),
        phone: String(fields.get('phone')),
        telegram: String(fields.get('telegram')),
        instagram: String(fields.get('instagram')),
        telegramConsent: fields.get('telegramConsent') === 'on',
        source: String(fields.get('source')),
        note: String(fields.get('note')),
        tags: String(fields.get('tags')),
      };
      return player ? { type: 'updatePlayer', playerId: player.id, ...details } : { type: 'addPlayer', enroll: modal.mode === 'addEntry', ...details };
    })}>
      <label>Никнейм<input name="nickname" defaultValue={player?.nickname} maxLength={40} /></label>
      <label>Имя и фамилия<input name="name" defaultValue={player?.name} required maxLength={80} /></label>
      <label>Телефон<input name="phone" type="tel" defaultValue={player?.phone} maxLength={40} placeholder="+7 999 000-00-00" /></label>
      <label>Telegram<input name="telegram" defaultValue={player?.telegram} maxLength={60} placeholder="@username" /></label>
      <label>Instagram<input name="instagram" defaultValue={player?.instagram} maxLength={60} placeholder="@account" /></label>
      <label className="crm-checkbox"><input type="checkbox" name="telegramConsent" defaultChecked={player?.telegramConsent ?? true} /><span>Согласие на Telegram-рассылки</span></label>
      <label>Источник<input name="source" defaultValue={player?.source} maxLength={100} placeholder="Например, Telegram" /></label>
      <label>Теги<input name="tags" defaultValue={player?.tags} maxLength={120} placeholder="Например, новичок, регуляр" /></label>
      <label>Заметка<textarea name="note" defaultValue={player?.note} maxLength={500} rows={2} /></label>
      <button className="button primary wide" disabled={busy}>{modal.mode === 'addEntry' ? 'Создать и записать' : 'Сохранить карточку'}</button>
    </form>}
    {player && totals && <div className="player-history">
      <h3>Визиты · {totals.visits.length}</h3>
      {totals.visits.map(item => <div className="history-line" key={item.tournamentId}><span>{item.tournamentName}</span><span>{new Date(item.time).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</span></div>)}
      {!totals.visits.length && <p className="muted">Посещений пока нет</p>}
      {finances && <><h3>Начисления и оплаты</h3>
      {totals.payments.map(item => <div key={item.id} className="history-line"><span>{paymentLabels[item.kind]} · {item.tournamentName}</span><span>{money(item.waived ? 0 : item.amount)}</span></div>)}
      <p>К оплате {money(totals.due)}</p>
      <form onSubmit={event => submit(event, fields => ({ type: 'payment', playerId: player.id, amount: Number(fields.get('amount')) }))}>
        <label>Сумма оплаты за «{data.tournament.name}», ₽<input name="amount" type="number" min="1" max="1000000" required /></label>
        <button className="button wide" disabled={busy}>Внести оплату</button>
      </form></>}
    </div>}
        {modal.mode === 'tables' && <form onSubmit={event => submit(event, fields => ({
      type: 'configureTables', count: Number(fields.get('count')), capacity: Number(fields.get('capacity')),
    }))}>
      <label>Количество столов<input name="count" type="number" required min="1" max="20" defaultValue={data.tables.length || 3} /></label>
      <label>Мест за столом<input name="capacity" type="number" required min="2" max="10" defaultValue={data.tables[0]?.capacity ?? 8} /></label>
      <button className="button primary wide" disabled={busy}>Сохранить столы</button>
    </form>}
    {modal.mode === 'import' && <form onSubmit={event => {
      const replace = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'replace';
      submit(event, fields => ({ type: 'importNames', replace, names: String(fields.get('names')).split(/\r?\n/).map(name => name.trim()).filter(Boolean) }));
    }}>
      <label>По одному имени в строке<textarea name="names" rows={6} required maxLength={7000} /></label>
      <p className="muted">При замене списка сохранятся записи пришедших игроков и записи с начислениями или оплатами.</p>
      <button className="button primary" disabled={busy}>Добавить в список</button>
      <button className="button" value="replace" disabled={busy}>Заменить неподтверждённые записи</button>
    </form>}
    {entry && modal.mode === 'place' && <form onSubmit={event => submit(event, fields => ({
      type: 'setFinishPlace', playerId: entry.playerId, place: Number(fields.get('place')),
    }))}>
      <label>Место по итогам<input name="place" type="number" required min={data.stats.active + 1}
        max={data.results.length} defaultValue={data.results.find(item => item.playerId === entry.playerId)?.place ?? undefined} /></label>
      <p className="muted">Остальные выбывшие игроки сдвинутся в порядке вылетов.</p>
      <button className="button primary" disabled={busy}>Сохранить место</button>
    </form>}
    {entry && modal.mode === 'bust' && <form onSubmit={event => submit(event, fields => ({
      type: 'bust', playerId: entry.playerId, knockouts: Number(fields.get('knockouts')),
    }))}>
      <p>{entry.name}{entry.tableNo !== null ? ' освободит место за столом.' : ' выйдет из игры.'}</p>
      <label>Сделано нокаутов<input name="knockouts" type="number" inputMode="numeric" required min="0" max="500" defaultValue={entry.knockouts} autoFocus /></label>
      <button className="button primary wide" disabled={busy}>Подтвердить вылет</button>
    </form>}
    {entry && modal.mode === 'swapOutcome' && (() => {
      const places = new Map(data.results.map(item => [item.playerId, item.place]));
      const activeOthers = entry.status === 'out' ? data.entries.filter(item => item.playerId !== entry.playerId && item.status === 'active') : [];
      const outOthers = data.entries.filter(item => item.playerId !== entry.playerId && item.status === 'out')
        .sort((a, b) => (places.get(a.playerId) ?? 9999) - (places.get(b.playerId) ?? 9999));
      return <form onSubmit={event => submit(event, fields => ({
        type: 'swapOutcome', playerId: entry.playerId, withPlayerId: String(fields.get('withPlayerId')),
      }))}>
        <p>{entry.name} · {entry.status === 'out' ? 'Вылетел' + (places.get(entry.playerId) ? ' (' + places.get(entry.playerId) + ' место)' : '') : 'В игре'}</p>
        <label>Поменять с игроком<select name="withPlayerId" required defaultValue="">
          <option value="" disabled>Выберите игрока</option>
          {activeOthers.length > 0 && <optgroup label="В игре (вернуть вылетевшего вместо него)">
            {activeOthers.map(item => <option key={item.playerId} value={item.playerId}>
              {item.nickname || item.name}{item.tableNo !== null ? ` · стол ${item.tableNo}, место ${item.seatNo}` : ' · в игре'}
            </option>)}
          </optgroup>}
          {outOthers.length > 0 && <optgroup label={entry.status === 'out' ? 'Вылетели (поменять итоговые места)' : 'Вылетели (вернуть в игру вместо текущего)'}>
            {outOthers.map(item => <option key={item.playerId} value={item.playerId}>
              {item.nickname || item.name}{places.get(item.playerId) ? ` · ${places.get(item.playerId)} место` : ' · вылетел'}
            </option>)}
          </optgroup>}
        </select></label>
        <p className="muted">Если перепутали играющего и вылетевшего, первый займёт итоговое место второго, а второй вернётся в игру на его место за столом. Для двух вылетевших поменяются их итоговые места.</p>
        <button className="button primary wide" disabled={busy}>Поменять местами</button>
      </form>;
    })()}
    {entry && modal.mode === 'knockouts' && <form onSubmit={event => submit(event, fields => ({
      type: 'knockouts', playerId: entry.playerId, value: Number(fields.get('value')),
    }))}>
      <label>Количество нокаутов<input name="value" type="number" required min="0" max="500" defaultValue={entry.knockouts} /></label>
      <button className="button primary" disabled={busy}>Сохранить нокауты</button>
    </form>}
    {entry && modal.mode === 'entry' && <div className="dialog-actions">
      <p className="muted">{entry.nickname && entry.nickname !== entry.name ? entry.name + ' · ' : ''}{entryDetail(entry, data.config.seating)}</p>
      {live && entry.status === 'registered' && <button className="button primary" disabled={busy} onClick={() => run({ type: 'checkIn', playerId: entry.playerId }, close)}>Отметить приход</button>}
      {data.tournament.state !== 'finished' && entry.status === 'registered' && <button className="button" disabled={busy} onClick={() => change(cancelEntry(entry))}>Отменить запись</button>}
      {finances && data.tournament.state !== 'finished' && <label className="inline-field">Тариф входа<select value={entry.rate} disabled={busy} onChange={event => run({ type: 'setTariff', playerId: entry.playerId, rate: Number(event.target.value) as 0 | 50 | 100 })}>
        <option value="100">100%</option><option value="50">50%</option><option value="0">Бесплатно</option>
      </select></label>}
      {live && entry.status !== 'registered' && <div className="actions">
        <button className="button compact" disabled={busy} onClick={() => run({ type: 'adjustReentry', playerId: entry.playerId, expectedReentries: entry.reentries, delta: 1 })}>Реэнтри +1</button>
        <button className="button compact" disabled={busy || !entry.reentries} onClick={() => run({ type: 'adjustReentry', playerId: entry.playerId, expectedReentries: entry.reentries, delta: -1 })}>Реэнтри −1</button>
      </div>}
      {(live || data.tournament.state === 'finished') && data.config.knockout && entry.status !== 'registered' &&
        <button className="button" disabled={busy} onClick={() => change({ mode: 'knockouts', entry })}>Нокауты · {entry.knockouts}</button>}
      {(live || data.tournament.state === 'finished') && ((entry.status === 'out' && data.entries.some(item => item.playerId !== entry.playerId && item.status !== 'registered')) ||
        (entry.status === 'active' && data.entries.some(item => item.status === 'out'))) &&
        <button className="button" disabled={busy} onClick={() => change({ mode: 'swapOutcome', entry })}>Поменять вылет / место с игроком</button>}
      {entry.status === 'out' && <>
        <button className="button" disabled={busy} onClick={() => change({ mode: 'place', entry })}>Исправить итоговое место</button>
        {live && <button className="button" disabled={busy} onClick={() => run({ type: 'undoBust', playerId: entry.playerId }, close)}>Отменить вылет</button>}
      </>}
      {live && entry.status === 'active' && <>
        {data.config.seating && entry.tableNo !== null && <button className="button" disabled={busy} onClick={() => run({ type: 'vacate', playerId: entry.playerId }, close)}>Освободить место</button>}
        <AddonControls entry={entry} data={data} busy={busy} run={run} />
        {data.config.seating && <button className="button" disabled={busy} onClick={() => change({ mode: 'assign', entry })}>{entry.tableNo ? 'Пересадить' : 'Назначить место'}</button>}
        <button className="button" disabled={busy} onClick={() => change(bustModal(entry, data))}>Подтвердить вылет</button>
      </>}
      {live && entry.status === 'out' && <button className="button primary" disabled={busy} onClick={() => change({ mode: 'confirm', title: 'Оформить реэнтри?', message: entry.name + ' · ' + money(data.config.reentryFee) + (data.config.seating ? '. Игрок вернётся в очередь на рассадку.' : '. Игрок вернётся в игру.'), label: 'Оформить реэнтри', action: { type: 'reenter', playerId: entry.playerId } })}>Оформить реэнтри</button>}
      {profile && <button className="button" disabled={busy} onClick={() => change({ mode: 'player', player: profile })}>Карточка CRM</button>}
    </div>}
    {modal.mode === 'seatBox' && (() => {
      const unseated = data.entries.filter(item => item.status === 'active' && item.tableNo === null);
      const seated = data.entries.filter(item => item.status === 'active' && item.tableNo !== null);
      const nextQueued = data.waitlist.people.find(person => person.arrived);
      return <div className="dialog-actions">
        {unseated.length > 0 && <>
          <h3>Ожидают место</h3>
          <div className="dialog-list">
            {unseated.map(item => <button className="person-row full-row" key={item.playerId} disabled={busy}
              onClick={() => run({ type: 'assign', playerId: item.playerId, tableNo: modal.tableNo, seatNo: modal.seatNo }, close)}>
              <Person name={item.name} nickname={item.nickname} detail={item.reentries ? 'Реэнтри ' + item.reentries : 'Пришёл'} />
              <Plus size={17} />
            </button>)}
          </div>
        </>}
        {data.waitlist.people.length > 0 && <>
          <h3>Лист ожидания</h3>
          {!data.waitlist.canAdmit && <p className="muted">
            {data.waitlist.blocked === 'unseated' ? 'Сначала рассадите игроков из блока «Ожидают место» выше.'
              : data.waitlist.blocked === 'arrival' ? 'Отметьте, кто из листа ожидания пришёл, чтобы посадить в этот бокс.'
              : data.waitlist.blocked === 'closed' ? 'Поздняя регистрация закрыта.'
              : 'Свободных квот для посадки из листа ожидания нет.'}
          </p>}
          <div className="dialog-list">
            {data.waitlist.people.map((person, index) => {
              const canSeatThis = data.waitlist.canAdmit && person === nextQueued;
              return <div className="person-row" key={person.playerId}>
                <Person name={person.name} nickname={person.nickname} detail={'№ ' + (index + 1) + ' в очереди' + (person.arrived ? ' · Пришёл' : '')} />
                <div className="actions">
                  {!person.arrived && <button type="button" className="button compact" disabled={busy}
                    onClick={() => run({ type: 'setWaitlistArrival', playerId: person.playerId, arrived: true })}>Пришёл</button>}
                  {canSeatThis && <button type="button" className="button compact primary" disabled={busy}
                    onClick={() => run({ type: 'admitWaitlist', playerId: person.playerId, tableNo: modal.tableNo, seatNo: modal.seatNo }, close)}>Посадить</button>}
                </div>
              </div>;
            })}
          </div>
        </>}
        {!unseated.length && !data.waitlist.people.length && <p className="muted">В очереди и листе ожидания сейчас никого нет.</p>}
        {seated.length > 0 && <form onSubmit={event => submit(event, fields => ({
          type: 'assign', playerId: String(fields.get('playerId')), tableNo: modal.tableNo, seatNo: modal.seatNo,
        }))}>
          <label>Или пересадить сидящего игрока
            <select name="playerId" required defaultValue="">
              <option value="" disabled>Выберите игрока</option>
              {seated.map(item => <option key={item.playerId} value={item.playerId}>
                {item.nickname || item.name} · стол {item.tableNo}, бокс {item.seatNo}
              </option>)}
            </select>
          </label>
          <button className="button wide" disabled={busy}>Пересадить в бокс {modal.seatNo}</button>
        </form>}
      </div>;
    })()}
    {modal.mode === 'admitSeat' && <form onSubmit={event => submit(event, fields => {
      const [tableNo, seatNo] = String(fields.get('seat')).split('/').map(Number);
      return { type: 'admitWaitlist', playerId: modal.player.playerId, tableNo, seatNo };
    })}>
      <p>{modal.player.nickname || modal.player.name}{modal.player.nickname && modal.player.nickname !== modal.player.name ? ' · ' + modal.player.name : ''}</p>
      <label>Свободный бокс<select name="seat" required defaultValue="">
        <option value="" disabled>Выберите стол и бокс</option>
        {data.tables.map(table => {
          const free = Array.from({ length: table.capacity }, (_, index) => index + 1)
            .filter(seat => !data.entries.some(item => item.tableNo === table.number && item.seatNo === seat));
          if (!free.length) return null;
          return <optgroup label={'Стол ' + pad(table.number)} key={table.number}>
            {free.map(seat => <option key={seat} value={table.number + '/' + seat}>Стол {pad(table.number)} · Бокс {seat}</option>)}
          </optgroup>;
        })}
      </select></label>
      <button className="button primary wide" disabled={busy}>Посадить в бокс</button>
    </form>}
    {entry && modal.mode === 'assign' && <form onSubmit={event => submit(event, fields => {
      const selected = String(fields.get('seat'));
      if (selected.startsWith('swap/')) return { type: 'swapSeats', playerId: entry.playerId, withPlayerId: selected.slice(5) };
      const [tableNo, seatNo] = selected.split('/').map(Number);
      return { type: 'assign', playerId: entry.playerId, tableNo, seatNo };
    })}>
      <p>{entry.name}</p>
      <label>Новое место<select name="seat" required defaultValue=""><option value="" disabled>Выберите стол и место</option>
        {data.tables.map(table => <optgroup label={'Стол ' + table.number} key={table.number}>
          {Array.from({ length: table.capacity }, (_, index) => index + 1).filter(seat => !data.entries.some(item => item.tableNo === table.number && item.seatNo === seat))
            .map(seat => <option key={seat} value={table.number + '/' + seat}>Стол {table.number} · Место {seat}</option>)}
        </optgroup>)}
        {entry.tableNo !== null && <optgroup label="Обменяться местами">
          {data.entries.filter(item => item.playerId !== entry.playerId && item.tableNo !== null).map(item => <option key={item.playerId} value={'swap/' + item.playerId}>{item.name} · стол {item.tableNo}, место {item.seatNo}</option>)}
        </optgroup>}
      </select></label>
      <button className="button primary wide" disabled={busy}>Подтвердить место</button>
    </form>}
  </dialog>;
}

