BEGIN;

-- Seed categories (3 total: 2 active, 1 inactive)
INSERT INTO search.search_documents (
  id, document_type, title, slug, content, image_url,
  price, effective_price, category_id, popularity, status,
  source_updated_at, synced_at
) VALUES
  (
    '0190a8b0-0000-7000-8000-000000000101',
    'category',
    'Road Running',
    'road-running',
    'Road running shoes and apparel engineered for pavement, tempo runs, and marathons.',
    'https://images.example.com/categories/road-running.jpg',
    NULL,
    NULL,
    NULL,
    80,
    'active',
    '2026-01-10 10:00:00+00',
    now()
  ),
  (
    '0190a8b0-0000-7000-8000-000000000102',
    'category',
    'Trail Running',
    'trail-running',
    'Rugged trail running shoes and gear built for rocky dirt, mountain terrain, and muddy paths.',
    'https://images.example.com/categories/trail-running.jpg',
    NULL,
    NULL,
    NULL,
    75,
    'active',
    '2026-01-10 10:00:00+00',
    now()
  ),
  (
    '0190a8b0-0000-7000-8000-000000000103',
    'category',
    'Track & Field',
    'track-and-field',
    'Track and field spiked footwear and sprint spikes for competitive athletic racing.',
    NULL,
    NULL,
    NULL,
    NULL,
    10,
    'inactive',
    '2026-01-10 10:00:00+00',
    now()
  )
ON CONFLICT (document_type, id) DO UPDATE SET
  title = EXCLUDED.title,
  slug = EXCLUDED.slug,
  content = EXCLUDED.content,
  image_url = EXCLUDED.image_url,
  price = EXCLUDED.price,
  effective_price = EXCLUDED.effective_price,
  category_id = EXCLUDED.category_id,
  popularity = EXCLUDED.popularity,
  status = EXCLUDED.status,
  source_updated_at = EXCLUDED.source_updated_at,
  synced_at = now();

-- Seed products (6 total: 5 active, 1 inactive)
INSERT INTO search.search_documents (
  id, document_type, title, slug, content, image_url,
  price, effective_price, category_id, popularity, status,
  source_updated_at, synced_at
) VALUES
  (
    '0190a8b0-0000-7000-8000-000000000201',
    'product',
    'Velocity Road Runner',
    'velocity-road-runner',
    'High-performance lightweight road running shoe with responsive foam cushioning and breathable mesh.',
    'https://images.example.com/products/velocity-road-runner.jpg',
    149.99,
    129.99,
    '0190a8b0-0000-7000-8000-000000000101',
    95,
    'active',
    '2026-01-11 12:00:00+00',
    now()
  ),
  (
    '0190a8b0-0000-7000-8000-000000000202',
    'product',
    'Summit Trail Pro',
    'summit-trail-pro',
    'Durable mountain trail running shoe with all-terrain grip rubber lugs and rock plate protection.',
    'https://images.example.com/products/summit-trail-pro.jpg',
    179.99,
    179.99,
    '0190a8b0-0000-7000-8000-000000000102',
    88,
    'active',
    '2026-01-12 09:30:00+00',
    now()
  ),
  (
    '0190a8b0-0000-7000-8000-000000000203',
    'product',
    'Aero Pace Elite',
    'aero-pace-elite',
    'Carbon-plated road racing shoe designed for marathon day with maximum energy return and propulsion.',
    'https://images.example.com/products/aero-pace-elite.jpg',
    219.99,
    199.99,
    '0190a8b0-0000-7000-8000-000000000101',
    70,
    'active',
    '2026-01-12 14:15:00+00',
    now()
  ),
  (
    '0190a8b0-0000-7000-8000-000000000204',
    'product',
    'Mountain Grip Low',
    'mountain-grip-low',
    'Low-profile trail running shoe for technical rock scrambles, muddy paths, and fast mountain ascents.',
    NULL,
    134.50,
    NULL,
    '0190a8b0-0000-7000-8000-000000000102',
    50,
    'active',
    '2026-01-13 08:00:00+00',
    now()
  ),
  (
    '0190a8b0-0000-7000-8000-000000000205',
    'product',
    'Cloud Cushion Sneaker',
    'cloud-cushion-sneaker',
    'Plush daily road running shoe with max cushion comfort for recovery days, daily training, and walking.',
    'https://images.example.com/products/cloud-cushion.jpg',
    120.00,
    120.00,
    '0190a8b0-0000-7000-8000-000000000101',
    60,
    'active',
    '2026-01-13 11:00:00+00',
    now()
  ),
  (
    '0190a8b0-0000-7000-8000-000000000206',
    'product',
    'Retired Classic Trainer',
    'retired-classic-trainer',
    'Vintage road training shoe no longer in active production, archived heritage stock.',
    NULL,
    89.99,
    49.99,
    '0190a8b0-0000-7000-8000-000000000101',
    5,
    'inactive',
    '2026-01-01 00:00:00+00',
    now()
  )
ON CONFLICT (document_type, id) DO UPDATE SET
  title = EXCLUDED.title,
  slug = EXCLUDED.slug,
  content = EXCLUDED.content,
  image_url = EXCLUDED.image_url,
  price = EXCLUDED.price,
  effective_price = EXCLUDED.effective_price,
  category_id = EXCLUDED.category_id,
  popularity = EXCLUDED.popularity,
  status = EXCLUDED.status,
  source_updated_at = EXCLUDED.source_updated_at,
  synced_at = now();

-- Seed blogs (3 total: 2 active, 1 inactive/draft)
INSERT INTO search.search_documents (
  id, document_type, title, slug, content, image_url,
  price, effective_price, category_id, popularity, status,
  source_updated_at, synced_at
) VALUES
  (
    '0190a8b0-0000-7000-8000-000000000301',
    'blog',
    'Top 10 Trail Running Shoes of 2026',
    'top-10-trail-running-shoes-2026',
    'Comprehensive buyer guide and expert gear reviews covering the top 10 trail running shoes across all weather conditions and distances.',
    'https://images.example.com/blogs/blog-trail-2026.jpg',
    NULL,
    NULL,
    NULL,
    82,
    'active',
    '2026-01-14 10:00:00+00',
    now()
  ),
  (
    '0190a8b0-0000-7000-8000-000000000302',
    'blog',
    'How to Choose Your Road Running Shoe',
    'how-to-choose-road-running-shoe',
    'Practical runner advice on gait analysis, pronation, heel-to-toe drop height, and finding the right road running shoe for your training cycle.',
    'https://images.example.com/blogs/blog-road-shoe-guide.jpg',
    NULL,
    NULL,
    NULL,
    65,
    'active',
    '2026-01-14 15:30:00+00',
    now()
  ),
  (
    '0190a8b0-0000-7000-8000-000000000303',
    'blog',
    'Upcoming Winter Releases Preview',
    'upcoming-winter-releases-preview',
    'Draft sneak peek and editorial preview of upcoming winter running shoes featuring waterproof membranes and thermal lining.',
    NULL,
    NULL,
    NULL,
    NULL,
    0,
    'inactive',
    '2026-01-15 09:00:00+00',
    now()
  )
ON CONFLICT (document_type, id) DO UPDATE SET
  title = EXCLUDED.title,
  slug = EXCLUDED.slug,
  content = EXCLUDED.content,
  image_url = EXCLUDED.image_url,
  price = EXCLUDED.price,
  effective_price = EXCLUDED.effective_price,
  category_id = EXCLUDED.category_id,
  popularity = EXCLUDED.popularity,
  status = EXCLUDED.status,
  source_updated_at = EXCLUDED.source_updated_at,
  synced_at = now();

COMMIT;
