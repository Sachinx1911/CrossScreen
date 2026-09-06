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
 * status and the way out stay reachable. iOS Safari does not support
 * fullscreen on an arbitrary element at all — only on a video, through its own
 * prefixed method — so that case is handled separately rather than silently
 * doing nothing.
 */

interface IosVideo extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
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

  const toggle = useCallback(() => {
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen();
      return;
    }

    const element = container.current;
    if (element !== null && typeof element.requestFullscreen === 'function') {
      // Rejected when the browser decides the gesture was not user-initiated.
      // Nothing to recover from, and an error dialog would be worse than the
      // button appearing not to work.
      void element.requestFullscreen().catch(() => undefined);
      return;
    }

    // iOS: only a video can go fullscreen, and only this way.
    const iosVideo: IosVideo | null = video.current;
    iosVideo?.webkitEnterFullscreen?.();
  }, [container, video]);

  const supported =
    typeof document !== 'undefined' &&
    (document.fullscreenEnabled ||
      (video.current as IosVideo | null | undefined)?.webkitSupportsFullscreen === true);

  return { isFullscreen, supported, toggle };
}
