import { Injectable } from '@nestjs/common';
import type { HandleEventOutcome } from '../indexer/indexer.service.js';

/**
 * Per-outcome counters for the consumer. They are process-local and reset on
 * boot, which is the cheapest thing that can answer "how many events did we
 * drop in the last hour" without a metrics sidecar.
 */
export type ConsumerOutcome =
  | 'accepted'
  | 'skipped'
  | 'duplicate'
  | 'ignored'
  | 'invalid'
  | 'dlq';

export type ConsumerStatsSnapshot = Record<ConsumerOutcome, number>;

const OUTCOMES: readonly ConsumerOutcome[] = [
  'accepted',
  'skipped',
  'duplicate',
  'ignored',
  'invalid',
  'dlq',
];

@Injectable()
export class ConsumerMetrics {
  private readonly counts: ConsumerStatsSnapshot = {
    accepted: 0,
    skipped: 0,
    duplicate: 0,
    ignored: 0,
    invalid: 0,
    dlq: 0,
  };

  record(outcome: ConsumerOutcome): void {
    this.counts[outcome] += 1;
  }

  snapshot(): ConsumerStatsSnapshot {
    return { ...this.counts };
  }

  reset(): void {
    for (const outcome of OUTCOMES) {
      this.counts[outcome] = 0;
    }
  }
}

/**
 * Folds one `handleEvent` result into the counters.
 *
 * `dlq` is deliberately *not* recorded here: it counts DLQ writes that
 * actually succeeded, and only the Kafka consumer can know that.
 */
export function recordEventOutcome(
  metrics: ConsumerMetrics,
  outcome: HandleEventOutcome,
): void {
  switch (outcome.kind) {
    case 'indexed':
      metrics.record(outcome.status);
      break;
    case 'duplicate':
      metrics.record('duplicate');
      break;
    case 'ignored':
      metrics.record('ignored');
      break;
    case 'invalid':
      metrics.record('invalid');
      break;
  }
}
