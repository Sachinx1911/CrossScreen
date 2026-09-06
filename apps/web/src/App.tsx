import { useState } from 'react';

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
        <Viewer {...joining} />
      </Layout>
    );
  }

  return (
    <Layout>
      {route.name === 'home' && <Home />}
      {route.name === 'share' && <Share />}
      {route.name === 'join' && (
        <Join {...(route.token === undefined ? {} : { token: route.token })} onJoin={setJoining} />
      )}
      {route.name === 'settings' && <Settings />}
    </Layout>
  );
}
