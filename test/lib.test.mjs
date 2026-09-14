import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SUPPLY_SATS,
  btcLiteralToSats,
  buildPost,
  formatPercent,
  isSnapshotPublishedForUtcDay,
  parseSourcePayload,
  satsToBtc
} from '../src/lib.mjs';
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  getUserAccessToken
} from '../src/x.mjs';

test('converts BTC decimal literals to exact satoshis', () => {
  assert.equal(btcLiteralToSats('230.11430264'), 23_011_430_264n);
  assert.equal(btcLiteralToSats('1'), 100_000_000n);
  assert.throws(() => btcLiteralToSats('1.000000001'));
});

test('formats satoshis without floating point arithmetic', () => {
  assert.equal(satsToBtc(42n), '0.00000042');
  assert.equal(satsToBtc(-42n), '-0.00000042');
  assert.equal(satsToBtc(23_011_430_264n), '230.11430264');
});

test('formats percentage of theoretical maximum supply', () => {
  assert.equal(formatPercent(MAX_SUPPLY_SATS, MAX_SUPPLY_SATS), '100.000000000');
  assert.equal(formatPercent(1n, 100n), '1.000000000');
  assert.equal(formatPercent(-1n, 100n), '-1.000000000');
});

test('parses a JSON payload wrapped in HTML preformatted markup', () => {
  const result = parseSourcePayload('<html><pre>{"height": 42, "total_unspendable_amount": 1.23}</pre></html>');
  assert.equal(result.payload.height, 42);
  assert.match(result.jsonText, /total_unspendable_amount/);
});

test('parses a direct JSON snapshot endpoint response', () => {
  const raw = JSON.stringify({
    height: 42,
    bestblock: '0'.repeat(64),
    total_unspendable_amount: 1.23
  });
  const result = parseSourcePayload(raw);

  assert.equal(result.payload.height, 42);
  assert.equal(result.payload.bestblock, '0'.repeat(64));
  assert.match(result.jsonText, /total_unspendable_amount/);
});

test('does not expose invalid source response contents in errors', () => {
  const sensitiveResponse = 'private-source-response-details';

  assert.throws(
    () => parseSourcePayload(`<html><pre>${sensitiveResponse}</pre></html>`),
    (error) => {
      assert.equal(error.message, 'Source did not return valid JSON');
      assert.doesNotMatch(error.message, new RegExp(sensitiveResponse));
      return true;
    }
  );
});

