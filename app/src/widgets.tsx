import { useEffect, useState, type PointerEvent, type ReactNode } from 'react';
import { ArrowRight, ChevronRight, Search } from 'lucide-react';
import logo from './logo.svg';
import lightLogo from './logo-light.svg';
import { remaining, type Entry, type Snapshot, type Tournament } from '../shared/model';

export const format = new Intl.NumberFormat('ru-RU');
export const money = (value: number) => format.format(value) + ' ₽';
const tournamentDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow' });
export const startLabel = (value: string | null) => value ? tournamentDate.format(new Date(value)) + ' МСК' : 'Дата уточняется';
export const pad = (value: number) => String(value).padStart(2, '0'); // taste-skill-ignore: clock and table numbers

export function Brand() {
  return <div className="brand"><img className="logo-dark" src={logo} alt="" /><img className="logo-light" src={lightLogo} alt="" /><strong>OneTable</strong></div>;
}

export function State({ tournament }: { tournament: Pick<Tournament, 'state'> }) {
  const labels = { draft: 'Черновик', live: 'Идёт', scheduled: 'Запланирован', finished: 'Завершён' };
  return <span className={'state ' + tournament.state}><i />{labels[tournament.state]}</span>;
}

export function Heading({ title, subtitle, state, actions }: { title: string; subtitle: string; state?: ReactNode; actions?: ReactNode }) {
  return <div className="heading"><div><div className="heading-name"><h1>{title}</h1>{state}</div><p>{subtitle}</p></div>{actions && <div className="actions">{actions}</div>}</div>;
}

