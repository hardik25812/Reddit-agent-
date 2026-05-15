# Pixii Reddit Marketing Agent

Monitors Amazon seller subreddits for questions Pixii can help with, drafts helpful Reddit replies that naturally mention Pixii, sends them to Telegram for human approval, and posts approved replies to Reddit.

## Architecture

```
Scout (Reddit JSON) -> Classifier (Claude) -> Drafter (Claude + Wiki) -> Telegram Review -> Poster (snoowrap)
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in:
- `ANTHROPIC_API_KEY` - from console.anthropic.com
- `TELEGRAM_BOT_TOKEN` - from @BotFather on Telegram
- `TELEGRAM_CHAT_ID` - your Telegram chat ID
- `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` - from reddit.com/prefs/apps (script type)
- `REDDIT_USERNAME` / `REDDIT_PASSWORD` - the Reddit account that will post

### 3. Reddit API setup

1. Go to https://www.reddit.com/prefs/apps
2. Click "create another app"
3. Choose "script" type
4. Set redirect URI to `http://localhost:8080`
5. Copy the client ID (under app name) and secret

## Usage

### Run full pipeline once (scout + classify + draft + send to Telegram)

```bash
npm run pipeline
```

### Scout only (check for new posts, no drafting)

```bash
npm run scout
```

### Start Telegram listener (wait for approvals and post)

```bash
npm run listen
```

### Development mode (pipeline + listener)

```bash
npm run dev
```

## File Structure

```
pixii-reddit-agent/
├── wiki/                    # Knowledge base (source of truth)
│   ├── CLAUDE.md            # Schema for navigating the wiki
│   ├── index.md             # Master catalog
│   ├── log.md               # Append-only activity log
│   ├── raw/                 # 11 source documents
│   └── wiki/                # Synthesized entries
│       ├── topics/          # Topic summaries
│       ├── faqs/            # Common Q&A
│       └── personas/        # Customer archetypes
├── prompts/                 # LLM prompts
│   ├── question-classifier.md
│   ├── answer-drafter.md
│   └── voice-rules.md
├── examples/                # Few-shot examples
│   ├── good-answers.md
│   └── bad-answers.md
├── src/                     # Execution code
│   ├── types.ts             # Shared types and constants
│   ├── scout.ts             # Reddit scraper (public JSON)
│   ├── classifier.ts        # Claude-powered classification
│   ├── drafter.ts           # Claude-powered reply drafting
│   ├── telegram-review.ts   # Human-in-loop via Telegram
│   ├── poster.ts            # Reddit posting via snoowrap
│   └── orchestrator.ts      # Main entry point
├── data/                    # Runtime data
│   ├── seen-posts.json      # Already-processed post IDs
│   ├── drafts/              # Pending drafts
│   ├── posted/              # Posted reply log
│   └── feedback/            # Rejected drafts + reasons
```

## Kill Rules

1. Never post more than 1 reply per subreddit per day
2. Never post within 30 minutes of another comment
3. Never auto-post - always human-in-loop via Telegram
4. Never link to pixii.ai in comments - mention by name only
5. If a mod removes a post, blacklist that subreddit for 30 days

## Target Subreddits

- r/FulfillmentByAmazon
- r/AmazonFBA
- r/AmazonSeller
- r/ecommerce
- r/EntrepreneurRideAlong

## Telegram Commands

When a draft arrives on Telegram:
- `YES_<postId>` - approve and post to Reddit
- `NO_<postId> <reason>` - reject and log feedback
- `EDIT_<postId> <new text>` - post with your custom text