test('builds a short auditable daily post', () => {
  const post = buildPost({
    snapshot: {
      cutoff_utc: '2026-09-13T00:00:00.000Z',
      height: 959124,
      block_hash: '00000000000000000001da6d62c0cdda42a0e7a7e4a47005bdf257442a119d7f',
      total_unspendable_sats: '23011430264'
    },
    previousSnapshot: {
      total_unspendable_sats: '23011430200'
    }
  });

  assert.match(post, /^Provably unspendable \$BTC · Bitcoin Core/);
  assert.match(post, /Total: 230\.11430264 BTC/);
  assert.match(post, /Share of 21M BTC: 0\.001095782%/);
  assert.match(post, /Δ since previous snapshot:\n\+64 sats \(\+0\.000000278%\)/);
  assert.match(post, /Snapshot: 13 Sep 2026, 00:00 UTC/);
  assert.match(post, /Block #959124 · 0000000000…2a119d7f/);
  assert.ok(post.length <= 280);
});

test('builds a post with a negative change and percentage', () => {
  const post = buildPost({
    snapshot: {
      cutoff_utc: '2026-09-15T00:00:00.000Z',
      height: 959125,
      block_hash: '00000000000000000001da6d62c0cdda42a0e7a7e4a47005bdf257442a119d80',
      total_unspendable_sats: '99'
    },
    previousSnapshot: {
      total_unspendable_sats: '100'
    }
  });

  assert.match(post, /Δ since previous snapshot:\n-1 sat \(-1\.000000000%\)/);
  assert.ok(post.length <= 280);
});

test('formats an unchanged snapshot without a positive sign', () => {
  const post = buildPost({
    snapshot: {
      cutoff_utc: '2026-09-16T00:00:00.000Z',
      height: 959126,
      block_hash: '00000000000000000001da6d62c0cdda42a0e7a7e4a47005bdf257442a119d81',
      total_unspendable_sats: '100'
    },
    previousSnapshot: {
      total_unspendable_sats: '100'
    }
  });

  assert.match(post, /Δ since previous snapshot:\n0 sats \(0\.000000000%\)/);
  assert.ok(post.length <= 280);
});

test('keeps a one-satoshi increase visible at the current total', () => {
  const post = buildPost({
    snapshot: {
      cutoff_utc: '2026-09-17T00:00:00.000Z',
      height: 959127,
      block_hash: '00000000000000000001da6d62c0cdda42a0e7a7e4a47005bdf257442a119d82',
      total_unspendable_sats: '23011430265'
    },
    previousSnapshot: {
      total_unspendable_sats: '23011430264'
    }
  });

  assert.match(post, /Δ since previous snapshot:\n\+1 sat \(\+0\.000000004%\)/);
  assert.ok(post.length <= 280);
});

test('formats changes of at least one bitcoin using BTC and the remaining satoshis', () => {
  const post = buildPost({
    snapshot: {
      cutoff_utc: '2026-09-18T00:00:00.000Z',
      height: 959128,
      block_hash: '00000000000000000001da6d62c0cdda42a0e7a7e4a47005bdf257442a119d83',
      total_unspendable_sats: '23211430265'
    },
    previousSnapshot: {
      total_unspendable_sats: '23011430264'
    }
  });

  assert.match(post, /Δ since previous snapshot:\n\+2 BTC and 1 sat \(\+0\.869133290%\)/);
});

test('pluralizes a multi-satoshi remainder after whole bitcoins', () => {
  const post = buildPost({
    snapshot: {
      cutoff_utc: '2026-09-18T00:00:00.000Z',
      height: 959128,
      block_hash: '00000000000000000001da6d62c0cdda42a0e7a7e4a47005bdf257442a119d83',
      total_unspendable_sats: '23211430266'
    },
    previousSnapshot: {
      total_unspendable_sats: '23011430264'
    }
  });

  assert.match(post, /Δ since previous snapshot:\n\+2 BTC and 2 sats /);
});

test('omits the satoshi remainder for a whole-bitcoin change', () => {
  const post = buildPost({
    snapshot: {
      cutoff_utc: '2026-09-19T00:00:00.000Z',
      height: 959129,
      block_hash: '00000000000000000001da6d62c0cdda42a0e7a7e4a47005bdf257442a119d84',
      total_unspendable_sats: '300000000'
    },
    previousSnapshot: {
      total_unspendable_sats: '100000000'
    }
  });

  assert.match(post, /Δ since previous snapshot:\n\+2 BTC \(\+200\.000000000%\)/);
  assert.doesNotMatch(post, /and 0 sats/);
});

test('keeps eight decimal places in the total on the first snapshot', () => {
  const post = buildPost({
    snapshot: {
      cutoff_utc: '2026-09-20T00:00:00.000Z',
      height: 959130,
      block_hash: '00000000000000000001da6d62c0cdda42a0e7a7e4a47005bdf257442a119d85',
      total_unspendable_sats: '23012000000'
    },
    previousSnapshot: null
  });

  assert.match(post, /^Provably unspendable \$BTC · Bitcoin Core/);
  assert.match(post, /Total: 230\.12000000 BTC/);
  assert.match(post, /Share of 21M BTC: 0\.001095810%/);
  assert.match(post, /First snapshot — changes begin tomorrow\./);
});

test('detects a snapshot already published on the same UTC day', () => {
  const snapshot = { cutoff_utc: '2026-09-14T00:00:00.000Z' };

  assert.equal(
    isSnapshotPublishedForUtcDay(snapshot, '2026-09-14T23:59:59.999Z'),
    true
  );
  assert.equal(
    isSnapshotPublishedForUtcDay(snapshot, '2026-09-15T00:00:00.000Z'),
    false
  );
  assert.equal(isSnapshotPublishedForUtcDay(null, '2026-09-14T12:00:00.000Z'), false);
});

test('rejects invalid timestamps when checking daily publication state', () => {
  assert.throws(
    () => isSnapshotPublishedForUtcDay({ cutoff_utc: 'invalid' }, '2026-09-14T12:00:00.000Z'),
    /Invalid UTC timestamp/
  );
});

test('uses a supplied user access token without making an OAuth request', async () => {
  let called = false;
  const tokens = await getUserAccessToken({
    accessToken: 'direct-token',
    fetchImpl: async () => {
      called = true;
    }
  });

  assert.deepEqual(tokens, { accessToken: 'direct-token', refreshToken: null });
  assert.equal(called, false);
});

test('refreshes and returns the rotated OAuth tokens', async () => {
  const calls = [];
  const tokens = await getUserAccessToken({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        access_token: 'renewed-access-token',
        refresh_token: 'rotated-refresh-token'
      }), { status: 200 });
    }
  });

  assert.deepEqual(tokens, {
    accessToken: 'renewed-access-token',
    refreshToken: 'rotated-refresh-token'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.x.com/2/oauth2/token');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.authorization, `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`);
  assert.equal(calls[0].options.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(calls[0].options.body, 'grant_type=refresh_token&refresh_token=refresh-token');
});

test('retains the current refresh token when X does not rotate it', async () => {
  const tokens = await getUserAccessToken({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'current-refresh-token',
    fetchImpl: async () => new Response(JSON.stringify({
      access_token: 'renewed-access-token'
    }), { status: 200 })
  });

  assert.deepEqual(tokens, {
    accessToken: 'renewed-access-token',
    refreshToken: 'current-refresh-token'
  });
});

test('requires complete credentials when no direct token is supplied', async () => {
  await assert.rejects(
    getUserAccessToken({ clientId: 'client-id', refreshToken: 'refresh-token' }),
    /X_CLIENT_SECRET/
  );
});

test('does not expose X API response bodies in errors', async () => {
  const sensitiveResponse = 'private-upstream-response-details';

  await assert.rejects(
    getUserAccessToken({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      fetchImpl: async () => new Response(sensitiveResponse, { status: 401 })
    }),
    (error) => {
      assert.match(error.message, /^X API returned HTTP 401$/);
      assert.doesNotMatch(error.message, new RegExp(sensitiveResponse));
      return true;
    }
  );
});

test('creates a PKCE authorization request with only the bot scopes', () => {
  const request = createAuthorizationRequest({
    clientId: 'client-id',
    redirectUri: 'http://127.0.0.1:3000/callback',
    randomBytesImpl: (size) => Buffer.alloc(size, 7)
  });
  const url = new URL(request.url);

  assert.equal(url.origin + url.pathname, 'https://x.com/i/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:3000/callback');
  assert.equal(url.searchParams.get('scope'), 'tweet.read tweet.write users.read offline.access');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(request.codeVerifier.length, 64);
  assert.equal(request.state.length, 32);
});

test('exchanges an authorization code for OAuth tokens', async () => {
  const calls = [];
  const tokens = await exchangeAuthorizationCode({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    code: 'authorization-code',
    codeVerifier: 'code-verifier',
    redirectUri: 'http://127.0.0.1:3000/callback',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token'
      }), { status: 200 });
    }
  });

  assert.deepEqual(tokens, { accessToken: 'access-token', refreshToken: 'refresh-token' });
  assert.equal(calls[0].options.headers.authorization, `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`);
  assert.equal(
    calls[0].options.body,
    'grant_type=authorization_code&code=authorization-code&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fcallback&code_verifier=code-verifier'
  );
});
