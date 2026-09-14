import http from 'node:http';
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode
} from './x.mjs';

const redirectUri = process.env.X_REDIRECT_URI ?? 'http://127.0.0.1:3000/callback';
const callback = new URL(redirectUri);

if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1') {
  throw new Error('X_REDIRECT_URI must be an http://127.0.0.1 callback URL for local authorization');
}

const authorization = createAuthorizationRequest({
  clientId: process.env.X_CLIENT_ID,
  redirectUri
});

function waitForAuthorizationCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url, redirectUri);
      if (requestUrl.pathname !== callback.pathname) {
        response.writeHead(404).end('Not found');
        return;
      }
      if (requestUrl.searchParams.get('state') !== authorization.state) {
        response.writeHead(400).end('Invalid OAuth state. You can close this window.');
        reject(new Error('X OAuth callback state did not match'));
        server.close();
        return;
      }
      const error = requestUrl.searchParams.get('error');
      if (error) {
        response.writeHead(400).end('Authorization was not completed. You can close this window.');
        reject(new Error(`X OAuth authorization failed: ${error}`));
        server.close();
        return;
      }
      const code = requestUrl.searchParams.get('code');
      if (!code) {
        response.writeHead(400).end('Missing authorization code. You can close this window.');
        reject(new Error('X OAuth callback did not include an authorization code'));
        server.close();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Authorization received. Return to your terminal.');
      resolve({ code, close: () => server.close() });
    });
    server.once('error', reject);
    server.listen(Number(callback.port || 80), callback.hostname, () => {
      console.log('Open this URL in the browser where the posting X account is signed in:\n');
      console.log(authorization.url);
      console.log('\nWaiting for X authorization callback...');
    });
  });
}

const { code, close } = await waitForAuthorizationCode();
try {
  const { refreshToken } = await exchangeAuthorizationCode({
    clientId: process.env.X_CLIENT_ID,
    clientSecret: process.env.X_CLIENT_SECRET,
    code,
    codeVerifier: authorization.codeVerifier,
    redirectUri
  });
  console.log('\nAuthorization complete. Create or replace this GitHub Actions secret:');
  console.log('X_REFRESH_TOKEN');
  console.log('\nIts value follows. Copy it directly into GitHub Secrets; do not commit it or share it:');
  console.log(refreshToken);
} finally {
  close();
}
