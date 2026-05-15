import * as fs from 'fs';
import * as path from 'path';
import Snoowrap from 'snoowrap';
import { PostedReply, RateLimitState, RATE_LIMIT_MS, SUBREDDIT_COOLDOWN_MS } from './types';

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const POSTED_DIR = path.join(DATA_DIR, 'posted');
const RATE_LIMIT_PATH = path.join(DATA_DIR, 'rate-limit.json');
const POSTED_LOG_PATH = path.join(POSTED_DIR, 'log.jsonl');

function getRedditClient(): Snoowrap {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;

  if (!clientId || !clientSecret || !username || !password) {
    throw new Error('Missing Reddit API credentials in environment variables');
  }

  return new Snoowrap({
    userAgent: 'PixiiCommunityAgent/1.0',
    clientId,
    clientSecret,
    username,
    password,
  });
}

function loadRateLimitState(): RateLimitState {
  if (!fs.existsSync(RATE_LIMIT_PATH)) {
    return { lastPostTimestamp: 0, subredditLastPost: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(RATE_LIMIT_PATH, 'utf-8'));
  } catch {
    return { lastPostTimestamp: 0, subredditLastPost: {} };
  }
}

function saveRateLimitState(state: RateLimitState): void {
  fs.mkdirSync(path.dirname(RATE_LIMIT_PATH), { recursive: true });
  fs.writeFileSync(RATE_LIMIT_PATH, JSON.stringify(state, null, 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function enforceRateLimit(subreddit: string): Promise<void> {
  const state = loadRateLimitState();
  const now = Date.now();

  // Global rate limit: 30 minutes between any posts
  const globalElapsed = now - state.lastPostTimestamp;
  if (globalElapsed < RATE_LIMIT_MS) {
    const waitMs = RATE_LIMIT_MS - globalElapsed;
    console.log(`[poster] Global rate limit: waiting ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
  }

  // Per-subreddit rate limit: 1 post per subreddit per day
  const subLastPost = state.subredditLastPost[subreddit] || 0;
  const subElapsed = now - subLastPost;
  if (subElapsed < SUBREDDIT_COOLDOWN_MS) {
    const waitMs = SUBREDDIT_COOLDOWN_MS - subElapsed;
    const waitHrs = Math.round(waitMs / 3600000);
    throw new Error(
      `[poster] Subreddit cooldown: already posted to r/${subreddit} today. Wait ~${waitHrs}hrs.`
    );
  }
}

function logPost(reply: PostedReply): void {
  fs.mkdirSync(POSTED_DIR, { recursive: true });
  fs.appendFileSync(POSTED_LOG_PATH, JSON.stringify(reply) + '\n');
}

function updateRateLimitState(subreddit: string): void {
  const state = loadRateLimitState();
  const now = Date.now();
  state.lastPostTimestamp = now;
  state.subredditLastPost[subreddit] = now;
  saveRateLimitState(state);
}

export async function postReply(
  parentPostId: string,
  subreddit: string,
  text: string
): Promise<string> {
  await enforceRateLimit(subreddit);

  const reddit = getRedditClient();

  console.log(`[poster] Posting reply to ${parentPostId} in r/${subreddit}...`);

  try {
    const submission = reddit.getSubmission(parentPostId) as any;
    const comment = await submission.reply(text);

    const reply: PostedReply = {
      postId: parentPostId,
      commentId: (comment as any).id || 'unknown',
      subreddit,
      text,
      postedAt: new Date().toISOString(),
    };

    logPost(reply);
    updateRateLimitState(subreddit);

    console.log(`[poster] Successfully posted comment ${reply.commentId}`);
    return reply.commentId;
  } catch (err) {
    console.error(`[poster] Failed to post reply:`, err);
    throw err;
  }
}
