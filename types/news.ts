// Per-language copy as stored on the server (one JSONB column per language).
export interface NewsCopy {
  title: string;
  sum: string;
  body: string; // rich HTML for the in-app HTML viewer
}

// Raw row shape returned by the server's public news endpoints.
export interface NewsRow {
  id: string;
  slug: string;
  category: string;
  coverUrl: string | null;
  pinned: boolean;
  ctaLabel: string | null;
  ctaHref: string | null;
  contentEng: NewsCopy | null;
  contentFr: NewsCopy | null;
  contentAr: NewsCopy | null;
  views: number;
  publishedAt: string | null;
  createdAt: string | null;
}

// Normalized, language-resolved article the UI consumes.
export interface NewsArticle {
  id: string;
  slug: string;
  category: string;
  imageUrl?: string;
  title: string;
  summary: string;
  body: string; // HTML
  ctaLabel?: string;
  ctaHref?: string;
  pinned: boolean;
  views: number;
  publishedAt: string;
}

export interface NewsPagination {
  page: number;
  limit: number;
  total: number;
}
