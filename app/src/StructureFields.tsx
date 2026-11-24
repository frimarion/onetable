import { useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type PointerEvent, type SetStateAction } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { formats, type Level } from '../shared/operations';
import { format } from './widgets';

type Drag = {
  from: number; to: number; pointer: number; start: number; y: number; scroll: number; frame: number;
  rows: HTMLElement[]; bounds: DOMRect[]; handle: HTMLButtonElement;
};

function canMove(structure: Level[], fixed: number, from: number, to: number) {
  if (from < fixed || to < fixed || to >= structure.length || from === to) return false;
  if (to === 0 && structure[from].kind === 'break') return false;
  return from !== 0 || structure[1].kind === 'play';
}

export function StructureFields({ structure, setStructure, anteEnabled, setAnteEnabled, fixed = 0, finished = false, busy = false }: {
  structure: Level[]; setStructure: Dispatch<SetStateAction<Level[]>>; fixed?: number; finished?: boolean; busy?: boolean;
  anteEnabled: boolean; setAnteEnabled: (enabled: boolean) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag>(null);
  const reorder = useRef<{ moved: HTMLElement; positions: Map<HTMLElement, number> }>(null);
  const reorderAnimations = useRef<Animation[]>([]);
  const keys = useRef(new WeakMap<Level, number>());
  const nextKey = useRef(0);
  const [breakForm, setBreakForm] = useState<{ after: number; minutes: string }>();
  const [announcement, announce] = useState('');
  const [focusTarget, setFocusTarget] = useState<{ index: number; selector: string }>();
  const breakTrigger = useRef<HTMLButtonElement>(null);
  const breakSelect = useRef<HTMLSelectElement>(null);
  const breakId = useId();
  let number = 0;
  const labels = structure.map(level => level.kind === 'break' ? 'Перерыв после уровня ' + number : 'Уровень ' + ++number);
  const duration = structure.reduce((total, level) => total + level.duration, 0);
  const canAdd = !finished && !busy && structure.length < 60;
  const breakPositions = structure.flatMap((level, index) => level.kind === 'play' && index + 1 >= fixed ? [index] : []);
  const after = breakForm && breakPositions.includes(breakForm.after) ? breakForm.after : breakPositions.at(-1);
  const breakMinutes = Number(breakForm?.minutes);
  const validBreak = Number.isInteger(breakMinutes) && breakMinutes >= 1 && breakMinutes <= 180;

  const insertingBreak = Boolean(breakForm);
  useEffect(() => { if (insertingBreak) breakSelect.current?.focus(); }, [insertingBreak]);
  useEffect(() => {
    if (!focusTarget) return;
    list.current?.querySelectorAll<HTMLElement>('.structure-row')[focusTarget.index]
      ?.querySelector<HTMLElement>(focusTarget.selector)?.focus();
    setFocusTarget(undefined);
  }, [focusTarget, structure]);
  useEffect(() => () => stopDrag(), [structure, fixed, finished, busy]);
  useEffect(() => () => {
    for (const animation of reorderAnimations.current) animation.cancel();
  }, []);
  useLayoutEffect(() => {
    const change = reorder.current;
    if (!change) return;
    reorder.current = null;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animations: Animation[] = [];
    if (!reduced) {
      const offsets = [...change.positions].map(([row, top]) => ({ row, offset: top - row.getBoundingClientRect().top }));
      for (const { row, offset } of offsets) {
        if (offset) animations.push(row.animate(
          [{ translate: '0 ' + offset + 'px' }, { translate: '0 0px' }],
          { duration: 240, easing: 'cubic-bezier(.2,.75,.25,1)' },
        ));
      }
    }
    const highlight = {
      backgroundColor: 'color-mix(in srgb, var(--accent) 20%, var(--raised))',
      boxShadow: 'inset 0 0 0 1px var(--accent)',
      zIndex: 1,
    };
    animations.push(change.moved.animate(
      [highlight, { ...highlight, offset: .7 }, reduced ? highlight : { zIndex: 1 }],
      { duration: 650 },
    ));
    reorderAnimations.current = animations;
  }, [structure]);

  function rowKey(level: Level) {
    let key = keys.current.get(level);
    if (key === undefined) {
      key = nextKey.current++;
      keys.current.set(level, key);
    }
    return key;
  }

  function setLevel(index: number, patch: Partial<Level>) {
    const next = { ...structure[index], ...patch };
    keys.current.set(next, rowKey(structure[index]));
    setStructure(structure.map((level, i) => i === index ? next : level));
  }

  function move(from: number, to: number, viaArrow = false) {
    if (busy || finished || !canMove(structure, fixed, from, to)) return;
    if (viaArrow && list.current) {
      const rows = [...list.current.querySelectorAll<HTMLElement>('.structure-row')];
      reorder.current = { moved: rows[from], positions: new Map(rows.map(row => [row, row.getBoundingClientRect().top])) };
      for (const animation of reorderAnimations.current) animation.cancel();
    }
    const next = [...structure];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setStructure(next);
    if (viaArrow) setFocusTarget({ index: to, selector: '.structure-grip' });
    announce('Новая позиция для «' + labels[from] + '» — ' + (to + 1) + ' из ' + next.length);
  }

  function stopDrag() {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    cancelAnimationFrame(active.frame);
    for (const row of active.rows) {
      row.style.removeProperty('--row-offset');
      delete row.dataset.dragging;
    }
    if (active.handle.hasPointerCapture(active.pointer)) active.handle.releasePointerCapture(active.pointer);
  }

  function updateDrag(active: Drag) {
    const shift = window.scrollY - active.scroll;
    const first = active.bounds[0];
    const last = active.bounds.at(-1)!;
    const y = Math.max(first.top, Math.min(last.bottom, active.y + shift));
    let to = active.from;
    for (let index = 0; index < active.bounds.length; index++) {
      const bounds = active.bounds[index];
      const middle = bounds.top + bounds.height / 2;
      if (index < active.from && y < middle && canMove(structure, fixed, active.from, index)) {
        to = index;
        break;
      }
      if (index > active.from && y > middle && canMove(structure, fixed, active.from, index)) to = index;
    }
    active.to = to;
    const height = active.bounds[active.from].height;
    active.rows.forEach((row, index) => {
      const offset = index === active.from ? y - active.start :
        index >= to && index < active.from ? height :
        index <= to && index > active.from ? -height : 0;
      row.style.setProperty('--row-offset', offset + 'px');
    });
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, from: number) {
    if (event.button !== 0 || !event.isPrimary || drag.current || !list.current) return;
    for (const animation of reorderAnimations.current) animation.cancel();
    const handle = event.currentTarget;
    const rows = Array.from(list.current.querySelectorAll<HTMLElement>('.structure-row'));
    const active: Drag = {
      from, to: from, pointer: event.pointerId, start: event.clientY, y: event.clientY,
      scroll: window.scrollY, frame: 0, rows, bounds: rows.map(row => row.getBoundingClientRect()), handle,
    };
    drag.current = active;
    handle.setPointerCapture(event.pointerId);
    rows[from].dataset.dragging = 'true';
    function tick() {
      if (drag.current !== active) return;
      const edge = 64;
      if (Math.abs(active.y - active.start) > 5) {
        const speed = active.y < edge ? active.y - edge : Math.max(0, active.y - window.innerHeight + edge);
        if (speed) {
          window.scrollBy(0, Math.max(-18, Math.min(18, speed / 3)));
          updateDrag(active);
        }
      }
      active.frame = requestAnimationFrame(tick);
    }
    active.frame = requestAnimationFrame(tick);
  }

  function addLevel() {
    const last = structure.findLast(level => level.kind === 'play') ?? formats.Deepstack[0];
    const double = (value: number) => Math.min(10_000_000, value * 2);
    setStructure([...structure, { ...last, small: double(last.small), big: double(last.big), ante: double(last.ante) }]);
    setFocusTarget({ index: structure.length, selector: 'input' });
    announce('Уровень добавлен');
  }

  function addBreak() {
    if (!canAdd || after === undefined || !validBreak) return;
    const pause: Level = { kind: 'break', small: 0, big: 0, ante: 0, duration: breakMinutes * 60 };
    setStructure([...structure.slice(0, after + 1), pause, ...structure.slice(after + 1)]);
    setBreakForm(undefined);
    setFocusTarget({ index: after + 1, selector: 'input' });
    announce('Перерыв добавлен после ' + labels[after].toLocaleLowerCase('ru'));
  }

  return <>
    <div className="structure-toolbar">
      <div className="structure-overview">
        <label className="attendance-check">
          <input type="checkbox" checked={anteEnabled} disabled={busy || finished}
            onChange={event => {
              const enabled = event.target.checked;
              if (enabled && structure.some((level, index) => index >= fixed && level.kind === 'play' && level.ante === 0)) {
                setStructure(structure.map((level, index) => index >= fixed && level.kind === 'play' && level.ante === 0
                  ? { ...level, ante: level.big } : level));
              }
              setAnteEnabled(enabled);
            }} /> Анте
        </label>
        <p className="muted">Уровни {number} · Перерывы {structure.length - number} · {Math.floor(duration / 60)} мин{duration % 60 ? ' ' + duration % 60 + ' сек' : ''}</p>
      </div>
      {!finished && <div className="actions">
        <button type="button" className="button" disabled={!canAdd} onClick={addLevel}><Plus size={16} /> Уровень</button>
        <button ref={breakTrigger} type="button" className="button" disabled={!canAdd || !breakPositions.length}
          aria-expanded={Boolean(breakForm)} aria-controls={breakId}
          onClick={() => setBreakForm(breakForm ? undefined : { after: breakPositions.at(-1)!, minutes: '15' })}><Plus size={16} /> Перерыв</button>
      </div>}
    </div>
    {breakForm && <div id={breakId} className="structure-insert" onKeyDown={event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setBreakForm(undefined);
        breakTrigger.current?.focus();
      }
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
        event.preventDefault();
        addBreak();
      }
    }}>
      <label>После какого уровня<select ref={breakSelect} value={after ?? ''} disabled={busy}
        onChange={event => setBreakForm({ ...breakForm, after: Number(event.target.value) })}>
        {breakPositions.map(index => <option key={index} value={index}>{labels[index]} · {format.format(structure[index].small)} / {format.format(structure[index].big)}</option>)}
      </select></label>
      <label>Длительность, мин<input type="number" min={1} max={180} value={breakForm.minutes} disabled={busy}
        onChange={event => setBreakForm({ ...breakForm, minutes: event.target.value })} /></label>
      <div className="actions">
        <button type="button" className="button primary" disabled={!canAdd || after === undefined || !validBreak}
          onClick={addBreak}>Вставить перерыв</button>
        <button type="button" className="button" onClick={() => { setBreakForm(undefined); breakTrigger.current?.focus(); }}>Отмена</button>
      </div>
    </div>}
    <p className="sr-only" role="status">{announcement}</p>
    <div className="structure-list" ref={list}>
      {structure.map((level, index) => {
        const locked = finished || index < fixed;
        const noMove = !canMove(structure, fixed, index, index - 1) && !canMove(structure, fixed, index, index + 1);
        const label = labels[index];
        const fields = level.kind === 'break' ? [['duration', 'Минуты']] as const :
          ([['small', 'Малый'], ['big', 'Большой'], ['ante', 'Анте'], ['duration', 'Минуты']] as const)
            .filter(([key]) => key !== 'ante' || anteEnabled);
        return <div className={'structure-row' + (level.kind === 'break' ? ' structure-break' : '')} key={rowKey(level)}>
          <div className="structure-row-title">
            {!locked && <button type="button" className="button icon compact structure-grip" disabled={busy || noMove}
              title="Перетащить. С клавиатуры — стрелки вверх и вниз"
              aria-label={'Переместить: ' + label}
              onPointerDown={event => startDrag(event, index)}
              onPointerMove={event => {
                const active = drag.current;
                if (active?.pointer !== event.pointerId) return;
                active.y = event.clientY;
                updateDrag(active);
              }}
              onPointerUp={event => {
                const active = drag.current;
                if (active?.pointer !== event.pointerId) return;
                stopDrag();
                move(active.from, active.to);
              }}
              onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}
              onKeyDown={event => {
                if (event.key === 'Escape') stopDrag();
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                move(index, index + (event.key === 'ArrowUp' ? -1 : 1), true);
              }}><GripVertical size={17} /></button>}
            <strong>{level.kind === 'break' ? 'Перерыв' : label}</strong>
          </div>
          <div className={'structure-values' + (anteEnabled ? '' : ' structure-values-no-ante')}>
            {fields.map(([key, title]) => <label key={key}>{title}<input aria-label={label + ' · ' + title} disabled={locked || busy} type="number" required
              step={key === 'duration' ? 'any' : 1} min={key === 'ante' ? 0 : 1} max={key === 'duration' ? 180 : 10_000_000} value={key === 'duration' ? level[key] / 60 : level[key]}
              onChange={event => setLevel(index, { [key]: Math.round(event.target.valueAsNumber * (key === 'duration' ? 60 : 1)) || 0 })} /></label>)}
          </div>
          {!locked && <div className="actions structure-actions">
            <button className="button icon compact" type="button" aria-label={'Поднять: ' + label} disabled={busy || !canMove(structure, fixed, index, index - 1)}
              onClick={() => move(index, index - 1, true)}><ChevronUp size={16} /></button>
            <button className="button icon compact" type="button" aria-label={'Опустить: ' + label} disabled={busy || !canMove(structure, fixed, index, index + 1)}
              onClick={() => move(index, index + 1, true)}><ChevronDown size={16} /></button>
            <button className="button icon compact" type="button" aria-label={'Удалить: ' + label} disabled={busy || structure.length === 1 || (index === 0 && structure[1]?.kind === 'break')}
              onClick={() => setStructure(structure.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
          </div>}
        </div>;
      })}
    </div>
  </>;
}
