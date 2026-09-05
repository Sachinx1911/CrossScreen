/**
 * Emits JSON Schema for the wire protocol into `schema/`.
 *
 * This is the bridge to the non-TypeScript clients: the Kotlin (and later
 * Swift) message types are generated from these files, so a change to a Zod
 * schema here propagates to every platform instead of being hand-copied and
 * quietly drifting (architecture §65).
 *
 * Run with: pnpm --filter @crossscreen/protocol schema
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { clientEnvelopeSchema, serverEnvelopeSchema } from './messages.ts';
import { sessionSummarySchema, joinRequestInfoSchema } from './session.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'schema');

const targets = {
  'client-envelope': clientEnvelopeSchema,
  'server-envelope': serverEnvelopeSchema,
  'session-summary': sessionSummarySchema,
  'join-request-info': joinRequestInfoSchema,
} as const;

mkdirSync(outDir, { recursive: true });

for (const [name, schema] of Object.entries(targets)) {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  const withId = {
    $id: `https://crossscreen.app/schema/${name}.json`,
    ...jsonSchema,
  };
  const file = join(outDir, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(withId, null, 2)}\n`, 'utf8');
  console.log(`wrote ${file}`);
}
