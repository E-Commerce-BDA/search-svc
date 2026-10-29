export interface IEventConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const EVENT_CONSUMER = 'EVENT_CONSUMER';

