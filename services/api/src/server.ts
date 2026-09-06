import { buildApp } from './app.ts';
import { config } from './config.ts';
import { log } from './log.ts';

/**
 * Process entry point. Everything interesting is in `app.ts`; this file exists
 * to bind a socket and to stop cleanly.
 */

const app = buildApp();

try {
  await app.listen({ port: config.port, host: config.host });
  log.info('api.listening', { host: config.host, port: config.port });
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'EADDRINUSE') {
    log.error('api.port_in_use', {
      port: config.port,
      hint: 'Another API server is already running. Stop it, or set API_PORT.',
    });
  } else {
    log.error('api.listen_failed', { message: e.message });
  }
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info('api.stopping', { signal });
    void app.close().then(() => process.exit(0));
  });
}
