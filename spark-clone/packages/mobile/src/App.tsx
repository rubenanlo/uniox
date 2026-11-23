import { useEffect } from 'react';
import { Spinner, Toast } from './components/ui';
import { go, useRoute } from './lib/router';
import { useStore } from './lib/store';
import { useTheme } from './lib/theme';
import { Assistant } from './screens/Assistant';
import { CalendarScreen } from './screens/Calendar';
import { Composer } from './screens/Composer';
import { Home } from './screens/Home';
import { Inbox } from './screens/Inbox';
import { Notifications } from './screens/Notifications';
import { Search } from './screens/Search';
import { Settings } from './screens/Settings';
import { ThreadScreen } from './screens/Thread';
import { Welcome } from './screens/Welcome';

export function App() {
  const { ready, me, settings, online, queued, boot } = useStore();
  const route = useRoute();
  useTheme(settings);
  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (!ready) return;
    const at = route.path[0];
    if (!me && at !== 'welcome') go('welcome', true);
    if (me && (!at || at === 'welcome' || at === 'auth')) go('home', true);
  }, [ready, me, route.path]);

  if (!ready) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <Spinner />
      </div>
    );
  }

  const [at, id] = route.path;
  let screen;
  if (!me) screen = <Welcome />;
  else
    switch (at) {
      case 'inbox':
        screen = <Inbox />;
        break;
      case 'thread':
        screen = id ? <ThreadScreen key={id} id={id} /> : <Inbox />;
        break;
      case 'compose':
        screen = (
          <>
            <Inbox />
            <Composer />
          </>
        );
        break;
      case 'assistant':
        screen = <Assistant />;
        break;
      case 'calendar':
        screen = <CalendarScreen />;
        break;
      case 'search':
        screen = <Search />;
        break;
      case 'settings':
        screen = <Settings />;
        break;
      case 'notifications':
        screen = <Notifications />;
        break;
      default:
        screen = <Home />;
    }

  return (
    <div className="app">
      {screen}
      {!online && (
        <div className="offline-pill">Offline{queued ? ` · ${queued} waiting to send` : ''}</div>
      )}
      <Toast />
    </div>
  );
}
