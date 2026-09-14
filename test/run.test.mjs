import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

test('SOURCE_URL is required', async () => {
  const env = { ...process.env };
  delete env.SOURCE_URL;

  await assert.rejects(
    execFileAsync(process.execPath, ['src/run.mjs', '--dry-run'], {
      cwd: repositoryRoot,
      env
    }),
    (error) => {
      assert.match(error.stderr, /SOURCE_URL is required/);
      return true;
    }
  );
});

test('invalid SOURCE_URL errors do not reveal the configured value', async () => {
  const sensitiveUrl = 'not-a-url-with-private-source-details';

  await assert.rejects(
    execFileAsync(process.execPath, ['src/run.mjs', '--dry-run'], {
      cwd: repositoryRoot,
      env: { ...process.env, SOURCE_URL: sensitiveUrl }
    }),
    (error) => {
      assert.match(error.stderr, /SOURCE_URL is invalid/);
      assert.doesNotMatch(error.stderr, new RegExp(sensitiveUrl));
      return true;
    }
  );
});

test('source connection errors do not reveal endpoint details', async () => {
  const sensitiveHostname = 'private-source-host.example.invalid';
  const sensitivePath = 'private-source-path';

  await assert.rejects(
    execFileAsync(process.execPath, ['src/run.mjs', '--dry-run'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SOURCE_URL: `https://${sensitiveHostname}/${sensitivePath}`
      }
    }),
    (error) => {
      assert.match(error.stderr, /Snapshot source request failed/);
      assert.doesNotMatch(error.stderr, new RegExp(sensitiveHostname));
      assert.doesNotMatch(error.stderr, new RegExp(sensitivePath));
      return true;
    }
  );
});

test('a repeated production run exits before fetching or posting', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'btc-unspendable-bot-'));
  const snapshotPath = path.join(directory, 'latest.json');

  try {
    await writeFile(snapshotPath, JSON.stringify({
      last_snapshot: { cutoff_utc: new Date().toISOString() }
    }), 'utf8');

    const { stdout } = await execFileAsync(process.execPath, ['src/run.mjs'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SNAPSHOT_PATH: snapshotPath,
        SOURCE_URL: 'http://127.0.0.1:1/must-not-be-requested'
      }
    });

    assert.match(stdout, /^Skipped: a snapshot was already published on \d{4}-\d{2}-\d{2} UTC\./);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
