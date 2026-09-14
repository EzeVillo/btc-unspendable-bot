# Provably unspendable bitcoin

Daily bot that publishes the `total_unspendable_amount` returned by a configured Bitcoin Core snapshot endpoint, together with its change since the previous snapshot. Changes below one BTC are shown in satoshis; changes of at least one BTC use whole BTC followed by any remaining satoshis. The bot accepts both direct JSON and JSON embedded in an HTML `pre` element.

## Metric scope

The bot reports BTC that Bitcoin Core classifies as permanently excluded from the spendable UTXO set. This includes the genesis block, historical BIP30 cases, unspendable scripts, and unclaimed mining rewards, among other categories. It does not estimate lost seed phrases or inactive wallets.

## How it works

The workflow runs in GitHub Actions and is triggered at **00:00 UTC** by [cron-job.org](https://cron-job.org/). The external service is only the clock: the bot code, secrets, execution logs, and snapshot history remain in GitHub. Each run is named `Daily snapshot · cron-job.org` so scheduled and manual executions are easy to distinguish.

1. Skips the run when `data/latest.json` already contains a successful snapshot for the current UTC date.
2. Downloads the source payload.
3. Records the height, block hash, total in satoshis, and UTC snapshot time.
4. Calculates the change from `data/latest.json`.
5. Exchanges the current X refresh token and persists the rotated token in GitHub Secrets.
6. Publishes a post to X only after the refresh token is safely stored.
7. If X confirms the post, updates and commits `data/latest.json`.

The first post establishes the baseline; the second includes the change from the previous snapshot.

## GitHub setup

1. Create a GitHub repository from this folder and push the default branch.
2. In **Settings → Actions → General**, allow `GITHUB_TOKEN` to have read and write access to repository contents.
3. In **Settings → Secrets and variables → Actions → Secrets**, create the required `SOURCE_URL` repository secret with the HTTPS URL of the snapshot endpoint, together with these OAuth 2.0 secrets:
   - `X_CLIENT_ID`
   - `X_CLIENT_SECRET`
   - `X_REFRESH_TOKEN`
4. Create a fine-grained GitHub personal access token restricted to this repository with **Secrets: Read and write** permission. Store it as the repository secret `GH_SECRETS_TOKEN`. The workflow uses it only to persist X's rotated refresh token.
5. To create the X refresh token, temporarily define `X_CLIENT_ID` and `X_CLIENT_SECRET` in your terminal from this folder, then run `npm run auth:x`. Open the displayed link, authorize the X account that will publish, and copy the resulting value into the `X_REFRESH_TOKEN` GitHub secret. The callback configured in X must be exactly `http://127.0.0.1:3000/callback`.
6. Run the workflow once manually from the **Actions** tab. It creates the first post and snapshot.

On every execution, the bot uses the refresh token to obtain a short-lived access token and writes X's current refresh token back to `X_REFRESH_TOKEN` before publishing. The value is passed to GitHub CLI over standard input, never as a command-line argument, and no secrets are stored in the repository. The update is retried three times; publishing is aborted if it cannot be persisted. If X revokes the refresh token, authorize the application again and replace the secret.

## Snapshot source contract

`SOURCE_URL` has no built-in default and the bot stops immediately when it is missing. The configured endpoint must accept an HTTP `GET` and return a successful response containing these Bitcoin Core fields:

```json
{
  "height": 967031,
  "bestblock": "000000000000000000002d72f6c68073a83f508079422103a3cd0564620a7a45",
  "total_unspendable_amount": 230.12011299
}
```

Additional fields are allowed. A future endpoint backed by a private Bitcoin Core node only needs to expose this read-only response shape. Once it is available, migration consists solely of replacing the `SOURCE_URL` repository secret; the node's RPC interface and credentials must remain private.

## External schedule

Create a fine-grained GitHub personal access token restricted to this repository with **Actions: Read and write** permission and an expiration date. Store it only in cron-job.org, never in this repository.

Create a daily cron job with these settings:

- Schedule: `00:00`, every day, timezone `UTC`
- URL: `https://api.github.com/repos/EzeVillo/btc-unspendable-bot/actions/workflows/daily.yml/dispatches`
- Request method: `POST`
- Save responses: enabled
- Failure and recovery notifications: enabled

Request headers:

```text
Accept: application/vnd.github+json
Authorization: Bearer <FINE_GRAINED_GITHUB_TOKEN>
Content-Type: application/json
X-GitHub-Api-Version: 2026-03-10
```

Request body:

```json
{"ref":"master","inputs":{"trigger":"cron-job.org"}}
```

A successful dispatch returns HTTP `200` with the GitHub run id and URL. cron-job.org retains the planned time, actual execution time, scheduling jitter, HTTP status, duration, and saved response. GitHub retains the complete workflow and job logs.

Do not add a second daily scheduler unless it is intentionally acting as a fallback. Duplicate requests are safe after one run has committed its snapshot, but unnecessary triggers still create skipped entries in the GitHub Actions history.

## Local development

Requires Node.js 20 or newer.

```powershell
npm test
$env:SOURCE_URL = 'https://your-snapshot-endpoint.example/'
node src/run.mjs --dry-run
```

For a one-off local publication, define `X_USER_ACCESS_TOKEN` and `SOURCE_URL`, then run `node src/run.mjs`. Refresh-token publication additionally requires `GH_SECRETS_TOKEN` and `GITHUB_REPOSITORY=EzeVillo/btc-unspendable-bot` so the rotated token is not lost. OAuth 2.0 access tokens expire and should not be used for the daily workflow.

## Cost and operation

The workflow makes one daily X write and normally no X reads. Posts omit URLs because X charges more for posts that include them. If the connection fails after sending the post but before receiving the response, the workflow stops rather than blindly retrying and risking a duplicate post. This exceptional case requires manual review.
