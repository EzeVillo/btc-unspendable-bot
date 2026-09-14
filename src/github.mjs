import { spawn } from 'node:child_process';

function requireValue(value, name) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function runCommandWithInput({ command, args, env, input, timeoutMilliseconds = 20_000 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, {
      env,
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMilliseconds);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    }

    child.once('error', () => finish(new Error('GitHub CLI could not be started')));
    child.once('close', (code) => {
      if (timedOut) {
        finish(new Error('GitHub secret update timed out'));
      } else if (code !== 0) {
        finish(new Error(`GitHub secret update exited with code ${code}`));
      } else {
        finish();
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function updateRepositorySecret({
  githubToken,
  repository,
  secretName,
  secretValue,
  runCommandImpl = runCommandWithInput,
  waitImpl = wait
}) {
  const token = requireValue(githubToken, 'GH_SECRETS_TOKEN');
  const repo = requireValue(repository, 'GITHUB_REPOSITORY');
  const name = requireValue(secretName, 'GitHub secret name');
  const value = requireValue(secretValue, 'GitHub secret value');

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('GITHUB_REPOSITORY is invalid');
  }
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    throw new Error('GitHub secret name is invalid');
  }

  const request = {
    command: 'gh',
    args: ['secret', 'set', name, '--app', 'actions', '--repo', repo],
    env: {
      ...process.env,
      GH_TOKEN: token,
      GH_PROMPT_DISABLED: '1'
    },
    input: value
  };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await runCommandImpl(request);
      return;
    } catch {
      if (attempt < 3) {
        await waitImpl(attempt * 1_000);
      }
    }
  }

  throw new Error('Could not persist the rotated X refresh token after 3 attempts');
}