export function Timer({ data }: { data: Snapshot }) {
  const clock = data.clock;
  const [offset, setOffset] = useState(() => data.serverTime - Date.now());
  const [now, setNow] = useState(Date.now);
  useEffect(() => { setOffset(data.serverTime - Date.now()); setNow(Date.now()); }, [data.serverTime]);
  useEffect(() => {
    if (clock.startedAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [clock.startedAt]);
  const left = remaining(clock, now + offset);
  const level = data.structure[clock.level];
  const next = data.structure[clock.level + (clock.manualBreak ? 0 : 1)];
  const isBreak = clock.manualBreak || level.kind === 'break';
  const title = isBreak ? 'Перерыв' : 'Уровень ' + data.structure.slice(0, clock.level + 1).filter(item => item.kind === 'play').length;
  return <>
    <p className="level">{title}<span> · </span>{!left ? 'Время вышло' : clock.startedAt === null ? 'Пауза' : 'Идёт'}</p>
    <div className="digits">{pad(Math.floor(left / 60))}<span>:</span>{pad(left % 60)}</div>
    <progress aria-label="Остаток времени уровня" max={clock.duration} value={left} />
    <dl className="blinds">
      <div><dt>Блайнды</dt><dd>{isBreak ? 'Пауза' : format.format(level.small) + ' / ' + format.format(level.big)}</dd></div>
      {!isBreak && data.config.anteEnabled && <div><dt>Анте</dt><dd>{format.format(level.ante)}</dd></div>}
      {next && <div><dt>Следующий</dt><dd>{next.kind === 'break' ? 'Перерыв' : format.format(next.small) + ' / ' + format.format(next.big)}</dd></div>}
    </dl>
  </>;
}

const seatLayouts: Record<number, [x: number, y: number, labelAbove?: boolean][]> = {
  2: [[50, 17, true], [50, 83]],
  3: [[50, 17, true], [84, 72], [16, 72]],
  4: [[33, 17, true], [67, 17, true], [67, 83], [33, 83]],
  5: [[33, 17, true], [67, 17, true], [89, 54], [50, 83], [11, 54]],
  6: [[33, 17, true], [67, 17, true], [89, 50], [67, 83], [33, 83], [11, 50]],
  7: [[28, 17, true], [50, 17, true], [72, 17, true], [89, 52], [65, 83], [35, 83], [11, 52]],
  8: [[28, 17, true], [50, 17, true], [72, 17, true], [89, 50], [72, 83], [50, 83], [28, 83], [11, 50]],
  9: [[29, 17, true], [50, 17, true], [71, 17, true], [88, 37], [86, 67], [63, 83], [37, 83], [14, 67], [12, 37]],
  10: [[28, 17, true], [50, 17, true], [72, 17, true], [89, 36], [89, 64], [72, 83], [50, 83], [28, 83], [11, 64], [11, 36]],
};

function seatCoords(capacity: number, index: number): [number, number, boolean] {
  const preset = seatLayouts[capacity]?.[index];
  if (preset) return [preset[0], preset[1], Boolean(preset[2])];
  const angle = Math.PI * (2 * index / capacity - 0.5);
  const y = 50 + 34 * Math.sin(angle);
  return [50 + 40 * Math.cos(angle), y, y < 28];
}

export function initialsOf(name: string, nickname?: string) {
  const title = nickname || name;
  return title.replace(/^@/, '').split(/\s+/).slice(0, 2).map(word => [...word][0]).join('');
}

export function PokerTable({ number, capacity, entries, selected, detailed = false, interactive = false, draggingPlayerId, dropTarget, onSelect, onSelectSeat, onSeatPointerDown }: {
  number: number; capacity: number; entries: Entry[]; selected: boolean; detailed?: boolean; interactive?: boolean;
  draggingPlayerId?: string; dropTarget?: { tableNo: number; seatNo: number; swap: boolean } | null;
  onSelect: () => void; onSelectSeat?: (seatNo: number, occupant?: Entry) => void;
  onSeatPointerDown?: (event: PointerEvent<HTMLButtonElement>, seatNo: number, occupant: Entry) => void;
}) {
  return <article className={'poker-card' + (detailed ? ' poker-card-detailed' : '') + (selected ? ' selected' : '')}>
    <button type="button" className="table-head table-head-btn" aria-pressed={selected} onClick={onSelect}>
      <strong>Стол {pad(number)}</strong><ChevronRight size={16} />
    </button>
    <div className={'table-diagram' + (detailed ? ' detailed' : '')}>
      <span className="felt" aria-hidden="true"><span className="felt-ring" /></span>
      {Array.from({ length: capacity }, (_, index) => {
        const seatNo = index + 1;
        const occupant = entries.find(item => item.seatNo === seatNo);
        const [x, y, labelAbove] = seatCoords(capacity, index);
        const pos = { left: x + '%', top: y + '%' };
        const canClick = Boolean(onSelectSeat) && (interactive || Boolean(occupant));
        const canDrag = interactive && Boolean(occupant) && Boolean(onSeatPointerDown);
        const isDragging = Boolean(occupant && draggingPlayerId === occupant.playerId);
        const isDrop = dropTarget?.tableNo === number && dropTarget.seatNo === seatNo;
        const dropKind = isDrop ? (dropTarget.swap ? 'swap' : 'move') : undefined;
        const seatAttrs = {
          'data-seat-table': number,
          'data-seat-no': seatNo,
          'data-draggable': canDrag ? 'true' : undefined,
          'data-dragging': isDragging ? 'true' : undefined,
          'data-drop': dropKind,
        };
        const occupantTitle = occupant
          ? `Бокс ${seatNo} · ${occupant.nickname || occupant.name}${canDrag ? ' (перетащите для пересадки или обмена)' : ''}`
          : canClick ? `Посадить в бокс ${seatNo}` : `Бокс ${seatNo} свободен`;
        if (detailed) {
          const label = occupant ? (occupant.nickname || occupant.name.split(/\s+/)[0]) : '';
          return occupant
            ? <button type="button" key={seatNo} className={'seat-node occupied' + (labelAbove ? ' label-above' : '')} style={pos}
                {...seatAttrs} disabled={!canClick} title={occupantTitle}
                aria-label={`Стол ${number}, бокс ${seatNo}: ${occupant.nickname || occupant.name}`}
                onPointerDown={canDrag && occupant ? event => onSeatPointerDown?.(event, seatNo, occupant) : undefined}
                onClick={() => onSelectSeat?.(seatNo, occupant)}>
                <span className="seat-avatar">{occupant.photoUrl ? <img src={occupant.photoUrl} alt="" loading="lazy" /> : initialsOf(occupant.name, occupant.nickname)}<i className="seat-num">{seatNo}</i></span>
                <span className="seat-name">{label}</span>
              </button>
            : <button type="button" key={seatNo} className="seat seat-free" style={pos}
                {...seatAttrs} disabled={!canClick} title={occupantTitle}
                aria-label={`Стол ${number}, свободный бокс ${seatNo}`}
                onClick={() => onSelectSeat?.(seatNo)}>{seatNo}</button>;
        }
        return <button type="button" key={seatNo} style={pos} {...seatAttrs} disabled={!canClick}
          className={'seat' + (occupant ? ' occupied' : '')} title={occupantTitle}
          aria-label={`Стол ${number}, бокс ${seatNo}${occupant ? ': ' + (occupant.nickname || occupant.name) : ', свободен'}`}
          onPointerDown={canDrag && occupant ? event => onSeatPointerDown?.(event, seatNo, occupant) : undefined}
          onClick={() => onSelectSeat?.(seatNo, occupant)}>{seatNo}</button>;
      })}
    </div>
    <button type="button" className="table-foot table-foot-btn" onClick={onSelect}>
      <span><i />{entries.length} / {capacity} занято</span><span>{capacity - entries.length} свободно</span>
    </button>
  </article>;
}

export function Avatar({ name, nickname, photoUrl, className = 'avatar person-avatar' }: {
  name: string; nickname?: string; photoUrl?: string | null; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [photoUrl]);
  const initials = initialsOf(name, nickname);
  if (photoUrl && !failed) {
    return <span className={className + ' has-photo'} aria-hidden="true">
      <img src={photoUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
    </span>;
  }
  return <span className={className} aria-hidden="true">{initials}</span>;
}

export function Person({ name, nickname, photoUrl, detail }: { name: string; nickname?: string; photoUrl?: string | null; detail?: string }) {
  const title = nickname || name;
  const subtitle = nickname && nickname !== name ? [name, detail].filter(Boolean).join(' · ') : detail;
  return <span className="person"><Avatar name={name} nickname={nickname} photoUrl={photoUrl} />
    <span className="person-identity"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span></span>;
}

export function entryDetail(entry: Entry, seating = true) {
  if (entry.tableNo) return 'Стол ' + entry.tableNo + ' · Место ' + entry.seatNo + (entry.confirmed ? ' · На месте' : '');
  return { active: seating ? 'Ожидает рассадку' : 'В игре', out: 'Вылетел', registered: 'Записан' }[entry.status];
}

export function EntryList({ entries, empty, onSelect, seatAction }: { entries: Entry[]; empty: string; onSelect: (entry: Entry) => void; seatAction?: boolean }) {
  if (!entries.length) return <p className="empty">{empty}</p>;
  return <div>{entries.map(entry => <button className="person-row full-row" key={entry.playerId} onClick={() => onSelect(entry)}>
    <Person name={entry.name} nickname={entry.nickname} photoUrl={entry.photoUrl} detail={entryDetail(entry)} />
    {seatAction ? <span className="row-link">Назначить <ArrowRight size={15} /></span> : <span className="row-link">{entry.reentries ? 'Реэнтри ' + entry.reentries : ''}<ChevronRight size={17} /></span>}
  </button>)}</div>;
}

export function Journal({ data, limit }: { data: Snapshot; limit?: number }) {
  if (!data.journal.length) return <p className="empty">Действий пока нет</p>;
  return <ul className="journal">{(limit ? data.journal.slice(0, limit) : data.journal).map(item =>
    <li key={item.id}><i /><div><strong>{item.label}</strong><small>{item.actor} · {new Date(item.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })}</small></div></li>)}</ul>;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="search"><Search size={17} /><input type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></label>;
}

