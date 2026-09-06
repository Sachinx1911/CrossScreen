import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * `localStorage` exists in every real environment this module runs in — a
 * browser tab, an Electron renderer — but not in plain Node, so a small
 * stand-in is set up before the module under test is imported.
 */
class FakeStorage {
  #data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.#data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#data.set(key, value);
  }
  removeItem(key: string): void {
    this.#data.delete(key);
  }
  clear(): void {
    this.#data.clear();
  }
}

const storage = new FakeStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

const { recordSharedSession, readRecentSessions, clearRecentSessions } =
  await import('./recent-sessions.ts');

test.beforeEach(() => {
  storage.clear();
});

test('a fresh device has no history', () => {
  assert.deepEqual(readRecentSessions(), []);
});

test('a shared session is recorded, newest first', () => {
  recordSharedSession({ joinCode: '111111', joinCodeDisplay: '111 111' }, 1_000);
  recordSharedSession({ joinCode: '222222', joinCodeDisplay: '222 222' }, 2_000);

  const history = readRecentSessions();
  assert.equal(history.length, 2);
  assert.equal(history[0]?.joinCode, '222222', 'the most recent share leads');
  assert.equal(history[1]?.joinCode, '111111');
  assert.equal(history[0]?.startedAt, 2_000);
});

test('the list does not grow without bound', () => {
  for (let i = 0; i < 10; i += 1) {
    recordSharedSession({ joinCode: String(i).padStart(6, '0'), joinCodeDisplay: 'x' }, i);
  }
  assert.equal(readRecentSessions().length, 5, 'capped rather than kept forever');
  assert.equal(readRecentSessions()[0]?.joinCode, '000009', 'the newest survives the cap');
});

test('clearing removes the history entirely, not just the most recent entry', () => {
  recordSharedSession({ joinCode: '111111', joinCodeDisplay: '111 111' }, 1_000);
  recordSharedSession({ joinCode: '222222', joinCodeDisplay: '222 222' }, 2_000);
  clearRecentSessions();
  assert.deepEqual(readRecentSessions(), []);
});

test('storage holding something else entirely reads as no history', () => {
  localStorage.setItem('crossscreen.recent-sessions', '{"not":"a list"}');
  assert.deepEqual(readRecentSessions(), []);
});

test('a malformed entry in an otherwise valid list is dropped, not thrown', () => {
  localStorage.setItem(
    'crossscreen.recent-sessions',
    JSON.stringify([
      { joinCode: '333333', joinCodeDisplay: '333 333', startedAt: 3_000 },
      { joinCode: '444444' }, // missing fields — a shape from an older or newer version
    ]),
  );
  const history = readRecentSessions();
  assert.equal(history.length, 1);
  assert.equal(history[0]?.joinCode, '333333');
});

test('storage that throws is treated as empty, not fatal', () => {
  const original = storage.getItem.bind(storage);
  storage.getItem = () => {
    throw new Error('storage disabled');
  };
  assert.deepEqual(readRecentSessions(), []);
  storage.getItem = original;
});
