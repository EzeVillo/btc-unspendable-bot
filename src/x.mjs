import { createHash, randomBytes } from 'node:crypto';

const tokenEndpoint = 'https://api.x.com/2/oauth2/token';
const postEndpoint = 'https://api.x.com/2/tweets';
const botScopes = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];

function requireValue(value, name) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function responseText(response) {
  if (!response.ok) {
    throw new Error(`X API returned HTTP ${response.status}`);
  }
  return response.text();
}

function basicAuthorization(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

function parseTokenResponse(body, { requireRefreshToken = false } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('X OAuth token response was not valid JSON');
  }
  if (!parsed?.access_token || typeof parsed.access_token !== 'string') {
    throw new Error('X OAuth token response did not contain an access token');
  }
  if (requireRefreshToken && (!parsed.refresh_token || typeof parsed.refresh_token !== 'string')) {
    throw new Error('X OAuth token response did not contain a refresh token');
  }
  return parsed;
}

export function createAuthorizationRequest({
  clientId,
  redirectUri,
  randomBytesImpl = randomBytes
}) {
  const id = requireValue(clientId, 'X_CLIENT_ID');
  const callback = requireValue(redirectUri, 'X_REDIRECT_URI');
  const codeVerifier = randomBytesImpl(48).toString('base64url');
  const state = randomBytesImpl(24).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: callback,
    scope: botScopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  return {
    codeVerifier,
    state,
    url: `https://x.com/i/oauth2/authorize?${params}`
  };
}

export async function exchangeAuthorizationCode({
  clientId,
  clientSecret,
  code,
  codeVerifier,
  redirectUri,
  fetchImpl = fetch
}) {
  const id = requireValue(clientId, 'X_CLIENT_ID');
  const secret = requireValue(clientSecret, 'X_CLIENT_SECRET');
  const authorizationCode = requireValue(code, 'authorization code');
  const verifier = requireValue(codeVerifier, 'PKCE code verifier');
  const callback = requireValue(redirectUri, 'X_REDIRECT_URI');
  const response = await fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers: {
      authorization: basicAuthorization(id, secret),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: callback,
      code_verifier: verifier
    }).toString()
  });
  const parsed = parseTokenResponse(await responseText(response), { requireRefreshToken: true });
  return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token };
}

/**
 * Returns a short-lived OAuth 2.0 user token. A supplied direct token is
 * retained for local, one-off runs; scheduled runs should use a refresh token.
 */
export async function getUserAccessToken({
  accessToken,
  clientId,
  clientSecret,
  refreshToken,
  fetchImpl = fetch
}) {
  if (accessToken) {
    return { accessToken, refreshToken: null };
  }

  const id = requireValue(clientId, 'X_CLIENT_ID');
  const secret = requireValue(clientSecret, 'X_CLIENT_SECRET');
  const refresh = requireValue(refreshToken, 'X_REFRESH_TOKEN');
  const response = await fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers: {
      authorization: basicAuthorization(id, secret),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh
    }).toString()
  });
  const body = await responseText(response);
  const parsed = parseTokenResponse(body);

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? refresh
  };
}

export async function createXPost({ text, accessToken, fetchImpl = fetch }) {
  const response = await fetchImpl(postEndpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ text })
  });
  const body = await responseText(response);

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('X post response was not valid JSON');
  }
  if (!parsed?.data?.id) {
    throw new Error('X API response did not contain a post id');
  }
  return parsed.data.id;
}
