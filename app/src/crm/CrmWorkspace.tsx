import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Snapshot } from '../../shared/model';
import { buildGuestSummaries, type BroadcastSegment } from '../../shared/crm';
import type { Run } from '../api';
import type { Modal } from '../crm';
import { Heading } from '../widgets';
import { CrmAnalyticsTab } from './CrmAnalyticsTab';
import { CrmPipelineTab } from './CrmPipelineTab';
import { CrmGuestsTab } from './CrmGuestsTab';
import { CrmTasksTab } from './CrmTasksTab';
import { CrmRetentionTab } from './CrmRetentionTab';
import { CrmBroadcastsTab } from './CrmBroadcastsTab';
import { CrmGuestDrawer } from './CrmGuestDrawer';

type CrmTab = 'analytics' | 'pipeline' | 'guests' | 'tasks' | 'retention' | 'broadcasts';

const tabs: { id: CrmTab; label: string }[] = [
  { id: 'analytics', label: 'Аналитика' },
  { id: 'pipeline', label: 'Воронка' },
  { id: 'guests', label: 'База гостей' },
  { id: 'tasks', label: 'Задачи' },
  { id: 'retention', label: 'Удержание' },
  { id: 'broadcasts', label: 'Рассылки' },
];

export function CrmWorkspace({
  data,
  run,
  busy,
  open,
}: {
  data: Snapshot;
  run: Run;
  busy: boolean;
  open: (modal: Modal) => void;
}) {
  const [tab, setTab] = useState<CrmTab>('analytics');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [broadcastSegment, setBroadcastSegment] = useState<BroadcastSegment | undefined>(undefined);

  const guests = useMemo(
    () => buildGuestSummaries(data.roster, data.crm.registrations, data.visits, data.payments, data.serverTime),
    [data.roster, data.crm.registrations, data.visits, data.payments, data.serverTime],
  );

  const selectedGuest = selectedPlayerId
    ? guests.find(item => item.player.id === selectedPlayerId) ?? null
    : null;

  function startBroadcastForSegment(segment: BroadcastSegment) {
    setBroadcastSegment(segment);
    setTab('broadcasts');
  }

  const openTasksCount = data.crm.tasks.filter(task => task.completedAt === null).length;

  return (
    <>
      <Heading
        title="CRM клуба"
        subtitle={`${data.club.name} · Воронка, база гостей, задачи, удержание и рассылки`}
        actions={
          <button className="button primary" onClick={() => open({ mode: 'add' })}>
            <Plus size={18} /> Добавить гостя
          </button>
        }
      />

      <div className="tabs" aria-label="Разделы CRM">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
            {id === 'guests' && <span>{guests.length}</span>}
            {id === 'tasks' && openTasksCount > 0 && <span>{openTasksCount}</span>}
            {id === 'broadcasts' && data.crm.broadcasts.length > 0 && <span>{data.crm.broadcasts.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'analytics' && <CrmAnalyticsTab data={data} />}
      {tab === 'pipeline' && (
        <CrmPipelineTab
          guests={guests}
          data={data}
          run={run}
          busy={busy}
          onSelectGuest={setSelectedPlayerId}
          onAddLead={() => open({ mode: 'add' })}
        />
      )}
      {tab === 'guests' && (
        <CrmGuestsTab
          guests={guests}
          onSelect={setSelectedPlayerId}
          onAdd={() => open({ mode: 'add' })}
        />
      )}
      {tab === 'tasks' && (
        <CrmTasksTab
          guests={guests}
          data={data}
          run={run}
          busy={busy}
          onSelectGuest={setSelectedPlayerId}
        />
      )}
      {tab === 'retention' && (
        <CrmRetentionTab
          guests={guests}
          data={data}
          onSelectGuest={setSelectedPlayerId}
          onStartBroadcast={startBroadcastForSegment}
        />
      )}
      {tab === 'broadcasts' && (
        <CrmBroadcastsTab
          guests={guests}
          data={data}
          run={run}
          busy={busy}
          initialSegment={broadcastSegment}
        />
      )}

      {selectedGuest && (
        <CrmGuestDrawer
          guest={selectedGuest}
          data={data}
          run={run}
          busy={busy}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
    </>
  );
}
