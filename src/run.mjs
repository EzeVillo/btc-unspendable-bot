import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { updateRepositorySecret } from './github.mjs';
import {
  btcLiteralToSats,
  buildPost,
  extractNumberLiteral,
  isSnapshotPublishedForUtcDay,
  parseSourcePayload
} from './lib.mjs';
import { createXPost, getUserAccessToken } from './x.mjs';

const sourceUrl = process.env.SOURCE_URL?.trim();
if (!sourceUrl) {
  throw new Error('SOURCE_URL is required');
}

let parsedSourceUrl;
try {
  parsedSourceUrl = new URL(sourceUrl);
} catch {
  throw new Error('SOURCE_URL is invalid');
}
if (!['http:', 'https:'].includes(parsedSourceUrl.protocol)) {
  throw new Error('SOURCE_URL must use HTTP or HTTPS');
}

const snapshotPath = process.env.SNAPSHOT_PATH ?? path.resolve('data/latest.json');
const dryRun = process.argv.includes('--dry-run');

async function fetchSnapshot() {
  let response;
  try {
    response = await fetch(sourceUrl, {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' }
    });
  } catch {
    throw new Error('Snapshot source request failed');
  }
  if (!response.ok) {
    throw new Error(`Source returned HTTP ${response.status}`);
  }

  let raw;
  try {
    raw = await response.text();
  } catch {
    throw new Error('Snapshot source response could not be read');
  }
  const { payload: parsed, jsonText } = parseSourcePayload(raw);
  const amountLiteral = extractNumberLiteral(jsonText, 'total_unspendable_amount');

  if (!Number.isSafeInteger(parsed.height) || !/^[0-9a-f]{64}$/i.test(parsed.bestblock ?? '')) {
    throw new Error('Source returned an invalid height or block hash');
  }

  return {
    cutoff_utc: new Date().toISOString(),
    height: parsed.height,
    block_hash: parsed.bestblock,
    total_unspendable_sats: btcLiteralToSats(amountLiteral).toString()
  };
}

async function readState() {
  const raw = await readFile(snapshotPath, 'utf8');
  const state = JSON.parse(raw);
  if (!Object.hasOwn(state, 'last_snapshot')) {
    throw new Error('State file is missing last_snapshot');
  }
  return state;
}

async function writeState(snapshot, postId) {
  const state = JSON.stringify({
    last_snapshot: { ...snapshot, x_post_id: postId }
  }, null, 2) + '\n';
  const temporaryPath = `${snapshotPath}.tmp`;
  await writeFile(temporaryPath, state, 'utf8');
  await rename(temporaryPath, snapshotPath);
}

const runStartedAt = new Date().toISOString();
const state = await readState();

if (!dryRun && isSnapshotPublishedForUtcDay(state.last_snapshot, runStartedAt)) {
  console.log(`Skipped: a snapshot was already published on ${runStartedAt.slice(0, 10)} UTC.`);
} else {
  const snapshot = await fetchSnapshot();
  const post = buildPost({ snapshot, previousSnapshot: state.last_snapshot });

  console.log(post);

  if (!dryRun) {
    const tokens = await getUserAccessToken({
      accessToken: process.env.X_USER_ACCESS_TOKEN,
      clientId: process.env.X_CLIENT_ID,
      clientSecret: process.env.X_CLIENT_SECRET,
      refreshToken: process.env.X_REFRESH_TOKEN
    });
    if (tokens.refreshToken) {
      await updateRepositorySecret({
        githubToken: process.env.GH_SECRETS_TOKEN,
        repository: process.env.GITHUB_REPOSITORY,
        secretName: 'X_REFRESH_TOKEN',
        secretValue: tokens.refreshToken
      });
      console.log('Stored the current X refresh token for the next run.');
    }
    const postId = await createXPost({ text: post, accessToken: tokens.accessToken });
    await writeState(snapshot, postId);
    console.log(`Published X post ${postId} and saved snapshot.`);
  } else {
    console.log('Dry run: no X post was created and state was not changed.');
  }
}
