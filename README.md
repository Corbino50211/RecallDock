# RecallDock

Self-hosted persistent memory for Claude Code across chats and devices. Original implementation inspired by the use case of claude-mem; no claude-mem source is copied and this project is not affiliated with Anthropic or claude-mem.

## Included

- Responsive website with account registration/login, memory search and creation, deletion, JSON export, device key creation and revocation.
- One Node.js process serves the website and API; SQLite survives restarts.
- Claude Code plugin with SessionStart recall and Stop capture of the final assistant reply.
- Project namespaces shared across devices, plus manually created `global` memories.
- Device-local retry queue, duplicate suppression, opt-in project capture, pause command, best-effort secret redaction.
- Passwords hashed with scrypt, hashed bearer tokens, HTTP-only browser sessions, origin checks, request limits, tenant isolation, fixed static-file routes.
- Zero npm dependencies. Requires Node.js **24 or newer** (uses built-in SQLite).

This is v0.1: keyword search and recent-memory recall, not AI summarization or embeddings. It captures final assistant replies only, not user prompts, file contents, or tool observations. The most recent 10 matching project/global memories (up to 14,000 characters of serialized context) load at session start. Search older memories from the dashboard or CLI. Server administrators can read the database; this is not end-to-end encrypted. No email verification, email password reset, billing, or admin UI is included.

## Quick local start

```sh
cp .env.example .env
# Edit .env: PUBLIC_URL=http://localhost:3000 and a private INVITE_CODE
node --env-file=.env server.js
```

Open http://localhost:3000, create an account using the invite, and create a device key from **Devices & setup**. Website and API are on the same origin: no separate frontend host is required.

## Server.pro deployment

Use a Server.pro service that can run a custom Node.js application with persistent writable storage and Node.js 24+. A game-server-only plan or an older Node runtime is insufficient. The exact panel controls and assigned port depend on your service.

1. Upload `server.js`, `package.json`, and the entire `public/` directory to your server's working directory. The plugin runs on your computers, not on Server.pro.
2. Copy `.env.example` to `.env` on the server. Set `PORT` to your allocated web port (for example `300` **only if allocated to your service**), `DATA_DIR` to a persistent writable directory, and `INVITE_CODE` to a long random private value.
3. Set `PUBLIC_URL` to the exact HTTPS origin users will visit, without a trailing slash, for example `https://memory.example.com`. This is used for browser origin checks; it does not configure DNS or TLS.
4. Start with `node --env-file=.env server.js`. If your panel only accepts `server.js` as an entrypoint, set the variables in its environment settings instead. No package install or build is needed.
5. Route HTTPS through your host's reverse proxy or a separately configured tunnel to your allocated port. The app speaks HTTP behind that proxy. Do not expose real accounts over public HTTP. Point DNS to the HTTPS endpoint as appropriate.
6. Verify `/health`, sign in through the website, and test a device. Enable panel restart-on-crash if available.
7. Keep `.env`, `data/`, and all SQLite files out of GitHub. Back up persistent data regularly.

The service requires an invite for every registration. An unset invite disables registration. Existing users can still sign in. Rate limits are in-process and per socket IP/account; users behind a proxy share the socket IP quota. The app deliberately does not trust arbitrary forwarded-IP headers. Run one instance on one local SQLite data directory. This is not a distributed deployment.

### Backup and recovery

Stop the server cleanly, copy the entire `DATA_DIR` to protected backup storage, and restart. To restore, stop the server, replace the directory with a backup and restart. Do not copy only the main SQLite file while the app is running: recent transactions can be in WAL files. Exports contain memory records only; they do not back up accounts or device keys. There is no import UI in v0.1.

## Connect Claude Code on each device

Install Node.js 24+ and Claude Code. Download/clone this repository.

```sh
node plugin/scripts/recall.mjs setup
```

Enter the HTTPS server URL and a newly generated device key **in your own terminal**. Do not paste keys into a Claude conversation. The local setup prompt displays input, so do not screen-share it. Configuration is stored outside the repository at `~/.recalldock/config.json` with restrictive POSIX permissions. On Windows, protect your user profile using Windows account permissions.

From the project you want Claude to remember:

```sh
node /absolute/path/to/recalldock/plugin/scripts/recall.mjs project my-project
claude --plugin-dir /absolute/path/to/recalldock/plugin
```

Quote paths containing spaces. Use the same project slug on all devices for the same project. This creates `.recalldock.json` in your current project with capture enabled. Add this file to that project's `.gitignore` if you do not want to share the project setting. The plugin checks the hook's working directory; start Claude from the configured project root.

For permanent marketplace installation after this repository is on GitHub, run inside Claude Code (replace Corbino50211/RecallDock with the actual repository):

```text
/plugin marketplace add Corbino50211/RecallDock
/plugin install recalldock@recalldock-marketplace
```

Then restart Claude Code. `--plugin-dir` is useful for local testing and development; do not load both a marketplace copy and a local copy simultaneously.

### Capture and privacy controls

```sh
# Run inside the configured project:
node /path/to/plugin/scripts/recall.mjs pause
node /path/to/plugin/scripts/recall.mjs search "database"
node /path/to/plugin/scripts/recall.mjs sync
# Re-enable capture using the same slug:
node /path/to/plugin/scripts/recall.mjs project my-project
```

For manual saves, run `remember` and supply up to 12,000 characters on stdin (EOF ends input). It never needs your key as a command-line argument. On POSIX shells:

```sh
printf '%s' 'The application uses SQLite.' | node /path/to/plugin/scripts/recall.mjs remember
```

Pause disables automatic uploads; recall still works. Disable the plugin to stop both. Remove queued files under `~/.recalldock/queue/` if you want to discard pending uploads; server deletion alone cannot remove an offline pending upload. Do this while hooks are not running. Queues are bound to the endpoint and device key to prevent sending an old account's data to a different account. Rotating a key leaves its old queue unsent; review it manually rather than copying it blindly.

Redaction covers `<private>...</private>` blocks, common key patterns, private keys and simple password/token assignments. It cannot recognize every secret. Do not enable capture in projects containing sensitive material unless you accept this limitation. Server data is plaintext and readable by the host administrator.

Device keys expire after 90 days; browser sessions expire after 24 hours. Revocation takes effect immediately on the server. Generate a replacement key and rerun setup when needed. Network failures do not block Claude; captured entries remain in the local queue, retried at session start, subsequent capture, or `sync`. Queue cap: 500 entries per endpoint/key. Server cap: 10,000 memories per account. Offline recall is unavailable; Claude continues without server context.

## Validation

```sh
npm run check
npm test
```

The automated suite covers real HTTP registration/login, account isolation, cross-device access, deduplication, project filtering, search, export, deletion, persistence after restart, CSRF rejection, device-key privilege restrictions, revocation, and logout. Subprocess tests exercise actual hook scripts for capture, recall, pause, offline queueing and redaction.

Not yet verified: live Claude Code loading, Windows/macOS execution, browser visual/interaction QA, and a real Server.pro deployment. Hook payloads and plugin layout follow the official documentation:
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/plugins-reference

## Put this project on GitHub

Create an empty repository, then from this directory:

```sh
git init
git add .
git commit -m "Initial RecallDock implementation"
git branch -M main
git remote add origin https://github.com/Corbino50211/RecallDock.git
git push -u origin main
```

The included GitHub Actions workflow runs checks and tests on pushes and pull requests. Never commit runtime data, keys, or `.env`.
