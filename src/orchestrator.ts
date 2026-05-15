import * as dotenv from 'dotenv';
dotenv.config();

import { scout } from './scout';
import { classifyPosts } from './classifier';
import { draftReply, draftReplies } from './drafter';
import {
  sendDraftForReview,
  sendFlagForReview,
  registerDraft,
  listenForCommands,
} from './telegram-review';
import { ClassifiedPost, Draft } from './types';

async function runPipeline(): Promise<void> {
  console.log('\n========================================');
  console.log(`[pipeline] Starting at ${new Date().toISOString()}`);
  console.log('========================================\n');

  // Step 1: Scout
  console.log('[pipeline] Step 1 - Scouting subreddits...');
  const posts = await scout();
  if (posts.length === 0) {
    console.log('[pipeline] No new posts found. Done.');
    return;
  }
  console.log(`[pipeline] Found ${posts.length} new posts\n`);

  // Step 2: Classify
  console.log('[pipeline] Step 2 - Classifying posts...');
  const classified = await classifyPosts(posts);

  const answers = classified.filter((c) => c.classification.decision === 'ANSWER');
  const flags = classified.filter((c) => c.classification.decision === 'FLAG_FOR_REVIEW');
  const skips = classified.filter((c) => c.classification.decision === 'SKIP');

  console.log(`[pipeline] Classification results:`);
  console.log(`  ANSWER: ${answers.length}`);
  console.log(`  FLAG_FOR_REVIEW: ${flags.length}`);
  console.log(`  SKIP: ${skips.length}\n`);

  // Step 3: Send flags to Telegram
  for (const flagged of flags) {
    try {
      await sendFlagForReview(flagged);
    } catch (err) {
      console.error(`[pipeline] Error sending flag for ${flagged.post.id}:`, err);
    }
  }

  // Step 4: Draft replies for ANSWER posts
  if (answers.length === 0) {
    console.log('[pipeline] No posts to draft. Done.');
    return;
  }

  console.log('[pipeline] Step 3 - Drafting replies...');
  const drafts = await draftReplies(classified);
  console.log(`[pipeline] Generated ${drafts.length} drafts\n`);

  // Step 5: Send drafts to Telegram for review
  console.log('[pipeline] Step 4 - Sending drafts to Telegram...');
  for (const draft of drafts) {
    try {
      registerDraft(draft);
      await sendDraftForReview(draft);
    } catch (err) {
      console.error(`[pipeline] Error sending draft for ${draft.postId}:`, err);
    }
  }

  console.log(`[pipeline] Pipeline complete. ${drafts.length} drafts sent for review.\n`);
}

function startListener(): void {
  console.log('[listener] Starting Telegram listener...');

  listenForCommands(
    // onRedo: regenerate draft with different angle
    async (_postId: string, oldDraft: Draft) => {
      console.log(`[listener] REDO requested for: ${oldDraft.title}`);
      try {
        const classified: ClassifiedPost = {
          post: {
            id: oldDraft.postId,
            title: oldDraft.title,
            selftext: '',
            url: `https://www.reddit.com${oldDraft.url}`,
            subreddit: oldDraft.subreddit,
            score: oldDraft.score,
            num_comments: oldDraft.numComments,
            author: 'unknown',
            created_utc: Date.now() / 1000,
            permalink: oldDraft.url,
          },
          classification: {
            decision: 'ANSWER',
            reason: 'REDO requested by reviewer',
            topic: oldDraft.topic,
            pixii_relevance: oldDraft.pixiiRelevance,
          },
          classifiedAt: new Date().toISOString(),
        };

        const newDraft = await draftReply(classified, true);
        registerDraft(newDraft);
        await sendDraftForReview(newDraft);
        console.log(`[listener] New draft sent for: ${oldDraft.postId}`);
      } catch (err) {
        console.error(`[listener] REDO failed for ${oldDraft.postId}:`, err);
      }
    }
  );
}

async function main(): Promise<void> {
  const mode = process.argv[2] || 'dev';

  switch (mode) {
    case 'scout':
      await runPipeline();
      process.exit(0);
      break;

    case 'pipeline':
      await runPipeline();
      process.exit(0);
      break;

    case 'listen':
      startListener();
      break;

    case 'dev':
      await runPipeline();
      startListener();
      break;

    case 'start': {
      const PIPELINE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
      console.log('[start] Starting Telegram listener...');
      startListener();
      console.log('[start] Running initial pipeline...');
      await runPipeline();
      console.log(`[start] Pipeline will run again every 4 hours`);
      setInterval(async () => {
        console.log(`[start] Scheduled pipeline run at ${new Date().toISOString()}`);
        await runPipeline().catch((err) =>
          console.error('[start] Pipeline error:', err)
        );
      }, PIPELINE_INTERVAL_MS);
      break;
    }

    default:
      console.log('Usage: npx ts-node src/orchestrator.ts [scout|pipeline|listen|dev|start]');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('[main] Fatal error:', err);
  process.exit(1);
});

export { runPipeline, startListener };
