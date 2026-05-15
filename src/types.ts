export interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  url: string;
  subreddit: string;
  score: number;
  num_comments: number;
  author: string;
  created_utc: number;
  permalink: string;
  author_created_utc?: number;
  author_comment_karma?: number;
  author_link_karma?: number;
}

export interface Classification {
  decision: 'ANSWER' | 'SKIP' | 'FLAG_FOR_REVIEW';
  reason: string;
  topic: string;
  pixii_relevance: number;
}

export interface ClassifiedPost {
  post: RedditPost;
  classification: Classification;
  classifiedAt: string;
}

export interface Draft {
  postId: string;
  subreddit: string;
  title: string;
  url: string;
  score: number;
  numComments: number;
  draft: string;
  topic: string;
  pixiiRelevance: number;
  draftedAt: string;
}

export interface Feedback {
  postId: string;
  subreddit: string;
  draft: string;
  reason: string;
  rejectedAt: string;
}

export const TARGET_SUBREDDITS = [
  'FulfillmentByAmazon',
  'AmazonFBA',
  'AmazonSeller',
  'ecommerce',
  'EntrepreneurRideAlong',
] as const;

export const SKIP_TOPICS = [
  'account suspension',
  'PPC',
  'advertising',
  'inventory',
  'shipping',
  'taxes',
  'accounting',
  'returns',
  'refunds',
  'intellectual property',
  'sourcing',
  'suppliers',
] as const;

export const MAX_POST_AGE_HOURS = 48;
export const MIN_POST_SCORE = 0;
export const MIN_AUTHOR_KARMA = 50;
export const MIN_AUTHOR_AGE_DAYS = 7;
export const SCOUT_DELAY_MS = 2000; // 2s between subreddit fetches
