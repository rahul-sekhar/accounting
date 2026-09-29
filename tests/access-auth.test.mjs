import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPair, SignJWT } from 'jose';
import {
  authenticateRequest,
  verifyAccessToken,
} from '../lib/access-auth.ts';

const issuer = 'https://account-view.cloudflareaccess.com';
const audience = 'account-view-audience';
const environment = {
  APP_ENV: 'production',
  ACCESS_TEAM_DOMAIN: issuer,
  ACCESS_AUD: audience,
};
const { privateKey, publicKey } = await generateKeyPair('RS256');
const key = async () => publicKey;

async function token(overrides = {}, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    email: 'Person@Example.COM',
    type: 'app',
    ...overrides,
  };
  const protectedHeader = { alg: 'RS256', kid: 'test-key' };
  if (options.headerType !== null) {
    protectedHeader.typ = options.headerType ?? 'JWT';
  }
  const jwt = new SignJWT(claims)
    .setProtectedHeader(protectedHeader)
    .setSubject(options.subject ?? 'stable-subject')
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setIssuedAt(now)
    .setNotBefore(options.notBefore ?? now - 1)
    .setExpirationTime(options.expiration ?? now + 60);
  return jwt.sign(options.privateKey ?? privateKey);
}

test('valid Access JWT authenticates with a stable namespaced owner ID', async () => {
  const user = await verifyAccessToken(await token(), environment, key);
  assert.deepEqual(user, {
    userId: 'cloudflare:stable-subject',
    displayName: 'person@example.com',
    email: 'person@example.com',
    fullName: null,
  });

  const withoutOptionalHeaderType = await verifyAccessToken(
    await token({}, { headerType: null }),
    environment,
    key,
  );
  assert.deepEqual(withoutOptionalHeaderType, user);
});

test('Access JWT signature, issuer, audience, and time claims fail closed', async () => {
  const otherKeys = await generateKeyPair('RS256');
  const invalidTokens = [
    'not-a-jwt',
    await token({}, { privateKey: otherKeys.privateKey }),
    await token({}, { issuer: 'https://other.cloudflareaccess.com' }),
    await token({}, { audience: 'another-app' }),
    await token({}, { expiration: Math.floor(Date.now() / 1000) - 1 }),
    await token({}, { notBefore: Math.floor(Date.now() / 1000) + 60 }),
  ];

  for (const jwt of invalidTokens) {
    await assert.rejects(() => verifyAccessToken(jwt, environment, key));
  }
});

test('non-interactive and incomplete Access claims are rejected', async () => {
  const invalidTokens = [
    await token({ type: 'org' }),
    await token({ email: '' }),
    await token({ service_token_status: true }),
    await token({ service_token_id: 'service-id' }),
    await token({ common_name: 'client.access' }),
    await token({}, { subject: '' }),
  ];

  for (const jwt of invalidTokens) {
    await assert.rejects(() => verifyAccessToken(jwt, environment, key));
  }
});

test('missing, malformed, and tampered assertion headers remain anonymous', async () => {
  const missing = await authenticateRequest(new Headers({ host: 'app.example' }), environment);
  assert.equal(missing, null);

  for (const assertion of ['malformed', `${await token()}tampered`]) {
    const user = await authenticateRequest(
      new Headers({
        host: 'app.example',
        'cf-access-jwt-assertion': assertion,
      }),
      environment,
      (jwt, authEnvironment) => verifyAccessToken(jwt, authEnvironment, key),
    );
    assert.equal(user, null);
  }
});

test('development identity is available only with explicit loopback configuration', async () => {
  const local = {
    APP_ENV: 'development',
    LOCAL_AUTH_ENABLED: 'true',
    LOCAL_AUTH_USER_ID: 'qa-user',
    LOCAL_AUTH_EMAIL: 'QA@Example.test',
    LOCAL_AUTH_NAME: 'QA User',
  };
  const user = await authenticateRequest(
    new Headers({ host: 'localhost:3000' }),
    local,
  );
  assert.deepEqual(user, {
    userId: 'local:qa-user',
    displayName: 'QA User',
    email: 'qa@example.test',
    fullName: 'QA User',
  });

  assert.equal(
    await authenticateRequest(new Headers({ host: 'app.example' }), local),
    null,
  );
  assert.equal(
    await authenticateRequest(new Headers({ host: '127.0.0.1:3000' }), {
      ...local,
      APP_ENV: 'production',
    }),
    null,
  );
  assert.equal(
    await authenticateRequest(new Headers({ host: '127.0.0.1:3000' }), {
      ...local,
      LOCAL_AUTH_ENABLED: 'false',
    }),
    null,
  );
  assert.equal(
    await authenticateRequest(
      new Headers({
        host: 'localhost:3000',
        'x-account-view-local-auth': 'disabled',
      }),
      local,
    ),
    null,
  );
});

test('invalid or missing production Access configuration fails closed', async () => {
  const assertion = await token();
  for (const brokenEnvironment of [
    { APP_ENV: 'production', ACCESS_AUD: audience },
    {
      APP_ENV: 'production',
      ACCESS_TEAM_DOMAIN: 'http://account-view.cloudflareaccess.com',
      ACCESS_AUD: audience,
    },
    {
      APP_ENV: 'production',
      ACCESS_TEAM_DOMAIN: issuer,
    },
  ]) {
    const user = await authenticateRequest(
      new Headers({
        host: 'app.example',
        'cf-access-jwt-assertion': assertion,
      }),
      brokenEnvironment,
      (jwt, authEnvironment) => verifyAccessToken(jwt, authEnvironment, key),
    );
    assert.equal(user, null);
  }
});
