# Laundry Plugs

Is the machine free? Shelly smart plugs under the washers and dryers at [fools' valley](https://foolsvalley.com/) report their power draw every minute, and a small page shows which machines are available, in use or unavailable. The source lives at [fools-valley/laundry-plugs](https://github.com/fools-valley/laundry-plugs) (private).

- `database/`: Drizzle schema and migrations (PostgreSQL)
- `api/`: Hono API that receives plug readings and serves plug statuses
- `frontend/`: Vue 3 + Quasar page in the fools' valley style
- `shelly/`: standalone scripts for the six plugs

## Local development

```bash
pnpm install
psql -d postgres -c 'CREATE DATABASE laundry_plugs;'
pnpm -C database exec drizzle-kit migrate
pnpm dev   # API on :3041, frontend on http://localhost:9082
```

`DATABASE_URL` defaults to `postgres://postgres:postgres@localhost:5432/laundry_plugs`. The API and migrator read `.env` from their working directory and the file named by `ENV_FILE`.

## Access tokens

Tokens are created by hand. Only their SHA-256 hash is stored, so copy the token from the `RETURNING` output; it cannot be recovered later.

```sql
WITH generated AS (SELECT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') AS token)
INSERT INTO auth.access_token (name, token_hash)
SELECT 'old house plugs', encode(sha256(token::bytea), 'hex') FROM generated
RETURNING (SELECT token FROM generated);
```

Revoke one with `UPDATE auth.access_token SET revoked_at = now() WHERE name = '…';`.

## API

`POST /api/plugs/:identifier/readings` with `Authorization: Bearer <token>` and a Shelly `Switch.GetStatus` body. A new identifier (lowercase words joined by dashes, up to 64 characters) creates its plug on the first reading. `X-Plug-Activity` (`quiet`, or the ages in seconds of the first and last active samples since the previous reading) and the Telegram chat, topic and display name headers are required; `X-Telegram-Message-Id` is added once the plug has a message. Answers `204`.

```bash
curl -X POST https://fools.alexdaniel.org/api/plugs/old-house-washer-1/readings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'X-Plug-Activity: 42,0' \
  -H 'X-Telegram-Chat-Id: -1004415267872' -H 'X-Telegram-Topic-Id: 2' -H 'X-Telegram-Display-Name: Old House Washer 1' \
  -d '{"output":true,"apower":412.3,"voltage":231.2,"current":1.82,"aenergy":{"total":15234.5},"temperature":{"tC":41.2}}'
```

`GET /api/plugs` is public and returns each plug's status, last reading and power draw, when its current cycle started and when it was last used. The browser loads this data after receiving the static page from nginx.

`GET /api/plugs/usage?ending=YYYY-MM-DD` returns seven days of completed usage ranges through the requested date. Cycles are grouped by the day they ended in mainland Portugal. The website shows daily counts and the selected day's start and end times.

## Telegram

Each plug reserves one Telegram message with just its display name, saves the message ID, and edits that message in place when its status is ready. The default destination is the private test topic.

- 🔴 Old House Washer 1 · In use (for 3 minutes)
- 🟢 Old House Washer 1 · Available
- ⚪ Old House Washer 1 · Unavailable

The plug samples power every second. Any sample of 5 W or more counts as activity, and every spike restarts the quiet timer. The machine becomes available after 3 minutes continuously below 5 W. Each minute the plug sends the first and last active samples in that reporting interval as ages in seconds, alongside the unmodified switch status. The website uses those samples to detect activity between reports. A cycle start updates the Telegram message and sends an extra reading within a second, so the website, which refreshes every 5 seconds, shows it right away. Becoming available waits for 3 quiet minutes, because the machine may be soaking; then Telegram updates at once and a reading follows 5 seconds later, a margin for the API, which times the quiet minutes by when readings arrive. Failed readings retry every 10 seconds and keep their activity samples, and the plug catches up on Telegram as soon as a reading gets through, so a plug that reconnects or reboots shows up again within seconds. The in-use time is elapsed from the first active sample and refreshes every minute. The history log omits runs shorter than 3 minutes.

The plug sends the full switch status to the API every minute. After Telegram confirms the initial message, the next reading carries its chat, topic and message IDs and machine name in HTTP headers. The API stores that reference and checks once a minute for plugs that have missed more than five minutes of readings. It edits the tracked message to Unavailable once, then tells the plug to restore its own status when reporting resumes. The plug stores its Telegram message ID, chat and topic in persistent script storage and reuses that message after reboot. Telegram updates run independently of whether the reading reaches the API. When reporting resumes, the API can flag that it marked the saved message Unavailable so the plug refreshes it. The updated script may post a new status line on first run because earlier versions stored the ID only on the server.

Switching destinations requires updating the scripts and the API's `TELEGRAM_CHAT_ID` and `TELEGRAM_TOPIC_ID` together.

| Destination                                                         | Chat ID          | Topic ID |
| ------------------------------------------------------------------- | ---------------- | -------- |
| “Laundry” topic in the private “Fools Laundry Test” group (current) | `-1004415267872` | `2`      |

## Setting up a plug

The plugs are Shelly Plug M Gen3. Any Gen2 or newer Shelly plug with a power meter works the same way, since the script only reads `switch:0`.

1. Connect the plug to Wi-Fi, update its firmware and open its web UI. Set a password for the web UI (**Settings → Authentication**): the script holds the bot token, and anyone on the network could otherwise read it.
2. Under **Scripts**, create a script and paste the matching file below.
3. Set `apiToken` (an access token from above) and `telegramBotToken`. The machine name, identifier, reporting slot and test topic are already configured.
4. Save, start it and enable **Run on startup**. The plug appears on the page after its first reading.

| Device             | Script                         | Second of each minute |
| ------------------ | ------------------------------ | --------------------- |
| Old House Washer 1 | `shelly/old-house-washer-1.js` | 05                    |
| Old House Washer 2 | `shelly/old-house-washer-2.js` | 15                    |
| Old House Dryer 1  | `shelly/old-house-dryer-1.js`  | 25                    |
| TC House Washer 1  | `shelly/tc-house-washer-1.js`  | 35                    |
| TC House Dryer 1   | `shelly/tc-house-dryer-1.js`   | 45                    |
| Mystery Machine 1  | `shelly/mystery-machine-1.js`  | 55                    |

Reporting aligns to wall-clock minute slots once the plug clock syncs. Before clock sync the script uses device uptime. Elapsed cycle tracking restarts when the script restarts. An initially quiet plug waits for 3 minutes of observation before showing Available.

## Deployment

Every push to `main` builds the `database`, `api` and `frontend` images, pushes them to `postmodern.alexdaniel.org` and deploys each as a Swarm stack (`laundry-plugs-database`, `-api`, `-frontend`). The migrator container runs pending migrations on deploy.

One-time setup on the Swarm host:

- `laundry-plugs` user for SSH deploys, registry account `laundry-plugs`, and GitHub secrets `DOCKER_REGISTRY_PASSWORD` and `SSH_KEY`
- attachable overlay network `laundry-plugs-internal` for Postgres and the API, and the existing `caddy` overlay for HTTP ingress
- Docker secrets: `laundry_plugs_postgres_password`, and `laundry_plugs_database_env` and `laundry_plugs_api_env` each containing `DATABASE_URL=postgres://laundry_plugs:<password>@laundry-plugs-database_postgres:5432/laundry_plugs`
- Put the same bot token used on the plugs in the API env secret as `TELEGRAM_BOT_TOKEN` to enable offline edits.
- `/home/laundry-plugs/data/laundry-plugs/database` for Postgres data

### Provision the Swarm secrets

Copy `refresh-envs` from this repository to `/home/laundry-plugs/refresh-envs` on postmodern. Run the commands below as the `laundry-plugs` user on that host. The `envs/` directory holds the private source files for the three Swarm secrets.

For a fresh installation, generate the files with one shared database password:

```bash
(
  set -euo pipefail
  umask 077
  cd /home/laundry-plugs
  mkdir -p envs
  set -o noclobber
  password=$(openssl rand -hex 32)
  printf '%s' "$password" > envs/postgres.password
  printf 'DATABASE_URL=postgres://laundry_plugs:%s@laundry-plugs-database_postgres:5432/laundry_plugs\n' "$password" > envs/database.env
  cp -n envs/database.env envs/api.env
)
```

Add `TELEGRAM_BOT_TOKEN` to `envs/api.env` if using Telegram offline edits. Run `./refresh-envs` before rerunning the first deployment. It creates the data directory, the attachable internal overlay and any missing secrets, and prints what it did with each secret. The frontend stack registers the site with the existing Caddy Docker Proxy, which serves the frontend and forwards `/api/*` to the API with the prefix stripped.

After editing any file in `envs/`, run `./refresh-envs` again. It stores a SHA-256 of each file as a label on its Swarm secret and rolls out only the services whose file changed, twice each, while it swaps in a temporary Swarm secret and then restores the original secret name used by Compose. Secrets created before these labels count as changed once. Refreshing `database` restarts the migrator. On an initialized database, changing `envs/postgres.password` alone does not change the database user's password. Keep the password file and both connection strings consistent with the actual Postgres credential.
