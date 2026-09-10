# Project skills

Claude Code loads the skills in this folder automatically in any session opened inside this repository. They apply here only, not to other projects on the machine.

| Skill | What it makes Claude do |
|---|---|
| `verification-before-completion` | Run the check and show the output before saying anything is done, fixed or passing. Evidence before claims. |
| `systematic-debugging` | Find the root cause of a bug before proposing a fix, and stop to rethink after three failed fixes. |

Both exist because this project is built by someone who does not read code, so "it's done" has to come with proof.

## Where they came from

Adapted from [obra/superpowers](https://github.com/obra/superpowers) by Jesse Vincent, MIT licensed (see `LICENSE` in this folder), at commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`.

Only these two skills were taken. The rest of Superpowers, including its always-on session hook, mandatory test-first rule, plan documents, subagents and git worktrees, was deliberately not installed.

## What was changed from the original

- `systematic-debugging/SKILL.md`: two references to other Superpowers skills were rewritten, because those skills are not installed here.
- `systematic-debugging/condition-based-waiting.md`: the pointer to the TypeScript example file now explains why the file is missing.
- Left out of `systematic-debugging`: `condition-based-waiting-example.ts` (this repo's `tsconfig.json` type-checks every `.ts` file, so it could break the build), plus `CREATION-LOG.md` and four `test-*.md` files, which are the author's tests of the skill rather than instructions for Claude.

## If you add or update a skill here

Keep the frontmatter `name` matching the folder name. Do not add `.ts` or `.tsx` files anywhere under `.claude/` for the reason above.
