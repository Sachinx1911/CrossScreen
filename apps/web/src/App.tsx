import { useState, type ReactNode } from 'react';

import { Layout } from './components/Layout.tsx';
import { useRoute } from './router.ts';
import { Home } from './screens/Home.tsx';
import { Join } from './screens/Join.tsx';
import { Settings } from './screens/Settings.tsx';
import { Share } from './screens/Share.tsx';
import { Viewer } from './screens/Viewer.tsx';

export function App() {
  const route = useRoute();
  const [joining, setJoining] = useState<{ joinCode?: string; joinToken?: string }>();

  // Held here rather than in the URL: a join code in the address bar would end
  // up in browser history, in a shared screenshot of the address bar, and in
  // whatever the browser syncs. It is not a secret, but it is not decoration
  // either.
  if (route.name === 'join' && joining !== undefined) {
    return (
      <Layout>
        {/* Wider than the other screens: watching someone's screen is the
            one place the content, not the chrome, is the point. */}
        <AppScreen wide>
          <Viewer {...joining} />
        </AppScreen>
      </Layout>
    );
  }

  return (
    <Layout>
      {route.name === 'home' && <Home />}
      {route.name === 'share' && (
        <AppScreen>
          <Share />
        </AppScreen>
      )}
      {route.name === 'join' && (
        <AppScreen>
          <Join
            {...(route.token === undefined ? {} : { token: route.token })}
            onJoin={setJoining}
          />
        </AppScreen>
      )}
      {route.name === 'settings' && (
        <AppScreen>
          <Settings />
        </AppScreen>
      )}
    </Layout>
  );
}

/** The centred column the app screens (Share, Join, Viewer, Settings) sit in. The landing page manages its own full-width sections. */
function AppScreen({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto w-full px-5 py-12 ${wide ? 'max-w-[1040px]' : 'max-w-2xl'}`}>
      {children}
    </div>
  );
}
