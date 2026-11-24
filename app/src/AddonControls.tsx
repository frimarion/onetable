import type { Entry, Snapshot } from '../shared/model';
import { addonOptions } from '../shared/operations';
import type { Run } from './api';
import { format, money } from './widgets';

export function AddonControls({ entry, data, busy, run }: {
  entry: Entry; data: Snapshot; busy: boolean; run: Run;
}) {
  const choices = addonOptions(data.config);
  const canEdit = data.tournament.state === 'scheduled' || data.tournament.state === 'live';
  if (!choices.length && !entry.addon) return null;
  function choose(tier: number) {
    void run({ type: 'addon', playerId: entry.playerId, expectedTier: entry.addonTier, tier: tier === entry.addonTier ? 0 : tier });
  }
  return <div className="addon-controls" role="group" aria-label={'Аддоны: ' + entry.name}>
    {choices.map(choice => {
      const selected = entry.addonTier === choice.tier;
      const details = choice.label + ' · ' + money(choice.cost) + ' · ' + format.format(choice.chips) + ' фишек';
      return <button key={choice.tier} className="button compact" type="button" aria-pressed={selected}
        aria-label={choice.label + ': ' + entry.name} title={details}
        disabled={busy || !canEdit || (entry.status !== 'active' && !(entry.status === 'out' && selected))}
        onClick={() => choose(choice.tier)}>
        {choice.tier === 1 ? 'Аддон' : '×' + choice.tier}
      </button>;
    })}
    {entry.addon && !choices.some(choice => choice.tier === entry.addonTier) &&
      <button type="button" className="button compact" disabled={busy || !canEdit || entry.status === 'registered'}
        onClick={() => choose(entry.addonTier)}>Отменить аддон{entry.addonTier > 1 ? ' ×' + entry.addonTier : ''}</button>}
  </div>;
}
