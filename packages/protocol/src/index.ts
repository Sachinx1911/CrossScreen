/**
 * @crossscreen/protocol
 *
 * The single source of truth for every message on the CrossScreen wire.
 * TypeScript types are inferred from the Zod schemas here; the JSON Schema
 * used to generate Kotlin and Swift types is emitted from the same
 * definitions by `pnpm schema`, so clients cannot drift apart.
 */

export * from './constants.ts';
export * from './errors.ts';
export * from './session.ts';
export * from './messages.ts';
export * from './parse.ts';
