import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { ClassifiedPost, Draft } from './types';

const PROMPTS_DIR = path.resolve(__dirname, '..', 'prompts');
const WIKI_DIR = path.resolve(__dirname, '..', 'wiki');
const EXAMPLES_DIR = path.resolve(__dirname, '..', 'examples');
const DRAFTS_DIR = path.resolve(__dirname, '..', 'data', 'drafts');

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

function findRelevantWikiEntries(topic: string): string[] {
  const index = readFile(path.join(WIKI_DIR, 'index.md'));
  const topicsDir = path.join(WIKI_DIR, 'wiki', 'topics');
  const faqsDir = path.join(WIKI_DIR, 'wiki', 'faqs');
  const entries: string[] = [];

  const topicLower = topic.toLowerCase();

  const topicFiles: Record<string, string[]> = {
    'listing images': ['7-image-stack.md', 'amazon-best-practices.md'],
    'product photography': ['7-image-stack.md', 'product-overview.md'],
    'a+ content': ['a-plus-content.md', 'amazon-best-practices.md'],
    'hero image': ['7-image-stack.md', 'amazon-best-practices.md'],
    'image rejection': ['amazon-best-practices.md', '7-image-stack.md'],
    'listing conversion': ['amazon-best-practices.md', '7-image-stack.md', 'grading-rubric.md'],
    'canva alternatives': ['pricing-comparison.md', 'product-overview.md'],
    'ai image tools': ['product-overview.md', 'pricing-comparison.md'],
    'listing design': ['7-image-stack.md', 'product-overview.md'],
    'listing audit': ['grading-rubric.md', '7-image-stack.md'],
    'rufus optimization': ['rufus-aeo.md', 'amazon-best-practices.md'],
    'image tools': ['product-overview.md', 'pricing-comparison.md'],
    'listing optimization': ['amazon-best-practices.md', '7-image-stack.md', 'grading-rubric.md'],
  };

  const faqFiles: Record<string, string[]> = {
    'listing images': ['best-image-tool.md'],
    'canva': ['canva-vs-pixii.md'],
    'a+ content': ['a-plus-content.md'],
    'image rejection': ['main-image-rejection.md'],
    'conversion': ['conversion-rate.md'],
    'competitor': ['competitor-comparison.md'],
  };

  // Match topic files
  for (const [key, files] of Object.entries(topicFiles)) {
    if (topicLower.includes(key) || key.includes(topicLower)) {
      for (const file of files) {
        const filePath = path.join(topicsDir, file);
        if (fs.existsSync(filePath)) {
          entries.push(readFile(filePath));
        }
      }
      break;
    }
  }

  // Match FAQ files
  for (const [key, files] of Object.entries(faqFiles)) {
    if (topicLower.includes(key) || key.includes(topicLower)) {
      for (const file of files) {
        const filePath = path.join(faqsDir, file);
        if (fs.existsSync(filePath)) {
          entries.push(readFile(filePath));
        }
      }
      break;
    }
  }

  // Fallback: always include product overview and best practices
  if (entries.length === 0) {
    const fallbacks = ['product-overview.md', 'amazon-best-practices.md'];
    for (const file of fallbacks) {
      const filePath = path.join(topicsDir, file);
      if (fs.existsSync(filePath)) {
        entries.push(readFile(filePath));
      }
    }
  }

  return entries;
}

function buildDrafterPrompt(classified: ClassifiedPost, wikiEntries: string[]): string {
  const drafterRules = readFile(path.join(PROMPTS_DIR, 'answer-drafter.md'));
  const voiceRules = readFile(path.join(PROMPTS_DIR, 'voice-rules.md'));
  const goodExamples = readFile(path.join(EXAMPLES_DIR, 'good-answers.md'));
  const post = classified.post;

  return `${drafterRules}

---

${voiceRules}

---

## Good Answer Examples (follow these patterns)

${goodExamples}

---

## Relevant Pixii Wiki Knowledge (ONLY cite facts from here)

${wikiEntries.join('\n\n---\n\n')}

---

## Reddit Post to Reply To

Subreddit: r/${post.subreddit}
Title: ${post.title}
Body: ${post.selftext || '(no body text)'}
Score: ${post.score}
Comments: ${post.num_comments}
Topic (from classifier): ${classified.classification.topic}
Pixii relevance: ${classified.classification.pixii_relevance}

Write a Reddit reply following the rules above. Output ONLY the reply text, no preamble, no explanation. Just the reply as it would appear on Reddit.`;
}

function saveDraft(draft: Draft): void {
  fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  const filename = `${draft.postId}-${Date.now()}.json`;
  fs.writeFileSync(path.join(DRAFTS_DIR, filename), JSON.stringify(draft, null, 2));
}

export async function draftReply(classified: ClassifiedPost): Promise<Draft> {
  const client = new Anthropic();
  const post = classified.post;
  const topic = classified.classification.topic;

  console.log(`[drafter] Drafting reply for: "${post.title}" (topic: ${topic})`);

  const wikiEntries = findRelevantWikiEntries(topic);
  console.log(`[drafter] Loaded ${wikiEntries.length} wiki entries for context`);

  const prompt = buildDrafterPrompt(classified, wikiEntries);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const draftText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const draft: Draft = {
    postId: post.id,
    subreddit: post.subreddit,
    title: post.title,
    url: post.permalink,
    score: post.score,
    numComments: post.num_comments,
    draft: draftText.trim(),
    topic,
    pixiiRelevance: classified.classification.pixii_relevance,
    draftedAt: new Date().toISOString(),
  };

  saveDraft(draft);
  console.log(`[drafter] Draft saved (${draftText.trim().split(/\s+/).length} words)`);

  return draft;
}

export async function draftReplies(classifiedPosts: ClassifiedPost[]): Promise<Draft[]> {
  const answerable = classifiedPosts.filter((c) => c.classification.decision === 'ANSWER');
  console.log(`[drafter] ${answerable.length} posts to draft replies for`);

  const drafts: Draft[] = [];

  for (const classified of answerable) {
    try {
      const draft = await draftReply(classified);
      drafts.push(draft);
    } catch (err) {
      console.error(`[drafter] Error drafting for post ${classified.post.id}:`, err);
    }
  }

  return drafts;
}
