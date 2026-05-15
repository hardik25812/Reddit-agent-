import * as fs from 'fs';
import * as path from 'path';
import { Telegraf } from 'telegraf';
import { Draft, ClassifiedPost, Feedback } from './types';

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DRAFTS_DIR = path.join(DATA_DIR, 'drafts');
const POSTED_DIR = path.join(DATA_DIR, 'posted');
const FEEDBACK_DIR = path.join(DATA_DIR, 'feedback');
const WIKI_DIR = path.resolve(__dirname, '..', 'wiki');

let bot: Telegraf | null = null;

function getBot(): Telegraf {
  if (!bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
    bot = new Telegraf(token);
  }
  return bot;
}

function getChatId(): string {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID not set');
  return chatId;
}

export async function sendDraftForReview(draft: Draft): Promise<void> {
  const b = getBot();
  const chatId = getChatId();

  const separator = '\u2501'.repeat(20);

  const message = [
    '\uD83D\uDD35 NEW DRAFT',
    '',
    `Subreddit: r/${draft.subreddit}`,
    `Question: ${draft.title}`,
    `Upvotes: ${draft.score} | Comments: ${draft.numComments}`,
    '',
    `\uD83D\uDC49 POST HERE: https://www.reddit.com${draft.url}`,
    '',
    'REPLY TO POST WITH THIS:',
    separator,
    draft.draft,
    separator,
    '',
    `Reply YES_${draft.postId} to mark as posted`,
    `Reply SKIP_${draft.postId} to ignore`,
    `Reply REDO_${draft.postId} to regenerate with different angle`,
  ].join('\n');

  await b.telegram.sendMessage(chatId, message);
  console.log(`[telegram] Draft sent for review: ${draft.postId}`);
}

export async function sendFlagForReview(classified: ClassifiedPost): Promise<void> {
  const b = getBot();
  const chatId = getChatId();
  const post = classified.post;

  const message = [
    '\uD83D\uDFE1 FLAG FOR REVIEW',
    '',
    `Subreddit: r/${post.subreddit}`,
    `Question: ${post.title}`,
    `Upvotes: ${post.score} | Comments: ${post.num_comments}`,
    `Reason: ${classified.classification.reason}`,
    '',
    `\uD83D\uDC49 VIEW: https://www.reddit.com${post.permalink}`,
    '',
    `Reply DRAFT_${post.id} to generate a draft`,
    `Reply SKIP_${post.id} to skip`,
  ].join('\n');

  await b.telegram.sendMessage(chatId, message);
  console.log(`[telegram] Flag sent for review: ${post.id}`);
}

function moveDraftToPosted(postId: string, draft: Draft): void {
  fs.mkdirSync(POSTED_DIR, { recursive: true });
  const postedData = { ...draft, postedAt: new Date().toISOString() };
  const filename = `${postId}-${Date.now()}.json`;
  fs.writeFileSync(path.join(POSTED_DIR, filename), JSON.stringify(postedData, null, 2));
  deleteDraftFiles(postId);
}

function deleteDraftFiles(postId: string): void {
  if (!fs.existsSync(DRAFTS_DIR)) return;
  const files = fs.readdirSync(DRAFTS_DIR).filter(f => f.startsWith(postId));
  for (const file of files) {
    fs.unlinkSync(path.join(DRAFTS_DIR, file));
  }
}

function saveFeedback(postId: string, draftText: string, reason: string, subreddit: string): void {
  fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  const feedback: Feedback = {
    postId,
    subreddit,
    draft: draftText,
    reason,
    rejectedAt: new Date().toISOString(),
  };
  const filename = `${postId}-${Date.now()}.json`;
  fs.writeFileSync(path.join(FEEDBACK_DIR, filename), JSON.stringify(feedback, null, 2));
}

function appendToLog(entry: string): void {
  const logPath = path.join(WIKI_DIR, 'log.md');
  const line = `${new Date().toISOString()} | ${entry}\n`;
  fs.appendFileSync(logPath, line);
}

const pendingDrafts = new Map<string, Draft>();

export function registerDraft(draft: Draft): void {
  pendingDrafts.set(draft.postId, draft);
}

export function getPendingDraft(postId: string): Draft | undefined {
  return pendingDrafts.get(postId);
}

export function listenForCommands(
  onRedo: (postId: string, classified: any) => Promise<void>
): void {
  const b = getBot();

  b.on('text', async (ctx) => {
    const text = ctx.message.text.trim();

    if (text.startsWith('YES_')) {
      const postId = text.substring(4).trim();
      const draft = pendingDrafts.get(postId);
      if (!draft) {
        await ctx.reply(`No pending draft found for ${postId}`);
        return;
      }
      moveDraftToPosted(postId, draft);
      appendToLog(`POSTED | ${postId} | r/${draft.subreddit} | "${draft.title}"`);
      pendingDrafts.delete(postId);
      await ctx.reply('\u2705 Logged as posted. Nice work.');

    } else if (text.startsWith('SKIP_')) {
      const postId = text.substring(5).trim();
      const draft = pendingDrafts.get(postId);
      if (draft) {
        saveFeedback(postId, draft.draft, 'skipped', draft.subreddit);
        appendToLog(`SKIPPED | ${postId} | r/${draft.subreddit}`);
      }
      deleteDraftFiles(postId);
      pendingDrafts.delete(postId);
      await ctx.reply('\u23ED Skipped.');

    } else if (text.startsWith('REDO_')) {
      const postId = text.substring(5).trim();
      const draft = pendingDrafts.get(postId);
      if (!draft) {
        await ctx.reply(`No pending draft found for ${postId}`);
        return;
      }
      saveFeedback(postId, draft.draft, 'redo requested', draft.subreddit);
      appendToLog(`REDO | ${postId} | r/${draft.subreddit}`);
      deleteDraftFiles(postId);
      pendingDrafts.delete(postId);
      await ctx.reply('\uD83D\uDD04 Regenerating with a different angle...');
      await onRedo(postId, draft);
    }
  });

  console.log('[telegram] Listening for YES/SKIP/REDO commands...');
  b.launch();

  process.once('SIGINT', () => b.stop('SIGINT'));
  process.once('SIGTERM', () => b.stop('SIGTERM'));
}
