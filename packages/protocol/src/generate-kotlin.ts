/**
 * Emits Kotlin data classes and a `kotlinx.serialization` sealed hierarchy
 * for the wire protocol, into the Android app.
 *
 * phase-4-android.md's own deliverable: "Kotlin protocol types generated from
 * `packages/protocol/schema`, not hand-written. This is the moment the JSON
 * Schema work in Phase 0 pays for itself, and hand-copying here would
 * guarantee drift" (architecture §65). `generate-schema.ts` already produces
 * the JSON; this walks the same shapes into Kotlin.
 *
 * This is not a general JSON-Schema-to-Kotlin compiler. It knows exactly the
 * enums and nested objects this protocol has, by a registry keyed on their
 * structural signature (sorted field names). That is a deliberate trade: a
 * fully generic walker would have to *guess* that a `{role, state,
 * deviceLabel, participantId}` shape should be called `Participant` rather
 * than emitting an anonymous nested class at every use site, and guessing
 * wrong is worse than refusing. Meeting a shape the registry does not
 * recognise throws, by name, rather than emitting something plausible-looking
 * and wrong — the same failure mode `parseClientEnvelope` already prefers for
 * a malformed message over quietly repairing it.
 *
 * Run: pnpm --filter @crossscreen/protocol generate:kotlin
 *
 * Not yet wired into CI (phase-4-android.md exit criterion 6's second half).
 * Regeneration after a protocol change is manual, same as `generate:schema`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { PROTOCOL_VERSION } from './constants.ts';
import { ERROR_CODES } from './errors.ts';
import { clientEnvelopeSchema, serverEnvelopeSchema } from './messages.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(
  here,
  '..',
  '..',
  '..',
  'apps',
  'android',
  'app',
  'src',
  'main',
  'kotlin',
  'app',
  'crossscreen',
  'android',
  'protocol',
  'Protocol.kt',
);

// --------------------------------------------------------------------------
// The registry. See the file doc comment for why this exists instead of a
// generic walk. Keys are field names (objects) or member values (enums),
// sorted and comma-joined, so the registry does not care about property
// order — only about what shape a schema actually has.
// --------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>;

const ENUM_REGISTRY: Record<string, string> = {
  'active,ended,expired,waiting': 'SessionState',
  'host,viewer': 'ParticipantRole',
  'approved,connected,disconnected,pending,rejected': 'ParticipantState',
  'code,link': 'JoinedVia',
  'excellent,good,poor,unstable': 'ConnectionQuality',
  'checking,connected,connecting,failed,reconnecting,securing,unstable': 'ConnectionState',
  'direct,relay,unknown': 'Transport',
  'expired,host_ended,idle_timeout': 'EndReason',
  [[...ERROR_CODES].sort().join(',')]: 'ErrorCode',
};

// Keyed on *every* property name, required or not — `objectType` builds the
// same key from `Object.keys(properties)`, and an optional field is still a
// property.
const OBJECT_REGISTRY: Record<string, string> = {
  'deviceLabel,joinedAt,participantId,role,state': 'Participant',
  'createdAt,expiresAt,joinCode,participants,state': 'SessionSummary',
  'approximateLocation,deviceLabel,joinedVia,participantId,requestedAt': 'JoinRequestInfo',
  'participantId,participantToken': 'ResumeInfo',
};

/** camelCase or dot.separated.words -> PascalCase, for class and enum-value names. */
function pascalCase(input: string): string {
  return input
    .split(/[._-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** dot.separated -> SCREAMING_SNAKE, for enum constant names. */
function screamingSnake(input: string): string {
  return input.replace(/[.-]/g, '_').toUpperCase();
}

class KotlinEmitter {
  readonly enums = new Map<string, string[]>();
  readonly objects = new Map<string, { name: string; type: string; optional: boolean }[]>();

  private schema(s: unknown): JsonSchema {
    return s as JsonSchema;
  }

  /** Resolves one property's JSON Schema into a Kotlin type, registering any enum or object it references. */
  typeFor(raw: unknown, context: string): string {
    const s = this.schema(raw);

    if (Array.isArray(s['enum'])) {
      const values = (s['enum'] as string[]).slice().sort();
      const key = values.join(',');
      const name = ENUM_REGISTRY[key];
      if (name === undefined) {
        throw new Error(
          `Unregistered enum at ${context}: [${values.join(', ')}]. ` +
            `Add it to ENUM_REGISTRY in generate-kotlin.ts.`,
        );
      }
      if (!this.enums.has(name)) this.enums.set(name, s['enum'] as string[]);
      return name;
    }

    // Nullable forms zod's toJSONSchema produces: `type: [T, "null"]` for a
    // nullable string, `anyOf: [{...}, {type:"null"}]` for a nullable number.
    // Both come from the same `.nullable()`, so both are handled here rather
    // than at each call site.
    const typeField = s['type'];
    if (Array.isArray(typeField) && typeField.includes('null')) {
      const base = typeField.find((t) => t !== 'null') as string;
      return `${this.primitive(base)}?`;
    }
    if (Array.isArray(s['anyOf'])) {
      const branches = s['anyOf'] as JsonSchema[];
      const nonNull = branches.find((b) => b['type'] !== 'null');
      const hasNull = branches.some((b) => b['type'] === 'null');
      if (nonNull === undefined) throw new Error(`anyOf with no non-null branch at ${context}`);
      const inner = this.typeFor(nonNull, context);
      return hasNull ? `${inner}?` : inner;
    }

    if (typeField === 'array') {
      const items = s['items'];
      if (items === undefined) throw new Error(`array with no items at ${context}`);
      return `List<${this.typeFor(items, `${context}[]`)}>`;
    }

    if (typeField === 'object') {
      return this.objectType(s, context);
    }

    return this.primitive(typeField as string, context);
  }

  private primitive(t: string, context = t): string {
    switch (t) {
      case 'string':
        return 'String';
      case 'integer':
        return 'Long';
      case 'number':
        return 'Double';
      case 'boolean':
        return 'Boolean';
      default:
        throw new Error(`Unhandled JSON Schema primitive "${t}" at ${context}`);
    }
  }

  /** Registers a named data class for an object schema, returning its name. */
  private objectType(s: JsonSchema, context: string): string {
    const properties = (s['properties'] ?? {}) as Record<string, JsonSchema>;
    const required = new Set((s['required'] as string[] | undefined) ?? []);
    const key = Object.keys(properties).slice().sort().join(',');
    const name = OBJECT_REGISTRY[key];
    if (name === undefined) {
      throw new Error(
        `Unregistered object shape at ${context}: {${Object.keys(properties).sort().join(', ')}}. ` +
          `Add it to OBJECT_REGISTRY in generate-kotlin.ts.`,
      );
    }

    if (!this.objects.has(name)) {
      const fields = Object.entries(properties).map(([propName, propSchema]) => ({
        name: propName,
        type: this.typeFor(propSchema, `${name}.${propName}`),
        optional: !required.has(propName),
      }));
      this.objects.set(name, fields);
    }
    return name;
  }

  /** One variant of a discriminated union: everything but the `type` const. */
  variantFields(
    variant: JsonSchema,
    className: string,
  ): { name: string; type: string; optional: boolean }[] {
    const properties = (variant['properties'] ?? {}) as Record<string, JsonSchema>;
    const required = new Set((variant['required'] as string[] | undefined) ?? []);
    return Object.entries(properties)
      .filter(([name]) => name !== 'type')
      .map(([name, propSchema]) => ({
        name,
        type: this.typeFor(propSchema, `${className}.${name}`),
        optional: !required.has(name),
      }));
  }
}

function renderEnum(name: string, values: string[]): string {
  const constants = values.map((v) => `    @SerialName("${v}") ${screamingSnake(v)},`).join('\n');
  return `@Serializable\nenum class ${name} {\n${constants}\n}`;
}

/** `T` for a required field, `T?` for one that may be absent, never doubling up on a `?` the JSON type already carries. */
function fieldType(f: { type: string; optional: boolean }): string {
  if (!f.optional) return f.type;
  return f.type.endsWith('?') ? f.type : `${f.type}?`;
}

function fieldParams(fields: { name: string; type: string; optional: boolean }[]): string {
  return fields
    .map((f) => `    val ${f.name}: ${fieldType(f)}${f.optional ? ' = null' : ''},`)
    .join('\n');
}

/** A plain named data class — every entry in OBJECT_REGISTRY has fields, so this is never the zero-field case. */
function renderDataClass(
  name: string,
  fields: { name: string; type: string; optional: boolean }[],
): string {
  return `@Serializable\ndata class ${name}(\n${fieldParams(fields)}\n)`;
}

/**
 * The wire type "error" would produce a Kotlin class literally named `Error`,
 * shadowing `kotlin.Error` in every file that imports it unqualified — a
 * confusing, entirely avoidable name for something that is not a Throwable.
 * Nothing else in the protocol collides with a standard-library name.
 */
const CLASS_NAME_OVERRIDES: Record<string, string> = {
  error: 'ErrorMessage',
};

/**
 * One member of a sealed interface, indented as a nested declaration.
 *
 * Nested rather than a top-level sibling: `rtc.offer` names a client
 * variant with `to` and a server variant with `from` — the same wire type,
 * a different shape depending on direction — so `ClientMessage.RtcOffer` and
 * `ServerMessage.RtcOffer` have to be distinct types. Nesting each inside its
 * own sealed interface is what makes the identical simple name legal, the
 * same reason `session.state` (a message) and `SessionState` (the enum
 * `waiting`/`active`/`ended`/`expired` it carries) do not collide either.
 *
 * A variant with no fields beyond `type` — `ping`, `session.end` — becomes a
 * `data object`: kotlinx.serialization handles a singleton in a polymorphic
 * hierarchy the same as a data class, and a class with no properties would be
 * a class solely to hold no state.
 */
function renderVariant(emitter: KotlinEmitter, variant: JsonSchema, interfaceName: string): string {
  const wireType = (variant['properties'] as JsonSchema)['type'] as JsonSchema;
  const literal = wireType['const'] as string;
  const className = CLASS_NAME_OVERRIDES[literal] ?? pascalCase(literal);
  const fields = emitter.variantFields(variant, className);

  const body =
    fields.length === 0
      ? `data object ${className} : ${interfaceName}`
      : `data class ${className}(\n${fieldParams(fields)}\n) : ${interfaceName}`;

  return `@Serializable\n@SerialName("${literal}")\n${body}`;
}

function indent(block: string, spaces = 4): string {
  const pad = ' '.repeat(spaces);
  return block
    .split('\n')
    .map((line) => (line.length === 0 ? line : pad + line))
    .join('\n');
}

function renderUnion(emitter: KotlinEmitter, envelopeSchema: JsonSchema, name: string): string {
  const payload = (envelopeSchema['properties'] as JsonSchema)['payload'] as JsonSchema;
  const variants = payload['oneOf'] as JsonSchema[];
  const rendered = variants.map((v) => indent(renderVariant(emitter, v, name)));
  return `@Serializable\nsealed interface ${name} {\n\n${rendered.join('\n\n')}\n}`;
}

function renderEnvelope(name: string, payloadType: string): string {
  return (
    `@Serializable\n` +
    `data class ${name}(\n` +
    `    val v: Int,\n` +
    `    val id: String,\n` +
    `    val ts: Long,\n` +
    `    val payload: ${payloadType},\n` +
    `)`
  );
}

// --------------------------------------------------------------------------

const clientJsonSchema = z.toJSONSchema(clientEnvelopeSchema, {
  target: 'draft-2020-12',
}) as JsonSchema;
const serverJsonSchema = z.toJSONSchema(serverEnvelopeSchema, {
  target: 'draft-2020-12',
}) as JsonSchema;

const emitter = new KotlinEmitter();

const clientUnion = renderUnion(emitter, clientJsonSchema, 'ClientMessage');
const serverUnion = renderUnion(emitter, serverJsonSchema, 'ServerMessage');
const clientEnvelope = renderEnvelope('ClientEnvelope', 'ClientMessage');
const serverEnvelope = renderEnvelope('ServerEnvelope', 'ServerMessage');

const enumBlocks = [...emitter.enums.entries()].map(([name, values]) => renderEnum(name, values));
const objectBlocks = [...emitter.objects.entries()].map(([name, fields]) =>
  renderDataClass(name, fields),
);

const header = `/*
 * GENERATED — do not edit by hand.
 *
 * Source of truth: packages/protocol/src/{messages,session,errors}.ts
 * Regenerate: pnpm --filter @crossscreen/protocol generate:kotlin
 *
 * Not enforced in CI yet (phase-4-android.md exit criterion 6's second
 * half) — a protocol change and forgetting to re-run this will not fail a
 * build on its own. Re-run it whenever packages/protocol/src changes.
 */

package app.crossscreen.android.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Matches PROTOCOL_VERSION in packages/protocol/src/constants.ts. A mismatch is refused, never guessed at. */
const val PROTOCOL_VERSION: Int = ${PROTOCOL_VERSION}
`;

const output = [
  header,
  ...enumBlocks,
  ...objectBlocks,
  clientUnion,
  serverUnion,
  clientEnvelope,
  serverEnvelope,
]
  .join('\n\n')
  .trimEnd()
  .concat('\n');

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, output, 'utf8');
console.log(`wrote ${outFile}`);
console.log(`  enums:   ${emitter.enums.size}`);
console.log(`  objects: ${emitter.objects.size}`);
