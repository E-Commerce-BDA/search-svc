export interface SuggestRow {
  id: string;
  document_type: 'product' | 'category' | 'blog';
  title: string;
  slug: string;
  image_url: string | null;
  price: string | null;
  effective_price: string | null;
  popularity: number;
}
