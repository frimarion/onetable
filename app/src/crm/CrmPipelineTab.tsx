import { useMemo, useState, type DragEvent } from 'react';
import { CalendarClock, Plus } from 'lucide-react';
import type { Snapshot } from '../../shared/model';
import {
  defaultOwners,
  pipelineStages,
  taskUrgency,
  type CrmTask,
  type GuestSummary,
  type PipelineStage,
  type TaskUrgency,
} from '../../shared/crm';
import { matchesQuery } from '../../shared/search';
import type { Run } from '../api';
import { SearchBox, money } from '../widgets';

type TaskFilter = 'all' | 'overdue' | 'today' | 'none';

function urgencyLabel(urgency: TaskUrgency, task: CrmTask | null) {
  if (urgency === 'overdue') return 'Просрочена';
  if (urgency === 'today') return 'На сегодня';
  if (urgency === 'upcoming' && task) {
    return new Date(task.dueAt).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'short',
      timeZone: 'Europe/Moscow',
    });
  }
  return 'Нет задач';
}

export function CrmPipelineTab({
  guests,
  data,
  run,
  busy,
  onSelectGuest,
  onAddLead,
}: {
  guests: GuestSummary[];
  data: Snapshot;
  run: Run;
  busy: boolean;
  onSelectGuest: (playerId: string) => void;
  onAddLead: () => void;
}) {
  const [query, setQuery] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all');
  const [dragPlayerId, setDragPlayerId] = useState<string | null>(null);
  const [hoverStage, setHoverStage] = useState<PipelineStage | null>(null);

  const tasksByPlayer = useMemo(() => {
    const map = new Map<string, CrmTask[]>();
    for (const task of data.crm.tasks) {
      const list = map.get(task.playerId) ?? [];
      list.push(task);
      map.set(task.playerId, list);
    }
    return map;
  }, [data.crm.tasks]);

  const owners = useMemo(() => {
    const set = new Set<string>(defaultOwners);
    for (const g of guests) {
      if (g.player.owner.trim()) set.add(g.player.owner.trim());
    }
    return [...set];
  }, [guests]);

  const filtered = useMemo(() => {
    return guests.filter(g => {
      const p = g.player;
      if (query.trim() && !matchesQuery(query, [p.name, p.nickname, p.phone, p.telegram, p.source, p.tags, p.owner])) {
        return false;
      }
      if (ownerFilter !== 'all' && p.owner !== ownerFilter) return false;
      const status = taskUrgency(tasksByPlayer.get(p.id) ?? [], data.serverTime).urgency;
      if (taskFilter === 'overdue' && status !== 'overdue') return false;
      if (taskFilter === 'today' && status !== 'today') return false;
      if (taskFilter === 'none' && status !== 'none') return false;
      return true;
    });
  }, [guests, query, ownerFilter, taskFilter, tasksByPlayer, data.serverTime]);

  function handleDragStart(event: DragEvent, playerId: string) {
    setDragPlayerId(playerId);
    event.dataTransfer.setData('text/plain', playerId);
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleDrop(event: DragEvent, targetStage: PipelineStage) {
    event.preventDefault();
    const playerId = event.dataTransfer.getData('text/plain') || dragPlayerId;
    setDragPlayerId(null);
    setHoverStage(null);
    if (!playerId || busy) return;
    const current = guests.find(g => g.player.id === playerId);
    if (!current || current.player.stage === targetStage) return;
    void run({ type: 'setPlayerStage', playerId, stage: targetStage });
  }

  return (
    <div className="crm-stack">
      <div className="crm-pipeline-bar">
        <SearchBox value={query} onChange={setQuery} placeholder="Поиск по воронке: имя, контакт, тег" />
        <div className="crm-filters">
          <select aria-label="Ответственный" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}>
            <option value="all">Все ответственные</option>
            {owners.map(owner => (
              <option key={owner} value={owner}>{owner}</option>
            ))}
          </select>
          <select aria-label="Статус задач" value={taskFilter} onChange={e => setTaskFilter(e.target.value as TaskFilter)}>
            <option value="all">Все задачи</option>
            <option value="overdue">С просроченными</option>
            <option value="today">Задачи на сегодня</option>
            <option value="none">Без задач</option>
          </select>
          <button type="button" className="button primary compact" onClick={onAddLead}>
            <Plus size={15} /> Быстрый лид
          </button>
        </div>
      </div>

      <div className="crm-kanban" role="region" aria-label="Воронка гостей">
        {pipelineStages.map(stage => {
          const items = filtered.filter(g => g.player.stage === stage.id);
          const stageRevenue = items.reduce((sum, g) => sum + g.totalSpent, 0);
          const isOver = hoverStage === stage.id;
          return (
            <section
              key={stage.id}
              className={`crm-stage-col tone-${stage.tone}${isOver ? ' drop-over' : ''}`}
              onDragOver={event => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                if (hoverStage !== stage.id) setHoverStage(stage.id);
              }}
              onDragLeave={() => {
                if (hoverStage === stage.id) setHoverStage(null);
              }}
              onDrop={event => handleDrop(event, stage.id)}
            >
              <header className="crm-stage-head">
                <div className="crm-stage-title">
                  <strong>{stage.label}</strong>
                  <span className="count">{items.length}</span>
                </div>
                <span className="crm-stage-sum muted">{money(stageRevenue)}</span>
              </header>

              <div className="crm-stage-cards">
                {items.map(guest => {
                  const p = guest.player;
                  const tStatus = taskUrgency(tasksByPlayer.get(p.id) ?? [], data.serverTime);
                  const isDragging = dragPlayerId === p.id;
                  return (
                    <article
                      key={p.id}
                      draggable={!busy}
                      onDragStart={event => handleDragStart(event, p.id)}
                      onDragEnd={() => {
                        setDragPlayerId(null);
                        setHoverStage(null);
                      }}
                      onClick={() => onSelectGuest(p.id)}
                      className={`crm-deal-card${isDragging ? ' dragging' : ''}`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectGuest(p.id);
                        }
                      }}
                    >
                      <div className="crm-deal-top">
                        <strong>{p.nickname || p.name}</strong>
                        <span className="crm-deal-amount">{guest.totalSpent ? money(guest.totalSpent) : '—'}</span>
                      </div>
                      <div className="crm-deal-sub muted">
                        <span>{p.source || 'Без источника'}</span>
                        <span>{guest.visitsCount} виз.</span>
                      </div>
                      {guest.tagList.length > 0 && (
                        <div className="crm-deal-tags">
                          {guest.tagList.slice(0, 3).map(tag => (
                            <span key={tag} className="crm-deal-tag">{tag}</span>
                          ))}
                        </div>
                      )}
                      <div className="crm-deal-foot">
                        <span className="muted crm-deal-owner">{p.owner}</span>
                        <span className={`crm-task-badge ${tStatus.urgency}`} title={tStatus.nextTask?.title || 'Нет активных задач'}>
                          <CalendarClock size={12} />
                          {urgencyLabel(tStatus.urgency, tStatus.nextTask)}
                        </span>
                      </div>
                    </article>
                  );
                })}
                {!items.length && <p className="crm-stage-empty muted">Перетащите карточку сюда</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
