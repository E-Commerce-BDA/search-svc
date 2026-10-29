import { describe, expect, it } from 'vitest';
import { EventMapper } from '../src/indexer/event-mapper.js';

describe('EventMapper', () => {
  it('maps product.updated with full attributes', () => {
    const envelope = {
      topic: 'product.updated',
      eventType: 'product.updated',
      producer: 'catalog-svc',
      timestamp: '2026-10-28T12:00:00.000Z',
      payload: {
        productId: '0190a8b0-0000-7000-8000-000000000001',
        name: 'Speed Carbon Shoe',
        slug: 'speed-carbon-shoe',
        description: 'Lightweight race shoe',
        categorySlug: 'road-running',
        brandName: 'AeroSpeed',
        price: 199.99,
        effectivePrice: 179.99,
        categoryId: '0190a8b0-0000-7000-8000-000000000101',
        stock: 10,
        status: 'active',
        imageUrl: 'https://images.example.com/speed.jpg',
        updatedAt: '2026-10-28T12:05:00.000Z',
      },
    };

    const doc = EventMapper.mapToSearchDocument(envelope);
    expect(doc).not.toBeNull();
    expect(doc?.id).toBe('0190a8b0-0000-7000-8000-000000000001');
    expect(doc?.documentType).toBe('product');
    expect(doc?.title).toBe('Speed Carbon Shoe');
    expect(doc?.slug).toBe('speed-carbon-shoe');
    expect(doc?.content).toBe(
      'Speed Carbon Shoe Lightweight race shoe road-running AeroSpeed',
    );
    expect(doc?.imageUrl).toBe('https://images.example.com/speed.jpg');
    expect(doc?.price).toBe(199.99);
    expect(doc?.effectivePrice).toBe(179.99);
    expect(doc?.categoryId).toBe('0190a8b0-0000-7000-8000-000000000101');
    expect(doc?.status).toBe('active');
    expect(doc?.sourceUpdatedAt).toBe('2026-10-28T12:05:00.000Z');
    expect(doc?.popularity).toBeUndefined();
  });

  it('marks product inactive when stock is 0', () => {
    const envelope = {
      topic: 'product.imported',
      eventType: 'product.imported',
      payload: {
        productId: '0190a8b0-0000-7000-8000-000000000002',
        name: 'Out of Stock Shoe',
        slug: 'out-of-stock-shoe',
        status: 'active',
        stock: 0,
        price: 99.99,
        updatedAt: '2026-10-28T12:00:00.000Z',
      },
    };

    const doc = EventMapper.mapToSearchDocument(envelope);
    expect(doc?.status).toBe('inactive');
  });

  it('falls back to images[0] when imageUrl is missing for product', () => {
    const envelope = {
      topic: 'product.updated',
      payload: {
        productId: '0190a8b0-0000-7000-8000-000000000003',
        name: 'Gallery Shoe',
        slug: 'gallery-shoe',
        status: 'active',
        images: ['https://images.example.com/first.jpg'],
        price: 50.0,
      },
    };

    const doc = EventMapper.mapToSearchDocument(envelope);
    expect(doc?.imageUrl).toBe('https://images.example.com/first.jpg');
  });

  it('maps category.updated with isActive mapping', () => {
    const envelope = {
      topic: 'category.updated',
      payload: {
        categoryId: '0190a8b0-0000-7000-8000-000000000101',
        name: 'Trail Running',
        slug: 'trail-running',
        isActive: true,
        imageUrl: 'https://images.example.com/trail.jpg',
        updatedAt: '2026-10-28T10:00:00.000Z',
      },
    };

    const doc = EventMapper.mapToSearchDocument(envelope);
    expect(doc).not.toBeNull();
    expect(doc?.id).toBe('0190a8b0-0000-7000-8000-000000000101');
    expect(doc?.documentType).toBe('category');
    expect(doc?.title).toBe('Trail Running');
    expect(doc?.status).toBe('active');
    expect(doc?.price).toBeNull();
    expect(doc?.effectivePrice).toBeNull();
    expect(doc?.categoryId).toBeNull();
  });

  it('maps blog.updated with MongoDB ObjectId and published status', () => {
    const envelope = {
      topic: 'blog.updated',
      payload: {
        blogId: '507f1f77bcf86cd799439021',
        slug: 'top-trail-shoes-2026',
        title: 'Top Trail Shoes of 2026',
        excerpt: 'Expert guide to trail shoes',
        status: 'published',
        coverUrl: 'https://images.example.com/blog.jpg',
        publishedAt: '2026-10-28T09:00:00.000Z',
        updatedAt: '2026-10-28T09:30:00.000Z',
      },
    };

    const doc = EventMapper.mapToSearchDocument(envelope);
    expect(doc).not.toBeNull();
    expect(doc?.id).toBe('507f1f77bcf86cd799439021');
    expect(doc?.documentType).toBe('blog');
    expect(doc?.title).toBe('Top Trail Shoes of 2026');
    expect(doc?.content).toBe(
      'Top Trail Shoes of 2026 Expert guide to trail shoes',
    );
    expect(doc?.status).toBe('active');
    expect(doc?.imageUrl).toBe('https://images.example.com/blog.jpg');
    expect(doc?.price).toBeNull();
    expect(doc?.sourceUpdatedAt).toBe('2026-10-28T09:30:00.000Z');
  });

  it('maps draft blog to inactive status', () => {
    const envelope = {
      topic: 'blog.updated',
      payload: {
        blogId: '507f1f77bcf86cd799439021',
        slug: 'draft-post',
        title: 'Draft Post',
        status: 'draft',
      },
    };

    const doc = EventMapper.mapToSearchDocument(envelope);
    expect(doc?.status).toBe('inactive');
  });

  it('falls back to slug when blog title is missing', () => {
    const envelope = {
      topic: 'blog.updated',
      payload: {
        blogId: '507f1f77bcf86cd799439021',
        slug: 'no-title-slug',
        status: 'published',
      },
    };

    const doc = EventMapper.mapToSearchDocument(envelope);
    expect(doc?.title).toBe('no-title-slug');
  });

  it('returns null on unknown topic or malformed envelope', () => {
    expect(
      EventMapper.mapToSearchDocument({ topic: 'unknown.topic', payload: {} }),
    ).toBeNull();
    expect(EventMapper.mapToSearchDocument(null)).toBeNull();
    expect(EventMapper.mapToSearchDocument('invalid')).toBeNull();
  });
});

