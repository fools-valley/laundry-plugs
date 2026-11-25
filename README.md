# Laundry Plugs

Is the machine free? Shelly smart plugs under the washers and dryers at [fools' valley](https://foolsvalley.com/) report their power draw every minute, and a small page shows which machines are available, in use or offline. The source lives at [fools-valley/laundry-plugs](https://github.com/fools-valley/laundry-plugs) (private).

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

`POST /api/plugs/:identifier/readings` with `Authorization: Bearer <token>` and a Shelly `Switch.GetStatus` body. A new identifier (lowercase words joined by dashes, up to 64 characters) creates its plug on the first reading. `X-Plug-Activity` (`quiet`, or the ages in seconds of the first and last active samples since the previous reading) and the Telegram chat, topic and display name headers are required; `X-Telegram-Message-Id` is added once the plug has a message. `X-Plug-Ip-Address` carries the plug's Wi-Fi IPv4 address; the API keeps the latest one in `plugs.plug.local_ip_address` and never shows it on the website. Answers `204`.

```bash
curl -X POST https://fools.alexdaniel.org/api/plugs/old-house-washer-1/readings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'X-Plug-Activity: 42,0' \
  -H 'X-Telegram-Chat-Id: -1004415267872' -H 'X-Telegram-Topic-Id: 2' -H 'X-Telegram-Display-Name: Old House Washer 1' \
  -d '{"output":true,"apower":412.3,"voltage":231.2,"current":1.82,"aenergy":{"total":15234.5},"temperature":{"tC":41.2}}'
```

`GET /api/plugs` is public and returns each plug's status, last reading and power draw, when its current cycle started and when it was last used. The browser loads this data after receiving the static page from nginx.

`GET /api/plugs/usage?ending=YYYY-MM-DD` returns seven days of completed usage ranges through the requested date, with the energy each cycle used and each day's total across all plugs. Energy comes from the rises in each plug's `aenergy.total` counter; a drop, such as a counter reset, counts as zero. Cycles are grouped by the day they ended in mainland Portugal. The website shows daily counts, the selected day's total energy, and each cycle's start and end times and energy.

## Telegram

Each plug reserves one Telegram message with just its display name as soon as its script starts without a saved message, saves the message ID, and edits that message in place when its status is ready. The destination is configured outside the repository: the scripts in `shelly/` carry placeholders, and the real chat and topic IDs live in the private copies of the scripts and in the API env secret.

- 🔴 Old House Washer 1 · In use (for 3 minutes)
- 🟢 Old House Washer 1 · Available
- ⚪ Old House Washer 1 · Offline

The plug samples power every second. Any sample of 5 W or more counts as activity, and every spike restarts the quiet timer. The machine becomes available after 3 minutes continuously below 5 W. Each minute the plug sends the first and last active samples in that reporting interval as ages in seconds, alongside the unmodified switch status. The website uses those samples to detect activity between reports. A cycle start updates the Telegram message and sends an extra reading within a second, so the website, which refreshes every 5 seconds, shows it right away. Becoming available waits for 3 quiet minutes, because the machine may be soaking; then Telegram updates at once and a reading follows 5 seconds later, a margin for the API, which times the quiet minutes by when readings arrive. Failed readings retry every 10 seconds and keep their activity samples, and the plug catches up on Telegram as soon as a reading gets through, so a plug that reconnects or reboots shows up again within seconds. The in-use time is elapsed from the first active sample and refreshes every minute. The history log omits runs shorter than 3 minutes.

The plug sends the full switch status to the API every minute. After Telegram confirms the initial message, the next reading carries its chat, topic and message IDs and machine name in HTTP headers. The API stores that reference and checks once a minute for plugs that have missed more than five minutes of readings. It edits the tracked message to Offline once, then tells the plug to restore its own status when reporting resumes. The plug stores its Telegram message ID, chat and topic in persistent script storage and reuses that message after reboot. Telegram updates run independently of whether the reading reaches the API. When reporting resumes, the API can flag that it marked the saved message Offline so the plug refreshes it. The updated script may post a new status line on first run because earlier versions stored the ID only on the server.

People can also message @FoolsLaundryBot directly. Any message gets a short introduction with a button for each machine showing its status and how long it has been in use, in the same format as the plug messages; `/notify` shows the same buttons. The latest of these menus in each chat keeps its buttons current, for the 50 most recent menus across all chats: once a minute the API edits it if any label changed, spreading edits across the minute (at most one every 960 ms) and pausing when Telegram asks it to slow down. It stops as soon as the person sends anything or taps a button. Menus are logged in `plugs.machine_menu`. Picking a running machine asks for a private message when it finishes; picking any other machine asks whether to send one when it is in use or when it is available again. `/cancel` lists the person's waiting notifications, and tapping one marks it cancelled; sent and cancelled requests stay in the table as a log. Each person can make up to 1000 requests in any 24 hours. The API receives these messages by long polling `getUpdates` with `TELEGRAM_BOT_TOKEN`, so no webhook is needed, and it registers `/notify` in the private-chat command menu on startup. Requests are kept in `plugs.notification` until they are sent and checked after each reading of their plug, using the same statuses as the website. Each request stores the person's Telegram name and username; `GET /api/plugs` returns only the first names of the people waiting for each machine (`waitingNames`), and the bot tells people their name shows on the website. Each machine card links to `https://t.me/FoolsLaundryBot?start=<plug identifier>`, which opens the bot on that machine's question; `?start=notify` opens the machine list. Only one process may poll a bot at a time, so the API polls only when `NODE_ENV` is `production`.

Switching destinations requires updating every plug's `telegramChatId` and `telegramTopicId` and the API's `TELEGRAM_CHAT_ID` and `TELEGRAM_TOPIC_ID` together. A plug whose destination changes posts a new message there. For local testing, use the “Laundry” topic in the private “Fools Laundry Test” group: chat `-1004415267872`, topic `2`.

## Setting up a plug

The plugs are Shelly Plug M Gen3. Any Gen2 or newer Shelly plug with a power meter works the same way, since the script only reads `switch:0`.

1. Connect the plug to Wi-Fi, update its firmware and open its web UI. Set a password for the web UI (**Settings → Authentication**): the script holds the bot token, and anyone on the network could otherwise read it.
2. Under **Scripts**, create a script and paste the matching file below.
3. Set `apiToken` (an access token from above), `telegramBotToken`, `telegramChatId` and `telegramTopicId`. The machine name, identifier and reporting slot are already configured.
4. Save, start it and enable **Run on startup**. The plug appears on the page after its first reading.

| Device             | Script                         | Second of each minute |
| ------------------ | ------------------------------ | --------------------- |
| Old House Washer 1 | `shelly/old-house-washer-1.js` | 05                    |
| Old House Washer 2 | `shelly/old-house-washer-2.js` | 15                    |
| Old House Dryer    | `shelly/old-house-dryer-1.js`  | 25                    |
| TC House Washer    | `shelly/tc-house-washer-1.js`  | 35                    |
| TC House Dryer     | `shelly/tc-house-dryer-1.js`   | 45                    |
| Mystery Machine    | `shelly/mystery-machine-1.js`  | 55                    |

Reporting aligns to wall-clock minute slots once the plug clock syncs. Before clock sync the script uses device uptime. Elapsed cycle tracking restarts when the script restarts. An initially quiet plug waits for 3 minutes of observation before showing Available.

## Deployment

Every push to `main` builds the `database`, `api` and `frontend` images, pushes them to `postmodern.alexdaniel.org` and deploys each as a Swarm stack (`laundry-plugs-database`, `-api`, `-frontend`). The migrator container runs pending migrations on deploy.

One-time setup on the Swarm host:

- `laundry-plugs` user for SSH deploys, registry account `laundry-plugs`, and GitHub secrets `DOCKER_REGISTRY_PASSWORD` and `SSH_KEY`
- attachable overlay network `laundry-plugs-internal` for Postgres and the API, and the existing `caddy` overlay for HTTP ingress
- Docker secrets: `laundry_plugs_postgres_password`, and `laundry_plugs_database_env` and `laundry_plugs_api_env` each containing `DATABASE_URL=postgres://laundry_plugs:<password>@laundry-plugs-database_postgres:5432/laundry_plugs`
- Put the same bot token, chat ID and topic ID used on the plugs in the API env secret as `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `TELEGRAM_TOPIC_ID` to enable offline edits. The token alone enables `/notify`.
- `/home/laundry-plugs/data/laundry-plugs/database` for Postgres data

### Provision the Swarm secrets

Run the commands below as the `laundry-plugs` user on postmodern. The `envs/` directory holds the private source files for the three Swarm secrets.

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

Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `TELEGRAM_TOPIC_ID` to `envs/api.env` if using Telegram offline edits. Then create the data directory, the internal overlay and the secrets before the first deployment:

```bash
mkdir -p /home/laundry-plugs/data/laundry-plugs/database
docker network create --driver overlay --attachable laundry-plugs-internal
docker secret create laundry_plugs_postgres_password envs/postgres.password
docker secret create laundry_plugs_database_env envs/database.env
docker secret create laundry_plugs_api_env envs/api.env
```

The frontend stack registers the site with the existing Caddy Docker Proxy, which serves the frontend and forwards `/api/*` to the API with the prefix stripped.

Swarm secrets cannot be edited in place. To change one, remove the stack that uses it (for example `docker stack rm laundry-plugs-api` for `api.env`), replace the secret with `docker secret rm` and `docker secret create`, and deploy again. On an initialized database, changing `envs/postgres.password` alone does not change the database user's password. Keep the password file and both connection strings consistent with the actual Postgres credential.
