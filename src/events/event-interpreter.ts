import {
  isEventTopic,
  parseEventPayload,
  readEventEnvelope,
  type CanonicalEventEnvelope,
  type EventTopic,
  type SearchDocument,
} from '@ecom/contracts';
import { ZodError } from 'zod';
import { EventMapper } from '../indexer/event-mapper.js';
import { isSearchTopic } from './search-topics.js';

/**
 * What one incoming record turns out to be. The three branches map one-to-one
 * onto the three things the consumer can do with it: index it, ignore it, or
 * send it to the DLQ.
 */
export type InterpretResult =
  | {
      kind: 'mapped';
      eventId: string;
      topic: EventTopic;
      doc: SearchDocument;
    }
  | {
      kind: 'ignored';
      reason: 'unknown-topic' | 'not-subscribed' | 'unmappable';
      type?: string;
    }
  | {
      kind: 'invalid';
      stage: 'envelope' | 'payload';
      topic?: string;
      error: string;
    };

/** Longest error summary kept on a DLQ record; a Zod error can be huge. */
const MAX_ERROR_LENGTH = 300;
const MAX_ISSUES = 3;

/**
 * Classifies one envelope against the contract registry.
 *
 * Pure and dependency-free on purpose: the Kafka consumer, the in-memory
 * consumer, and the unit tests all need the same answer to "what is this?",
 * and none of them should need a broker or a database to get it.
 */
export function interpret(input: unknown): InterpretResult {
  let envelope: CanonicalEventEnvelope;
  try {
    // Normalizes `type` against the legacy `eventType`/`topic` dual-write.
    envelope = readEventEnvelope(input);
  } catch (error) {
    return { kind: 'invalid', stage: 'envelope', error: describe(error) };
  }

  const { type } = envelope;

  if (!isEventTopic(type)) {
    return { kind: 'ignored', reason: 'unknown-topic', type };
  }

  if (!isSearchTopic(type)) {
    // e.g. `cms.updated`, which cms-svc publishes on the `cms.events`
    // transport topic. Committed and counted, never DLQed: nothing is wrong
    // with the message, we simply have no use for it.
    return { kind: 'ignored', reason: 'not-subscribed', type };
  }

  try {
    parseEventPayload(type, envelope.payload);
  } catch (error) {
    return {
      kind: 'invalid',
      stage: 'payload',
      topic: type,
      error: describe(error),
    };
  }

  const doc = EventMapper.mapToSearchDocument({
    topic: type,
    payload: envelope.payload,
    timestamp: envelope.timestamp,
  });

  if (!doc) {
    return { kind: 'ignored', reason: 'unmappable', type };
  }

  return { kind: 'mapped', eventId: envelope.id, topic: type, doc };
}

function describe(error: unknown): string {
  if (error instanceof ZodError) {
    const issues = error.issues
      .slice(0, MAX_ISSUES)
      .map((issue) => {
        const path = issue.path.map(String).join('.') || '<root>';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    const rest = error.issues.length - MAX_ISSUES;
    return clip(rest > 0 ? `${issues} (+${rest} more)` : issues);
  }

  return clip(error instanceof Error ? error.message : String(error));
}

function clip(text: string): string {
  return text.length > MAX_ERROR_LENGTH
    ? `${text.slice(0, MAX_ERROR_LENGTH)}…`
    : text;
}
