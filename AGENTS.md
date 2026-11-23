# AGENTS.md - LLM Development Guide

Shared personal defaults (Node.js/TypeScript, pnpm, Vue, code reuse and style) live in `~/git/personal/config/global/AGENTS.md`, loaded globally by Codex and Claude Code on this workstation. Read that file when working elsewhere without the global setup. Keep project-specific rules below.

## Project Overview

**Laundry Plugs** shows whether the washers and dryers at [fools' valley](https://foolsvalley.com/) are free. Each machine sits on a Shelly smart plug that pushes its switch status (power draw, voltage, energy counter) to the API about once a minute. The public page derives each machine's state from recent power readings.

Keep it small: one database, one API, one frontend. There is no admin panel, no beta/production split, no user accounts, no tRPC and no background workers. Do not add them unless asked.

```
laundry-plugs/
├── database/   # Drizzle ORM schema, migrations and migrator image
├── api/        # Hono API: readings ingestion (token auth) and public plug statuses
├── frontend/   # Vue 3 + Quasar SPA served by nginx
└── shelly/     # Script pasted into each plug's web UI
```

## Domain Rules

- **Plugs create themselves.** `POST /plugs/:identifier/readings` upserts the plug by identifier and inserts the reading in one transaction. Identifiers are lowercase words joined by dashes (`old-house-washer-1`); the frontend displays them with spaces. Washer identifiers with the former spelling remain accepted and resolve to the existing plug.
- **Readings use the Shelly `Switch.GetStatus` shape** (`apower`, `voltage`, `current`, `output`, `aenergy.total`, `temperature.tC`). Store the known fields in columns and the whole status in `payload`.
- **Access tokens are created by hand in the database** (see README) and stored only as SHA-256 hex in `auth.access_token.token_hash`. Never store or log plain tokens. Revoke with `revoked_at`. Requests send `Authorization: Bearer <token>`; failures are a bare 401.
- **Reading plug statuses is public.** Only ingestion requires a token.
- **Plugs send Telegram announcements directly.** Each standalone script in `shelly/` checks power every second and sends human-readable cycle updates as @FoolsLaundryBot to the configured topic. It defaults to "Laundry" in the private "Fools Laundry Test" group. Both destinations are listed in the README. Keep real bot tokens out of the repository. The plug also sends its full switch status and Telegram message reference to the API every minute. The API edits that message to Unavailable after five minutes without a reading. Keep shared behavior aligned across the six scripts. Do not invite the bot anywhere or post to a group without being asked.
- **Statuses are derived, not stored.** `api/submodules/plugs/plug-status.ts` owns the thresholds: 5 W or more is active, 3 minutes without activity makes the machine available, cycles shorter than 3 minutes are ignored, the website can show the last cycle for 2 hours after a cycle, and `offline` after 5 minutes without a reading. Keep player-facing copy in `PlugList.vue` in sync when changing them.
- **The API returns ISO 8601 timestamps** to the frontend; Postgres string timestamps are not portable across browsers.
- **Frontend types come from the API** through the Hono RPC client (`hc<AppType>`) in `frontend/src/submodules/api/api-client.ts`. Never redefine response types by hand; chain routes so `AppType` stays inferred.

## Design and Copy

Follow foolsvalley.com: warm off-white paper (`$paper`), near-black ink, moss green and rust accents, 1px ink hairlines, square corners, no shadows. Space Mono for body text and EB Garamond for display headings (self-hosted through `@fontsource`). Copy is all lowercase, short, a little poetic but always factual, with `✦` bullets and numbered section labels (`001 / machines`). Never invent facts about fools' valley; link to the main site instead.

- Palette and fonts live in `frontend/src/css/quasar.variables.scss`; global styles in `frontend/src/css/app.scss`. Never hardcode colors elsewhere; derive tints with `mix()`.
- Source artwork lives in `branding/` (`logo.png` is current; `logo-without-basket.png` is the earlier version). `frontend/public/logo.png` is a 256 px render of `branding/logo.png` on `$paper`, and @FoolsLaundryBot's profile picture is a 640 px render with padding. Regenerate both when the logo changes; keep nothing but source files in `branding/`.
- Always use `<style lang="scss" scoped>` and the `gap-*` helpers instead of Quasar gutter classes.
- Use `BaseDate` for every time display (relative by default, `mode="time"` for clock times), `BasePower` for watts and `BaseEnergy` for watt-hours.
- Tooltips are immediate: no delay and no transition.
- No `$q.notify`; let the page reflect state. No hover `translateY` effects.
- After visual changes, save before/after screenshots in `screenshots/<date>-<change-slug>/` (gitignored) with `-before.png`/`-after.png` at the end of the filename, and show them in the final message.

## Essential Commands

```bash
pnpm install
pnpm run check-everything          # oxfmt + tsgo + vue-tsc + oxlint
pnpm run check-everything-slow     # also runs eslint on .vue files
pnpm -C database exec drizzle-kit generate --name 'migration-name'
```

- Use `pnpm` directly. If it is missing, load `~/.nvm/nvm.sh`; if still missing, stop and report it instead of installing another package manager.
- Dev ports: API `3041`, frontend `9082` (proxies `/api` to the API like Caddy does in production). Do not leave dev servers running; stop any you start.
- Logging uses `loglevel` (`LOG_LEVEL=trace|debug|info|warn|error|silent`; default `debug` in development, `warn` in production). Never use `console.log`.

## Deployment

Served at `https://fools.alexdaniel.org/`. The plugs are Shelly Plug M Gen3 (scripts call the `HTTP.Request` RPC; requests are limited to 8 KB and 15 headers). Docker Swarm on `postmodern.alexdaniel.org` behind Caddy Docker Proxy on the external `caddy` overlay, images in the `postmodern.alexdaniel.org` registry, all wired in `.github/workflows/workflow.yaml`. Frontend serves `/`, the API serves `/api/` (prefix stripped). Every push to `main` deploys; there is no separate release environment. Do not deploy, push images or change DNS unless asked.

## Git

- **Never commit, stage or run other mutating git commands unless explicitly asked.** Mention when work is ready for review.
- **Always GPG-sign authorized commits as the user** with `git commit -S` (and `git merge -S`), then `git verify-commit HEAD`. Never override the identity or disable signing; if signing fails, stop and report.
- Work may happen in parallel. Do not revert or "fix" changes you did not make.

### Updating Dependencies

Renovate prepares updates on `renovate/project` and only opens PRs from the Dependency Dashboard (`prCreation: "approval"`, `dependencyDashboardApproval: false`). When asked to "update dependencies", that request permits these git commands:

1. `git pull`
2. `git merge origin/renovate/project` (with `--autostash` if needed)
3. `pnpm install`, then `pnpm run check-everything`
4. Build every Docker image locally the way CI does (never push)
5. Leave any fixes uncommitted; do not amend, commit or push.

When upgrading a dependency, remove pins in `.github/renovate.json` that the upgrade makes obsolete.

## Database Rules

- **Schema first.** Edit `database/src/schema/`, then run `drizzle-kit generate`. Relations live only in `database/src/relations.ts` via `defineRelations()` (Drizzle RQBv2).
- **🚨 Never edit generated migrations** in `database/drizzle/`. If one is wrong, fix the schema and regenerate. The only exception is a data change Drizzle cannot generate; then put `-- ⚠️🚨⚠️ HAND-EDITED MIGRATION: <what and why> ⚠️🚨⚠️` at the top and end your final message with a huge warning banner naming the file.
- **Never run migrations, backfills or hand DDL unless explicitly asked**, and never list running migrations as a plan step. Never use `drizzle-kit push`, `pull` or `introspect`. If drizzle-kit becomes interactive or migrations look odd, stop and let the user handle it.
- Tables are created through schema objects (`pgSchema('plugs').table(...)`), never `pgTable()`. Enums use `schema.enum()`.
- Use `text()` (never `varchar`) and enforce lengths in Zod. Use `uniqueIndex()` instead of `.unique()`, add an index on `createdAt` to every table, and let index names generate automatically.
- Use `count()` from `drizzle-orm` for counting and Drizzle helpers (`eq`, `and`, `isNull`, `gte`, …) instead of raw SQL; use `sql` only for things like `now()` and intervals. Prefer `sql\`now()\`` over JavaScript timestamps for writes and filters.
- Pass objects to `jsonb` columns; never `JSON.stringify` them.
- Read-then-write paths run in a transaction and lock rows with `.for('update')`, or use a single atomic statement (like the plug upsert).

## Code Standards

- Strict TypeScript, no `any`, avoid `as` assertions, no explicit return types unless inference fails. Import Zod from `zod/v4`. Static imports only.
- Spell out every identifier (`accessToken`, not `tok`; `elapsedMilliseconds`, not `elapsedMs`). Prefer named `function` declarations and `for...of` loops.
- Dense code: objects on one line, let `oxfmt` wrap. Avoid needless early returns; use single-line `if` for guard throws.
- No comments explaining what code does and no template section comments; rare comments may explain why. Keep useful UI tooltips.
- Throw errors instead of returning error objects or partial data; preserve the original error as `cause` when rethrowing. Use exhaustive `switch` with a `never` check.
- Percentages are stored as 0–1 decimals and converted only for display.
- Submodules are flat: no subdirectories inside `submodules/*`. Keep logic in the module that owns it; no generic utility files or pass-through wrappers.
- No test files, test scripts, example files or extra Markdown files. This file and `README.md` are enough.

## Final Self-Check

After finishing any change, ask yourself "does this new code follow the project standards?" and answer it: formatting, no comments, types, imports, naming, error handling, transactions. Fix violations before reporting, and make sure `pnpm run check-everything` is clean.
