import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Fullscreen for the viewer.
 *
 * Someone watching a screen is looking at content that was laid out for a
 * whole display and is now inside a browser window inside another display.
 * Every pixel of chrome around it costs legibility, which is the one thing
 * this product cannot afford to lose.
 *
 * The container is made fullscreen rather than the video, so the connection
 * status and the way out stay reachable — except on Safari's mobile engine
 * (iOS and iPadOS, any browser there), which does not support fullscreen on
 * an arbitrary element at all. Its `Element.requestFullscreen` exists as a
 * method on every element, spec-compliantly, and so passes a capability
 * check — but calling it on anything other than a `<video>` simply rejects.
 * The button looked like it did nothing, because the code was checking
 * whether the method exists rather than whether it would actually work.
 * `webkitEnterFullscreen`'s presence is the real signal: it is the
 * video-only, WebKit-mobile-only method, so it is tried first rather than
 * as a last resort.
 */

interface IosVideo extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
  webkitDisplayingFullscreen?: boolean;
}

export function useFullscreen(
  container: RefObject<HTMLElement | null>,
  video: RefObject<HTMLVideoElement | null>,
): { isFullscreen: boolean; supported: boolean; toggle: () => void } {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = (): void => {
      setIsFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, []);

  // iOS's native video fullscreen is not the standard Fullscreen API at
  // all — `document.fullscreenElement` never reflects it — so it needs its
  // own two events to keep `isFullscreen` (and the toolbar it drives)
  // honest there.
  useEffect(() => {
    const el = video.current;
    if (el === null) return;
    const onBegin = (): void => {
      setIsFullscreen(true);
    };
    const onEnd = (): void => {
      setIsFullscreen(false);
    };
    el.addEventListener('webkitbeginfullscreen', onBegin);
    el.addEventListener('webkitendfullscreen', onEnd);
    return () => {
      el.removeEventListener('webkitbeginfullscreen', onBegin);
      el.removeEventListener('webkitendfullscreen', onEnd);
    };
  }, [video]);

  const toggle = useCallback(() => {
    const iosVideo: IosVideo | null = video.current;

    if (iosVideo?.webkitDisplayingFullscreen === true) {
      // iOS has no document.exitFullscreen() equivalent for this; leaving is
      // normally its own "Done" button, but the app's own control needs to
      // be able to do the same thing.
      iosVideo.webkitExitFullscreen?.();
      return;
    }
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen();
      return;
    }

    // Tried first, not as a fallback: see the class doc for why the
    // container path cannot be trusted to fail loudly on Safari mobile.
    if (iosVideo?.webkitEnterFullscreen !== undefined) {
      iosVideo.webkitEnterFullscreen();
      return;
    }

    const element = container.current;
    if (element !== null && typeof element.requestFullscreen === 'function') {
      // Rejected when the browser decides the gesture was not user-initiated.
      // Nothing to recover from, and an error dialog would be worse than the
      // button appearing not to work.
      void element.requestFullscreen().catch(() => undefined);
    }
  }, [container, video]);

  const supported =
    typeof document !== 'undefined' &&
    (document.fullscreenEnabled ||
      (video.current as IosVideo | null | undefined)?.webkitSupportsFullscreen === true);

  return { isFullscreen, supported, toggle };
}
