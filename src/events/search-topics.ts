import type { EventTopic } from '@ecom/contracts';

/**
 * The topics this service is subscribed to. It is the one list: the Kafka
 * consumer subscribes with it, the interpreter accepts with it, and the
 * registry (`EVENT_TOPICS`) supplies the DLQ name for each entry.
 */
export const SEARCH_KAFKA_TOPICS = [
  'product.updated',
  'category.updated',
  'blog.updated',
  'product.imported',
] as const satisfies readonly EventTopic[];

export type SearchTopic = (typeof SEARCH_KAFKA_TOPICS)[number];

const SUBSCRIBED = new Set<string>(SEARCH_KAFKA_TOPICS);

export function isSearchTopic(topic: string): topic is SearchTopic {
  return SUBSCRIBED.has(topic);
}
