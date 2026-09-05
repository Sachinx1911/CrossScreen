# @crossscreen/protocol

The single source of truth for every message on the CrossScreen wire.

Zod schemas here are the definition. TypeScript types are inferred from them,
and the JSON Schema that the Kotlin (and later Swift) clients are generated
from is emitted from the same definitions. Nothing is hand-copied, so the
five client platforms cannot drift apart — the failure mode this package
exists to prevent.

## Layout

| File           | Contents                                                          |
| -------------- | ----------------------------------------------------------------- |
| `constants.ts` | Timeouts, rate limits, code/token formats, media defaults         |
| `errors.ts`    | Error codes paired with plain-language user text and retry policy |
| `session.ts`   | Session, participant and connection-state shapes                  |
| `messages.ts`  | The signaling protocol and its envelope                           |
| `parse.ts`     | Untrusted-input parsing: size cap, version check, validation      |

## Using it

```ts
import { envelope, parseClientEnvelope, errorMessage } from '@crossscreen/protocol';

const result = parseClientEnvelope(rawFrame);
if (!result.ok) {
  socket.send(JSON.stringify(envelope(errorMessage(result.code))));
  return;
}
```

Every inbound frame goes through `parseClientEnvelope` / `parseServerEnvelope`.
The byte cap and protocol-version check live inside them so no call site can
forget either one.

## Commands

```bash
pnpm --filter @crossscreen/protocol test     # node:test
pnpm --filter @crossscreen/protocol build    # tsc
pnpm --filter @crossscreen/protocol schema   # regenerate schema/*.json
```

`schema/` is committed and CI fails if it is stale, because the native clients
are generated from those files.

## Changing the protocol

Additive changes — a new message type, a new optional field — need no version
bump. Anything a current client would misread is breaking: bump
`PROTOCOL_VERSION`, and write an ADR. `parse.ts` checks the version _before_
the shape so an outdated client is told to update rather than shown a
validation failure it cannot act on.
