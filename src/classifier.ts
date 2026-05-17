import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { RedditPost, Classification, ClassifiedPost } from './types';

const PROMPTS_DIR = path.resolve(__dirname, '..', 'prompts');
const WIKI_DIR = path.resolve(__dirname, '..', 'wiki');

function readPrompt(filename: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf-8');
}

function readWikiIndex(): string {
  return fs.readFileSync(path.join(WIKI_DIR, 'index.md'), 'utf-8');
}

function buildClassifierPrompt(post: RedditPost): string {
  const classifierRules = readPrompt('question-classifier.md');
  const wikiIndex = readWikiIndex();

  return `${classifierRules}

## Wiki Index (for topic matching)

${wikiIndex}

## Reddit Post to Classify

Subreddit: r/${post.subreddit}
Title: ${post.title}
Body: ${post.selftext || '(no body text)'}
Score: ${post.score}
Comments: ${post.num_comments}
Author: ${post.author}
Age (hours): ${((Date.now() / 1000 - post.created_utc) / 3600).toFixed(1)}
URL: ${post.permalink}

Classify this post. Return ONLY the JSON object as specified in the output format above.`;
}

function parseClassification(raw: string): Classification {
  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse classification JSON from response: ${raw.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);

  const decision = parsed.decision;
  if (!['ANSWER', 'SKIP', 'FLAG_FOR_REVIEW'].includes(decision)) {
    throw new Error(`Invalid decision: ${decision}`);
  }

  return {
    decision: decision as Classification['decision'],
    reason: String(parsed.reason || ''),
    topic: String(parsed.topic || ''),
    pixii_relevance: Math.min(1, Math.max(0, Number(parsed.pixii_relevance) || 0)),
  };
}

export async function classifyPost(post: RedditPost): Promise<ClassifiedPost> {
  const client = new Anthropic();
  const prompt = buildClassifierPrompt(post);

  console.log(`[classifier] Classifying: "${post.title}" (r/${post.subreddit})`);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const classification = parseClassification(text);

  console.log(
    `[classifier] Result: ${classification.decision} | ${classification.reason} | relevance: ${classification.pixii_relevance}`
  );

  return {
    post,
    classification,
    classifiedAt: new Date().toISOString(),
  };
}

export async function classifyPosts(posts: RedditPost[]): Promise<ClassifiedPost[]> {
  const results: ClassifiedPost[] = [];

  for (const post of posts) {
    try {
      const classified = await classifyPost(post);
      results.push(classified);
    } catch (err) {
      console.error(`[classifier] Error classifying post ${post.id}:`, err);
      results.push({
        post,
        classification: {
          decision: 'SKIP',
          reason: `Classification error: ${err instanceof Error ? err.message : String(err)}`,
          topic: 'error',
          pixii_relevance: 0,
        },
        classifiedAt: new Date().toISOString(),
      });
    }
  }

  return results;
}
