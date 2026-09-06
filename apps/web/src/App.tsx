import { Layout } from './components/Layout.tsx';
import { useRoute } from './router.ts';
import { Home } from './screens/Home.tsx';
import { Join } from './screens/Join.tsx';
import { Share } from './screens/Share.tsx';

export function App() {
  const route = useRoute();

  return (
    <Layout>
      {route.name === 'home' && <Home />}
      {route.name === 'share' && <Share />}
      {route.name === 'join' && (
        <Join {...(route.token === undefined ? {} : { token: route.token })} />
      )}
    </Layout>
  );
}
