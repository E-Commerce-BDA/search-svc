import { describe, expect, it } from 'vitest';
import {
  ConsumerMetrics,
  recordEventOutcome,
} from '../src/events/consumer-metrics.js';

const ZERO = {
  accepted: 0,
  skipped: 0,
  duplicate: 0,
  ignored: 0,
  invalid: 0,
  dlq: 0,
};

describe('ConsumerMetrics', () => {
  it('starts at zero and counts each outcome independently', () => {
    const metrics = new ConsumerMetrics();
    expect(metrics.snapshot()).toEqual(ZERO);

    metrics.record('accepted');
    metrics.record('accepted');
    metrics.record('dlq');

    expect(metrics.snapshot()).toEqual({
      ...ZERO,
      accepted: 2,
      dlq: 1,
    });
  });

  it('hands out a copy so a reader cannot mutate the counters', () => {
    const metrics = new ConsumerMetrics();
    metrics.record('ignored');

    const snapshot = metrics.snapshot();
    snapshot.ignored = 99;

    expect(metrics.snapshot().ignored).toBe(1);
  });

  it('resets every counter', () => {
    const metrics = new ConsumerMetrics();
    metrics.record('accepted');
    metrics.record('invalid');

    metrics.reset();

    expect(metrics.snapshot()).toEqual(ZERO);
  });
});

describe('recordEventOutcome', () => {
  it('folds an indexed outcome into accepted or skipped', () => {
    const metrics = new ConsumerMetrics();

    recordEventOutcome(metrics, {
      kind: 'indexed',
      status: 'accepted',
      eventId: 'e1',
    });
    recordEventOutcome(metrics, {
      kind: 'indexed',
      status: 'skipped',
      eventId: 'e2',
    });

    expect(metrics.snapshot()).toMatchObject({ accepted: 1, skipped: 1 });
  });

  it('counts a duplicate, an ignored, and an invalid event', () => {
    const metrics = new ConsumerMetrics();

    recordEventOutcome(metrics, { kind: 'duplicate', eventId: 'e1' });
    recordEventOutcome(metrics, {
      kind: 'ignored',
      reason: 'not-subscribed',
      type: 'cms.updated',
    });
    recordEventOutcome(metrics, {
      kind: 'invalid',
      stage: 'payload',
      topic: 'product.updated',
      error: 'price: required',
    });

    // `dlq` stays at zero: it counts successful DLQ writes, not verdicts.
    expect(metrics.snapshot()).toMatchObject({
      duplicate: 1,
      ignored: 1,
      invalid: 1,
      dlq: 0,
    });
  });
});
