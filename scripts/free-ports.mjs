/**
 * Frees the development ports before `pnpm dev` claims them.
 *
 * Ctrl+C does not always take Vite down with it, and a stale server holds its
 * port while the new one quietly moves to the next free number. The result is
 * the worst kind of confusion: the page loads, everything looks fine, and it
 * is an hour-old build. That happened, and cost an hour.
 *
 * Only processes *listening* on exactly these ports are stopped, and each one
 * is named as it goes, because a script that silently kills things is worse
 * than the problem it solves.
 */

import { execFileSync } from 'node:child_process';

const PORTS = [5173, 5174, 5175, 8787, 8788];

/** Returns the pids listening on `port`, or an empty list. */
function listenersOn(port) {
  try {
    if (process.platform === 'win32') {
      // `netstat -ano` rather than Get-NetTCPConnection: it is present on
      // every Windows, and it does not treat "nothing found" as an error.
      const output = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
      return [
        ...new Set(
          output
            .split('\n')
            .filter((line) => line.includes('LISTENING') && line.includes(`:${port} `))
            .map((line) => line.trim().split(/\s+/).at(-1))
            .filter((pid) => pid !== undefined && pid !== '0'),
        ),
      ];
    }

    const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
    });
    return output.split('\n').filter((pid) => pid.trim() !== '');
  } catch {
    // Nothing listening. Both tools exit non-zero for that, which is not an
    // error here — it is the outcome we want.
    return [];
  }
}

function stop(pid) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
    } else {
      process.kill(Number(pid), 'SIGTERM');
    }
    return true;
  } catch {
    // Already gone, or not ours to stop. Neither is worth failing over.
    return false;
  }
}

let freed = 0;
for (const port of PORTS) {
  for (const pid of listenersOn(port)) {
    if (stop(pid)) {
      console.log(`freed port ${port} (pid ${pid})`);
      freed += 1;
    }
  }
}

if (freed > 0) console.log(`\n${freed} stale server(s) stopped.\n`);
