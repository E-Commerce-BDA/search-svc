import type { SearchDocument } from '@ecom/contracts';

interface GenericEventEnvelope {
  topic?: string;
  eventType?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

export class EventMapper {
  static mapToSearchDocument(envelope: unknown): SearchDocument | null {
    if (!envelope || typeof envelope !== 'object') {
      return null;
    }

    const env = envelope as GenericEventEnvelope;
    const topic = env.topic ?? '';
    const payload = env.payload;

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const fallbackTimestamp =
      typeof env.timestamp === 'string'
        ? env.timestamp
        : new Date().toISOString();

    switch (topic) {
      case 'product.imported':
      case 'product.updated': {
        const productId =
          typeof payload.productId === 'string' ? payload.productId : '';
        const name = typeof payload.name === 'string' ? payload.name : '';
        const slug = typeof payload.slug === 'string' ? payload.slug : '';

        if (!productId || !name || !slug) {
          return null;
        }

        const description =
          typeof payload.description === 'string' ? payload.description : '';
        const categorySlug =
          typeof payload.categorySlug === 'string' ? payload.categorySlug : '';
        const brandName =
          typeof payload.brandName === 'string' ? payload.brandName : '';

        const content = [name, description, categorySlug, brandName]
          .filter(Boolean)
          .join(' ');

        const images = Array.isArray(payload.images) ? payload.images : [];
        const imageUrl =
          typeof payload.imageUrl === 'string'
            ? payload.imageUrl
            : typeof images[0] === 'string'
              ? images[0]
              : null;

        const rawPrice = payload.price;
        const price =
          typeof rawPrice === 'number' || typeof rawPrice === 'string'
            ? rawPrice
            : 0;

        const rawEffectivePrice = payload.effectivePrice;
        const effectivePrice =
          typeof rawEffectivePrice === 'number' ||
          typeof rawEffectivePrice === 'string'
            ? rawEffectivePrice
            : null;

        const categoryId =
          typeof payload.categoryId === 'string' ? payload.categoryId : null;

        const rawStock = payload.stock;
        const stock = typeof rawStock === 'number' ? rawStock : undefined;
        const sourceStatus = payload.status;
        const isActive =
          sourceStatus === 'active' && (stock === undefined || stock > 0);

        const sourceUpdatedAt =
          typeof payload.updatedAt === 'string'
            ? payload.updatedAt
            : fallbackTimestamp;

        return {
          id: productId,
          documentType: 'product',
          title: name,
          slug,
          content,
          imageUrl,
          price,
          effectivePrice,
          categoryId,
          status: isActive ? 'active' : 'inactive',
          sourceUpdatedAt,
        };
      }

      case 'category.updated': {
        const categoryId =
          typeof payload.categoryId === 'string' ? payload.categoryId : '';
        const name = typeof payload.name === 'string' ? payload.name : '';
        const slug = typeof payload.slug === 'string' ? payload.slug : '';

        if (!categoryId || !name || !slug) {
          return null;
        }

        const imageUrl =
          typeof payload.imageUrl === 'string' ? payload.imageUrl : null;
        const isActive = payload.isActive === true;
        const sourceUpdatedAt =
          typeof payload.updatedAt === 'string'
            ? payload.updatedAt
            : fallbackTimestamp;

        return {
          id: categoryId,
          documentType: 'category',
          title: name,
          slug,
          content: name,
          imageUrl,
          price: null,
          effectivePrice: null,
          categoryId: null,
          status: isActive ? 'active' : 'inactive',
          sourceUpdatedAt,
        };
      }

      case 'blog.updated': {
        const blogId = typeof payload.blogId === 'string' ? payload.blogId : '';
        const slug = typeof payload.slug === 'string' ? payload.slug : '';

        if (!blogId || !slug) {
          return null;
        }

        const rawTitle = typeof payload.title === 'string' ? payload.title : '';
        const title = rawTitle || slug;
        const excerpt =
          typeof payload.excerpt === 'string' ? payload.excerpt : '';
        const content = [title, excerpt].filter(Boolean).join(' ');

        const coverUrl =
          typeof payload.coverUrl === 'string' ? payload.coverUrl : null;
        const status = payload.status === 'published' ? 'active' : 'inactive';

        const sourceUpdatedAt =
          typeof payload.updatedAt === 'string'
            ? payload.updatedAt
            : typeof payload.publishedAt === 'string'
              ? payload.publishedAt
              : fallbackTimestamp;

        return {
          id: blogId,
          documentType: 'blog',
          title,
          slug,
          content,
          imageUrl: coverUrl,
          price: null,
          effectivePrice: null,
          categoryId: null,
          status,
          sourceUpdatedAt,
        };
      }

      default:
        return null;
    }
  }
}
