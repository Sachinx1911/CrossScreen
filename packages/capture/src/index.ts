/**
 * @crossscreen/capture
 *
 * One interface over a capture layer that genuinely cannot be cross-platform
 * (architecture §6). `capabilities()` is how the differences reach the UI —
 * no component branches on platform directly.
 */

export * from './types.ts';
export * from './detect.ts';
export * from './browser-capture.ts';
export * from './electron-capture.ts';
