import { useEffect, useState } from 'react';

/**
 * Routing, in about forty lines.
 *
 * There are four screens and one of them takes a parameter. A router library
 * would be more configuration than the thing it configures, and this has to
 * work when a share link is opened cold — `/j/<token>` has to land on the join
 * screen with the token already in hand, which is the only requirement here
 * that is not trivial.
 */

export type Route =
  | { name: 'home' }
  | { name: 'share' }
  | { name: 'join'; token?: string }
  | { name: 'session' }
  | { name: 'settings' };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);

  if (parts[0] === 'share') return { name: 'share' };
  if (parts[0] === 'join') return { name: 'join' };
  if (parts[0] === 'settings') return { name: 'settings' };

  // The share link. Short on purpose: it gets pasted into messages, and every
  // extra character is one more chance for a line break to break it.
  if (parts[0] === 'j' && parts[1] !== undefined) return { name: 'join', token: parts[1] };

  return { name: 'home' };
}

export function navigate(path: string): void {
  history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));

  useEffect(() => {
    const onChange = (): void => {
      setRoute(parseRoute(location.pathname));
    };
    addEventListener('popstate', onChange);
    return () => {
      removeEventListener('popstate', onChange);
    };
  }, []);

  return route;
}
