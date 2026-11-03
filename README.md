# RecallDock

Self-hosted persistent memory for Claude Code across chats and devices. Original implementation inspired by the use case of claude-mem; no claude-mem source is copied and this project is not affiliated with Anthropic or claude-mem.

## Included

- Responsive website with account registration/login, memory search and creation, deletion, JSON export, device key creation and revocation.
- GitHub Pages serves the static website; Server.pro runs only the account and memory API. SQLite survives backend restarts.
- Claude Code plugin with SessionStart recall and Stop capture of the final assistant reply.
- Project namespaces shared across devices, plus manually created `global` memories.
- Device-local retry queue, duplicate suppression, opt-in project capture, pause command, best-effort secret redaction.
- Passwords hashed with scrypt, hashed bearer tokens, short-lived browser bearer sessions, strict CORS/origin checks, request limits, tenant isolation, fixed static-file routes.
- Zero npm dependencies. Requires Node.js **24 or newer** (uses built-in SQLite).

This is v0.1: keyword search and recent-memory recall, not AI summarization or embeddings. It captures final assistant replies only, not user prompts, file contents, or tool observations. The most recent 10 matching project/global memories (up to 14,000 characters of serialized context) load at session start. Search older memories from the dashboard or CLI. Server administrators can read the database; this is not end-to-end encrypted. No email verification, email password reset, billing, or admin UI is included.

## Hosting layout

| Component | Host | Contents |
| --- | --- | --- |
| Website | GitHub Pages at `https://corbino50211.github.io/RecallDock/` once enabled | Only `public/` HTML, CSS, JS and public configuration |
| Accounts and memories | Your Server.pro HTTPS endpoint | `server.js`, SQLite data and private environment settings |
| Claude Code plugin | Each of your computers | Connects directly to the same Server.pro endpoint |

## Enable GitHub Pages

1. Open **Settings → Pages** in this repository and select **GitHub Actions** as the source.
2. Open **Actions → Deploy website to GitHub Pages → Run workflow**. Later pushes to website files deploy automatically.
3. After the workflow succeeds, open `https://corbino50211.github.io/RecallDock/`.
4. Enter your Server.pro **HTTPS API origin** in the login form. Optionally set `apiBaseUrl` in `public/config.js` to make it the default for everyone, then push. This is a public URL, never a password or key.

GitHub Pages for a private personal repository requires GitHub Pro. Free accounts can use Pages from public repositories. Choose your preferred repository visibility/plan in GitHub; this project does not change it automatically. The workflow uploads only `public/`, never backend files, `.env`, or account data. Pages must be enabled before the configure/deploy steps succeed.

## Server.pro deployment

Use a Server.pro service with a custom Node.js runtime **24+**, persistent writable storage and an HTTPS proxy or tunnel. Exact panel controls and allocated ports depend on your service.

1. Upload **`server.js` and `package.json` only** to the backend working directory. Do not upload `public/`; it belongs on GitHub Pages.
2. Copy `.env.example` to `.env` on Server.pro. Set `PORT` to your allocated web port, such as `300` only if your service allocated it. Set `DATA_DIR` to persistent storage and choose a long random `INVITE_CODE`.
3. Set `PUBLIC_URL` to your API's exact HTTPS origin, for example `https://memory.example.com`.
4. Keep `FRONTEND_ORIGIN=https://corbino50211.github.io` (lowercase, **no `/RecallDock/` path and no trailing slash**). If you use a custom Pages domain, use that origin instead. Keep `SERVE_FRONTEND=false`.
5. Start `node --env-file=.env server.js`. If the panel only accepts a script name, use `server.js` and configure environment variables through the panel. No npm install/build is needed.
6. Configure HTTPS through your reverse proxy or tunnel, forwarding to the backend's allocated port. The Node process speaks HTTP behind it. DNS and TLS are separate from `PUBLIC_URL`.
7. Check your API's `/health`, then open the GitHub Pages website and enter the API URL to create your account with the invite.
8. In the dashboard, create device keys. Configure each Claude plugin with **the API URL**, not the GitHub Pages URL.

The backend serves only `/health` and `/api/*` by default. Browser requests must come from the configured frontend origin; CLI device requests can omit Origin. The frontend uses expiring bearer sessions with `credentials: omit`, so third-party cookies are unnecessary. Session tokens stay only in browser memory: reloading or closing the page requires signing in again. The non-secret API URL is remembered locally. CORS restricts browser origins; authenticated account isolation is enforced independently on every request.

Registration requires the server invite; an unset invite disables signup. Existing accounts still work. Rate limits use socket IP/account; users behind a proxy share its IP quota. The app does not trust arbitrary forwarded-IP headers. Run one instance against one local SQLite directory. Keep `.env`, SQLite files and device keys out of GitHub. Turn on restart-on-crash if your panel supports it.

## Local development

For a local single-host preview, set `PUBLIC_URL=http://localhost:3000`, `FRONTEND_ORIGIN=http://localhost:3000`, `SERVE_FRONTEND=true`, and an invite in `.env`, then run:

```sh
node --env-file=.env server.js
```

Open http://localhost:3000 and enter that URL as the memory server. This optional preview mode does not change the production split.

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

The suite also tests GitHub Pages CORS preflight, rejected origins, browser login without cookies, device creation via browser bearer sessions, logout revocation, and API-only hosting.

Not yet verified: live Claude Code loading, Windows/macOS execution, browser visual/interaction QA, a live Pages deployment, and a real Server.pro deployment. Hook payloads and plugin layout follow the official documentation:
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
