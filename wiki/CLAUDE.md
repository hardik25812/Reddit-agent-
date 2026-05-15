# Pixii Knowledge Wiki — Schema

This wiki is the source of truth for the Pixii Reddit Marketing Agent.
When drafting a reply, the agent reads from this wiki and never invents
facts.

## Structure

- `raw/` — Source documents in their original form. Never edit these.
- `wiki/topics/` — LLM-organized topical entries derived from raw sources
- `wiki/faqs/` — Common Amazon seller questions with grounded answers
- `wiki/personas/` — Customer archetypes Pixii serves
- `index.md` — Master catalog. Always read this first.
- `log.md` — Append-only log of every agent action

## How to navigate

1. Start at `index.md` to find relevant topics
2. Read the topic entry for synthesized knowledge
3. If more depth needed, follow the link to the raw source
4. Cite the source ID (e.g. "see raw/03-pixii-rubric-listing-grader")
   in your reasoning trace

## How to grow the wiki

When Hardik approves or rejects a draft, append the lesson to
`wiki/log.md`. Periodically run the wiki-rebuild skill to incorporate
those lessons into the topic entries.

## Updating raw sources

When Pixii ships new features or Monte publishes a new blog post, drop
the markdown into `raw/` with the next numerical prefix. Run wiki-rebuild
to integrate.
