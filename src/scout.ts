import * as fs from 'fs';
import * as path from 'path';
import {
  RedditPost,
  TARGET_SUBREDDITS,
  MAX_POST_AGE_HOURS,
  MIN_POST_SCORE,
  SCOUT_DELAY_MS,
} from './types';

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const SEEN_PATH = path.join(DATA_DIR, 'seen-posts.json');

function loadSeen(): Set<string> {
  if (!fs.existsSync(SEEN_PATH)) return new Set();
  try {
    const raw = fs.readFileSync(SEEN_PATH, 'utf-8');
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>): void {
  fs.mkdirSync(path.dirname(SEEN_PATH), { recursive: true });
  fs.writeFileSync(SEEN_PATH, JSON.stringify([...seen], null, 2));
}

async function fetchSubreddit(sub: string): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${sub}/new.json?limit=25`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PixiiCommunityAgent/1.0 (helpful Amazon seller content)',
      },
    });

    if (!response.ok) {
      console.error(`[scout] Failed to fetch r/${sub}: HTTP ${response.status}`);
      return [];
    }

    const data = await response.json() as any;
    return data.data.children.map((c: any) => ({
      id: c.data.id,
      title: c.data.title,
      selftext: c.data.selftext || '',
      url: c.data.url,
      subreddit: c.data.subreddit,
      score: c.data.score,
      num_comments: c.data.num_comments,
      author: c.data.author,
      created_utc: c.data.created_utc,
      permalink: `https://www.reddit.com${c.data.permalink}`,
    }));
  } catch (err) {
    console.error(`[scout] Error fetching r/${sub}:`, err);
    return [];
  }
}

function isPostFresh(post: RedditPost): boolean {
  const ageHours = (Date.now() / 1000 - post.created_utc) / 3600;
  return ageHours <= MAX_POST_AGE_HOURS;
}

function isPostViable(post: RedditPost): boolean {
  if (!isPostFresh(post)) return false;
  if (post.score < MIN_POST_SCORE) return false;
  if (post.author === '[deleted]' || post.author === 'AutoModerator') return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function scout(): Promise<RedditPost[]> {
  console.log('[scout] Starting scan of target subreddits...');
  const seen = loadSeen();
  const newPosts: RedditPost[] = [];

  for (const sub of TARGET_SUBREDDITS) {
    console.log(`[scout] Fetching r/${sub}...`);
    const posts = await fetchSubreddit(sub);
    let subNew = 0;

    for (const post of posts) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);

      if (!isPostViable(post)) continue;

      newPosts.push(post);
      subNew++;
    }

    console.log(`[scout] r/${sub}: ${posts.length} fetched, ${subNew} new viable posts`);
    await sleep(SCOUT_DELAY_MS);
  }

  saveSeen(seen);
  console.log(`[scout] Total new viable posts: ${newPosts.length}`);
  return newPosts;
}

if (require.main === module) {
  scout()
    .then((posts) => {
      console.log(`\n[scout] Found ${posts.length} posts to classify:`);
      for (const p of posts) {
        console.log(`  - [r/${p.subreddit}] ${p.title} (${p.score} pts, ${p.num_comments} comments)`);
      }
    })
    .catch(console.error);
}
