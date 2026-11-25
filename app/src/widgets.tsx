import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ArrowRight, ChevronRight, Search } from 'lucide-react';
import logo from './logo.svg';
import lightLogo from './logo-light.svg';
import { remaining, type Entry, type Snapshot, type Tournament } from '../shared/model';
import { playTimerChime, usePreferences } from './preferences';

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
  const { prefs } = usePreferences();
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
  const prevRef = useRef({ left, level: clock.level });
  useEffect(() => {
    const prev = prevRef.current;
    const ended = prev.left > 0 && left === 0;
    const levelChanged = prev.level !== clock.level && clock.startedAt !== null;
    prevRef.current = { left, level: clock.level };
    if ((ended || levelChanged) && prefs.timerSound) {
      playTimerChime();
    }
  }, [left, clock.level, clock.startedAt, prefs.timerSound]);
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

// Раскладка боксов по часовой стрелке (стол перевёрнут на 180°: дилер сверху в выемке, смотрит вниз):
// 1 — по левую руку дилера (сверху справа), далее по часовой стрелке до последнего бокса (сверху слева).
const seatLayouts: Record<number, [x: number, y: number, labelAbove?: boolean][]> = {
  2: [[76, 17, true], [24, 17, true]],
  3: [[76, 17, true], [50, 85], [24, 17, true]],
  4: [[76, 17, true], [74, 83], [26, 83], [24, 17, true]],
  5: [[76, 17, true], [88, 58], [50, 85], [12, 58], [24, 17, true]],
  6: [[76, 17, true], [90, 52], [69, 84], [31, 84], [10, 52], [24, 17, true]],
  7: [[77, 17, true], [90, 50], [72, 84], [50, 85], [28, 84], [10, 50], [23, 17, true]],
  8: [[77, 17, true], [90, 48], [76, 82], [59, 85], [41, 85], [24, 82], [10, 48], [23, 17, true]],
  9: [[77, 17, true], [90, 38], [88, 68], [69, 84], [50, 85], [31, 84], [12, 68], [10, 38], [23, 17, true]],
  10: [[77, 17, true], [90, 37], [90, 65], [75, 83], [58, 85], [42, 85], [25, 83], [10, 65], [10, 37], [23, 17, true]],
};

function seatCoords(capacity: number, index: number): [number, number, boolean] {
  const preset = seatLayouts[capacity]?.[index];
  if (preset) return [preset[0], preset[1], Boolean(preset[2])];
  // Дуга 300° по часовой стрелке от -60° (сверху справа, левая рука дилера) до +240° (сверху слева)
  const start = -Math.PI / 3;
  const sweep = (5 * Math.PI) / 3;
  const angle = start + (capacity > 1 ? (index / (capacity - 1)) * sweep : sweep / 2);
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
      <svg className="felt-svg" viewBox="0 0 220 116" preserveAspectRatio="none" aria-hidden="true">
        <path
          className="felt-shape"
          d="M 64 24 L 84 24 C 93 24 98 31 110 31 C 122 31 127 24 136 24 L 156 24 A 34 34 0 0 1 156 92 L 64 92 A 34 34 0 0 1 64 24 Z"
        />
        <path
          className="felt-ring-path"
          d="M 64 30 L 85 30 C 94 30 99 36 110 36 C 121 36 126 30 135 30 L 156 30 A 28 28 0 0 1 156 86 L 64 86 A 28 28 0 0 1 64 30 Z"
        />
      </svg>
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

