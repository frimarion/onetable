import { useEffect, useState } from 'react';
import { Expand, Minimize } from 'lucide-react';
import { playingLevel, registrationOpen } from '../shared/operations';
import { remaining, type Snapshot } from '../shared/model';
import { request, useOffice } from './api';
import { calculateRating, ratingSchemeOf } from '../shared/rating';
import { format, initialsOf, pad } from './widgets';
import doyleLogo from './assets/doyle-display-logo.png';

function useClock(data: Snapshot) {
  const [now, setNow] = useState(() => data.serverTime);
  useEffect(() => {
    const realStart = Date.now();
    const tick = () => setNow(data.serverTime + Date.now() - realStart);
    tick();
    if (data.clock.startedAt === null) return;
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [data.serverTime, data.clock.startedAt]);
  return remaining(data.clock, now);
}

const timeLabel = (seconds: number) => pad(Math.floor(seconds / 60)) + ':' + pad(seconds % 60);

export function Display({ data, error }: { data: Snapshot; error: string }) {
  const [full, setFull] = useState(false);
  const left = useClock(data);
  const current = data.structure[data.clock.level];
  const next = data.structure[data.clock.level + (data.clock.manualBreak ? 0 : 1)];
  const clockMode = data.display.mode === 'clock';
  const paused = data.tournament.state === 'live' && data.clock.startedAt === null && !data.clock.manualBreak;
  const breakActive = data.clock.manualBreak || current.kind === 'break';
  const entries = data.stats.entered + data.stats.reentries;
  const chips = entries * data.config.startStack + data.stats.addonChips;
  const lateOpen = registrationOpen(data.config, data.structure, data.clock.level);
  const hasInfo = data.config.lateRegistration > 0 || data.config.bonusHand || data.config.comment;
  const payouts = data.display.mode === 'payouts'
    ? calculateRating(ratingSchemeOf(data.config), entries, data.stats.addons).payouts : [];
  const results = data.results.filter(result => result.place !== null).sort((a, b) => a.place! - b.place!);

  useEffect(() => {
    const change = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);

  return <main className="tv-screen">
    <header className="tv-top">
      {(data.club.id === 'doyle' || data.club.id === 'doyle-live') ? <img className="tv-logo" src={doyleLogo} alt={data.club.name} />
        : <span className="tv-club">{data.club.name}</span>}
      {document.fullscreenEnabled && <button className="tv-fullscreen" aria-label={full ? 'Выйти из полноэкранного режима' : 'Во весь экран'} onClick={() => {
        void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
      }}>{full ? <Minimize size={20} /> : <Expand size={20} />}</button>}
    </header>
    {clockMode && <div className="tv-grid">
      <aside className="tv-info">
        {data.tvPayouts?.length ? <>
          <h2>Рейтинг</h2>
          <ol className="tv-side-results">{data.tvPayouts.map((points, index) => <li key={index}>
            <span>{index + 1}</span><span>{results.find(item => item.place === index + 1)?.name}</span><strong>{format.format(points)}</strong>
          </li>)}</ol>
        </> : <>
          {hasInfo && <h2>Инфо</h2>}
          {data.config.lateRegistration > 0 && <TvStat label="Поздняя регистрация" value={lateOpen ? 'Открыта' : 'Закрыта'} />}
          {data.config.bonusHand && <TvStat label="Бонусная рука дня" value={data.config.bonusHand} />}
          {data.config.comment && <TvStat label="Комментарий" value={data.config.comment} />}
        </>}
      </aside>
      <section className="tv-clock" aria-label="Таймер">
        <h1>{breakActive ? 'Перерыв' : 'Уровень ' + playingLevel(data.structure, data.clock.level)}</h1>
        <span className="tv-label">Текущие блайнды</span>
        <strong className="tv-blinds">{current.kind === 'break' ? '—' : <>{format.format(current.small)} <span>/</span> {format.format(current.big)}</>}</strong>
        {data.config.anteEnabled && current.kind === 'play' && current.ante > 0 &&
          <strong className="tv-ante"><span>Анте</span> {format.format(current.ante)}</strong>}
        <div className={'tv-countdown' + (left <= 30 && !breakActive ? ' tv-low' : '')}>
          <span className="tv-label">{paused ? 'Пауза' : breakActive ? 'Продолжение через' : 'Осталось'}</span>
          <strong>{timeLabel(left)}</strong>
          <progress aria-label="Прошло на уровне" max={Math.max(1, data.clock.duration)} value={Math.max(0, data.clock.duration - left)} />
        </div>
        <div className="tv-next">{next && <>Дальше <strong>{next.kind === 'break' ? 'Перерыв' : format.format(next.small) + ' / ' + format.format(next.big)}</strong></>}</div>
        {data.display.finalTable && <div className="tv-final">
          <h2>Финальный стол</h2>
          <ol>{data.results.filter(item => item.place === null || item.place === 1).slice(0, 9).map(item => <li key={item.playerId}>
            <span aria-hidden="true">{initialsOf(item.name)}</span>{item.name}
          </li>)}</ol>
        </div>}
      </section>
      <aside className="tv-stats">
        <h2>Турнир</h2>
        <TvStat label="Название" value={data.tournament.name} />
        <TvStat label="В игре" value={format.format(data.stats.active) + ' / ' + format.format(entries)} />
        <TvStat label="Средний стек" value={data.stats.active ? format.format(Math.round(chips / data.stats.active)) : '—'} />
        <TvStat label="Фишек в игре" value={format.format(chips)} />
      </aside>
    </div>}
    {!clockMode && <section className="tv-mode">
      <h1>{data.display.mode === 'seating' ? 'Рассадка' : data.display.mode === 'payouts' ? 'Призовая зона' : 'Результаты'}</h1>
      <p>{data.tournament.name}</p>
      {data.display.mode === 'seating' && <div className="tv-tables">{data.tables.map(table => <section key={table.number}>
        <h2>Стол {pad(table.number)}</h2>
        <ol>{Array.from({ length: table.capacity }, (_, index) => {
          const player = data.entries.find(entry => entry.tableNo === table.number && entry.seatNo === index + 1);
          return <li key={index}><span>{index + 1}</span><strong>{player?.nickname || player?.name || 'Свободно'}</strong></li>;
        })}</ol>
      </section>)}</div>}
      {data.display.mode === 'payouts' && <ol className="tv-results">{payouts.map((points, index) =>
        <li key={index}><span>{index + 1} место</span><strong>{format.format(points)} баллов</strong></li>)}</ol>}
      {data.display.mode === 'results' && <ol className="tv-results">{results.map(item =>
        <li key={item.playerId}><span>{item.place} место</span><strong>{item.name}</strong></li>)}</ol>}
      {data.display.mode === 'results' && !results.length && <p>Результатов пока нет</p>}
    </section>}
    {error && <p className="tv-connection" role="status">Связь прервана. Показано последнее состояние.</p>}
  </main>;
}

function TvStat({ label, value }: { label: string; value: string }) {
  return <div className="tv-stat"><span className="tv-label">{label}</span><strong>{value}</strong></div>;
}

export function TvScreen({ token }: { token: string }) {
  const [data, setData] = useState<Snapshot>();
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    let timer = 0;
    let controller: AbortController | undefined;
    async function refresh() {
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 7000);
      try {
        const next = await request<Snapshot>('/api/tv/' + encodeURIComponent(token), { signal: controller.signal });
        if (!stopped) { setData(next); setError(''); }
      } catch (reason) {
        if (!stopped) setError(reason instanceof Error ? reason.message : 'Не удалось открыть экран');
      } finally {
        window.clearTimeout(timeout);
        if (!stopped) timer = window.setTimeout(refresh, 2000);
      }
    }
    void refresh();
    return () => { stopped = true; window.clearTimeout(timer); controller?.abort(); };
  }, [token]);
  if (!data) return <main className="tv-screen tv-wait" role="status">{error || 'Загружаем ТВ-дисплей…'}</main>;
  return <Display data={data} error={error} />;
}

export function DoyleTvScreen({ tournament }: { tournament: string }) {
  const { data, error, isDoyleLive, authChecked } = useOffice(tournament);
  if (data && isDoyleLive) return <Display data={data} error={error} />;
  return <main className="tv-screen tv-wait" role="status">
    {error || (authChecked && !isDoyleLive ? 'Откройте ТВ из кабинета Doyle после входа' : 'Загружаем турнир Doyle…')}
  </main>;
}
