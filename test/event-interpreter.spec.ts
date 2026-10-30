import { describe, expect, it } from 'vitest';
import { interpret } from '../src/events/event-interpreter.js';

/**
 * Envelope builder. `partial` overrides land last so a test can drop or
 * corrupt exactly one field.
 */
function envelope(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: '0190a8b0-0000-7000-8000-00000000e001',
    type: 'product.updated',
    producer: 'catalog-svc',
    timestamp: '2026-10-30T10:00:00.000Z',
    payload: {
      productId: '0190a8b0-0000-7000-8000-000000000001',
      name: 'Velocity Road Runner',
      slug: 'velocity-road-runner',
      price: 149.99,
      status: 'active',
      updatedAt: '2026-10-30T10:00:00.000Z',
    },
    ...overrides,
  };
}

describe('interpret', () => {
  it('maps a catalog-svc legacy envelope that dual-writes topic and eventType', () => {
    const legacy = {
      id: '0190a8b0-0000-7000-8000-00000000e002',
      topic: 'product.updated',
      eventType: 'product.updated',
      producer: 'catalog-svc',
      timestamp: '2026-10-30T10:00:00.000Z',
      payload: {
        productId: '0190a8b0-0000-7000-8000-000000000002',
        name: 'Summit Trail Pro',
        slug: 'summit-trail-pro',
        price: 189.5,
        status: 'active',
        updatedAt: '2026-10-30T10:00:00.000Z',
      },
    };

    const result = interpret(legacy);

    expect(result.kind).toBe('mapped');
    if (result.kind !== 'mapped') {
      return;
    }
    expect(result.eventId).toBe('0190a8b0-0000-7000-8000-00000000e002');
    expect(result.topic).toBe('product.updated');
    expect(result.doc).toMatchObject({
      id: '0190a8b0-0000-7000-8000-000000000002',
      documentType: 'product',
      title: 'Summit Trail Pro',
      status: 'active',
    });
  });

  it('ignores a registered topic this service does not consume', () => {
    // cms-svc publishes `cms.updated` on the `cms.events` transport topic.
    const result = interpret({
      id: '0190a8b0-0000-7000-8000-00000000e003',
      topic: 'cms.events',
      eventType: 'cms.updated',
      producer: 'cms-svc',
      timestamp: '2026-10-30T10:00:00.000Z',
      payload: { scope: 'section', version: 3 },
    });

    expect(result).toEqual({
      kind: 'ignored',
      reason: 'not-subscribed',
      type: 'cms.updated',
    });
  });

  it('ignores a type that is not in the registry at all', () => {
    const result = interpret({
      id: '0190a8b0-0000-7000-8000-00000000e004',
      type: 'order.placed',
      producer: 'order-svc',
      timestamp: '2026-10-30T10:00:00.000Z',
      payload: {},
    });

    expect(result).toEqual({
      kind: 'ignored',
      reason: 'unknown-topic',
      type: 'order.placed',
    });
  });

  it('rejects a payload that drifts from the contract', () => {
    const drifted = envelope();
    // `price` is required by productUpdatedPayloadSchema.
    delete (drifted.payload as Record<string, unknown>).price;

    const result = interpret(drifted);

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') {
      return;
    }
    expect(result.stage).toBe('payload');
    expect(result.topic).toBe('product.updated');
    expect(result.error).toContain('price');
  });

  it('rejects an envelope without a producer', () => {
    const broken = envelope({ producer: undefined });

    const result = interpret(broken);

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') {
      return;
    }
    expect(result.stage).toBe('envelope');
    expect(result.error).toContain('producer');
  });

  it('maps product.imported with the shape import-svc publishes', () => {
    const imported = envelope({
      id: '0190a8b0-0000-7000-8000-00000000e005',
      type: 'product.imported',
      producer: 'import-svc',
      payload: {
        productId: '0190a8b0-0000-7000-8000-000000000003',
        sku: 'SKU-TRAIL-001',
        name: 'Granite Grip GTX',
        slug: 'granite-grip-gtx',
        description: 'Waterproof trail shoe',
        categorySlug: 'trail-running',
        price: '199.00',
        stock: 12,
        status: 'active',
        updatedAt: '2026-10-30T09:00:00.000Z',
      },
    });

    const result = interpret(imported);

    expect(result.kind).toBe('mapped');
    if (result.kind !== 'mapped') {
      return;
    }
    expect(result.topic).toBe('product.imported');
    expect(result.doc.id).toBe('0190a8b0-0000-7000-8000-000000000003');
    expect(result.doc.price).toBe('199.00');
  });

  it('maps category.updated and carries the deactivation signal', () => {
    const result = interpret(
      envelope({
        type: 'category.updated',
        payload: {
          categoryId: '0190a8b0-0000-7000-8000-000000000101',
          name: 'Road Running',
          slug: 'road-running',
          isActive: false,
          updatedAt: '2026-10-30T10:00:00.000Z',
        },
      }),
    );

    expect(result.kind).toBe('mapped');
    if (result.kind !== 'mapped') {
      return;
    }
    expect(result.doc).toMatchObject({
      documentType: 'category',
      status: 'inactive',
    });
  });
});
