import test from 'node:test';
import assert from 'node:assert/strict';
import { updateRepositorySecret } from '../src/github.mjs';

test('updates an Actions secret without placing its value in process arguments', async () => {
  const calls = [];

  await updateRepositorySecret({
    githubToken: 'github-token',
    repository: 'owner/repository',
    secretName: 'X_REFRESH_TOKEN',
    secretValue: 'rotated-refresh-token',
    runCommandImpl: async (request) => calls.push(request)
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'gh');
  assert.deepEqual(calls[0].args, [
    'secret', 'set', 'X_REFRESH_TOKEN',
    '--app', 'actions',
    '--repo', 'owner/repository'
  ]);
  assert.equal(calls[0].input, 'rotated-refresh-token');
  assert.equal(calls[0].env.GH_TOKEN, 'github-token');
  assert.doesNotMatch(calls[0].args.join(' '), /rotated-refresh-token/);
});

test('retries transient failures before updating the secret', async () => {
  let attempts = 0;
  const delays = [];

  await updateRepositorySecret({
    githubToken: 'github-token',
    repository: 'owner/repository',
    secretName: 'X_REFRESH_TOKEN',
    secretValue: 'rotated-refresh-token',
    runCommandImpl: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient failure');
    },
    waitImpl: async (milliseconds) => delays.push(milliseconds)
  });

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1_000, 2_000]);
});

test('fails closed after the secret cannot be persisted', async () => {
  let attempts = 0;

  await assert.rejects(
    updateRepositorySecret({
      githubToken: 'github-token',
      repository: 'owner/repository',
      secretName: 'X_REFRESH_TOKEN',
      secretValue: 'sensitive-rotated-token',
      runCommandImpl: async () => {
        attempts += 1;
        throw new Error('failure containing sensitive-rotated-token');
      },
      waitImpl: async () => {}
    }),
    (error) => {
      assert.equal(error.message, 'Could not persist the rotated X refresh token after 3 attempts');
      assert.doesNotMatch(error.message, /sensitive-rotated-token/);
      return true;
    }
  );

  assert.equal(attempts, 3);
});

test('validates GitHub secret update configuration before invoking gh', async () => {
  let called = false;
  const runCommandImpl = async () => {
    called = true;
  };

  await assert.rejects(
    updateRepositorySecret({
      repository: 'owner/repository',
      secretName: 'X_REFRESH_TOKEN',
      secretValue: 'rotated-refresh-token',
      runCommandImpl
    }),
    /GH_SECRETS_TOKEN is required/
  );
  await assert.rejects(
    updateRepositorySecret({
      githubToken: 'github-token',
      repository: 'invalid repository',
      secretName: 'X_REFRESH_TOKEN',
      secretValue: 'rotated-refresh-token',
      runCommandImpl
    }),
    /GITHUB_REPOSITORY is invalid/
  );

  assert.equal(called, false);
});
