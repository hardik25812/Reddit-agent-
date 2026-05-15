import * as fs from 'fs';
import * as path from 'path';
import { Telegraf } from 'telegraf';
import { Draft, ClassifiedPost, Feedback } from './types';

const DATA_DIR = path.resolve(__dirname, '..', 'data');
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

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

export async function sendDraftForReview(draft: Draft): Promise<void> {
  const b = getBot();
  const chatId = getChatId();

  const message = [
    `NEW DRAFT - r/${draft.subreddit}`,
    '',
    `Q: ${truncate(draft.title, 200)}`,
    `URL: ${draft.url}`,
    `Upvotes: ${draft.score} | Comments: ${draft.numComments}`,
    `Topic: ${draft.topic} | Relevance: ${draft.pixiiRelevance}`,
    '',
    'DRAFT:',
    draft.draft,
    '',
    'Reply:',
    `YES_${draft.postId} to post`,
    `NO_${draft.postId} <reason> to reject`,
    `EDIT_${draft.postId} <new text> to override`,
  ].join('\n');

  await b.telegram.sendMessage(chatId, message);
  console.log(`[telegram] Draft sent for review: ${draft.postId}`);
}

export async function sendFlagForReview(classified: ClassifiedPost): Promise<void> {
  const b = getBot();
  const chatId = getChatId();
  const post = classified.post;

  const message = [
    `FLAG FOR REVIEW - r/${post.subreddit}`,
    '',
    `Q: ${truncate(post.title, 200)}`,
    `URL: ${post.permalink}`,
    `Upvotes: ${post.score} | Comments: ${post.num_comments}`,
    `Reason: ${classified.classification.reason}`,
    `Topic: ${classified.classification.topic}`,
    '',
    `Reply DRAFT_${post.id} to generate a draft`,
    `Reply SKIP_${post.id} to skip`,
  ].join('\n');

  await b.telegram.sendMessage(chatId, message);
  console.log(`[telegram] Flag sent for review: ${post.id}`);
}

function saveFeedback(postId: string, draft: string, reason: string): void {
  fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  const feedback: Feedback = {
    postId,
    subreddit: '',
    draft,
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

// Draft store for matching approvals to drafts
const pendingDrafts = new Map<string, Draft>();

export function registerDraft(draft: Draft): void {
  pendingDrafts.set(draft.postId, draft);
}

export function getPendingDraft(postId: string): Draft | undefined {
  return pendingDrafts.get(postId);
}

export function listenForApprovals(
  onApprove: (postId: string, subreddit: string, text: string) => Promise<void>,
  onReject: (postId: string, reason: string) => Promise<void>,
  onEdit: (postId: string, subreddit: string, newText: string) => Promise<void>
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
      const subreddit = draft.subreddit;
      pendingDrafts.delete(postId);
      await onApprove(postId, subreddit, draft.draft);
      appendToLog(`APPROVED | ${postId} | r/${subreddit} | "${draft.title}"`);
      await ctx.reply(`Posted to Reddit (${postId})`);
    } else if (text.startsWith('NO_')) {
      const spaceIdx = text.indexOf(' ', 3);
      let postId: string;
      let reason: string;
      if (spaceIdx === -1) {
        postId = text.substring(3).trim();
        reason = 'no reason given';
      } else {
        postId = text.substring(3, spaceIdx).trim();
        reason = text.substring(spaceIdx + 1).trim();
      }
      const draft = pendingDrafts.get(postId);
      saveFeedback(postId, draft?.draft || '', reason);
      appendToLog(`REJECTED | ${postId} | reason: ${reason}`);
      pendingDrafts.delete(postId);
      await onReject(postId, reason);
      await ctx.reply(`Rejected and logged for learning`);
    } else if (text.startsWith('EDIT_')) {
      const spaceIdx = text.indexOf(' ', 5);
      if (spaceIdx === -1) {
        await ctx.reply('Usage: EDIT_<postId> <new text>');
        return;
      }
      const postId = text.substring(5, spaceIdx).trim();
      const newText = text.substring(spaceIdx + 1).trim();
      const editDraft = pendingDrafts.get(postId);
      const subreddit = editDraft?.subreddit || 'unknown';
      appendToLog(`EDITED | ${postId} | custom text provided`);
      pendingDrafts.delete(postId);
      await onEdit(postId, subreddit, newText);
      await ctx.reply(`Posted with your edit (${postId})`);
    }
  });

  console.log('[telegram] Listening for approval responses...');
  b.launch();

  process.once('SIGINT', () => b.stop('SIGINT'));
  process.once('SIGTERM', () => b.stop('SIGTERM'));
}
