import '@fontsource-variable/golos-text';
import './style.css';
import './responsive.css';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { DoyleTvScreen, TvScreen } from './Display';
import { App } from './App';
import { PublicSchedule } from './PublicSchedule';
import { ThemeProvider } from './Theme';
import { PreferencesProvider } from './preferences';

function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const navigate = () => setHash(location.hash);
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get('tv');
  if (token) return <TvScreen key={token} token={token} />;
  const doyle = params.get('doyle-tv');
  if (doyle) return <DoyleTvScreen key={doyle} tournament={doyle} />;
  const club = params.get('schedule');
  return club ? <PublicSchedule key={club} club={club} tournament={params.get('tournament')} /> : <App />;
}

createRoot(document.getElementById('root')!).render(<ThemeProvider><PreferencesProvider><Root /></PreferencesProvider></ThemeProvider>);

