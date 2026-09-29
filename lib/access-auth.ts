import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from 'jose';

export type AuthUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

export type AuthEnvironment = {
  APP_ENV?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  LOCAL_AUTH_ENABLED?: string;
  LOCAL_AUTH_USER_ID?: string;
  LOCAL_AUTH_EMAIL?: string;
  LOCAL_AUTH_NAME?: string;
};

type VerifyAccessJwt = (
  token: string,
  environment: AuthEnvironment,
) => Promise<AuthUser>;

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

export async function authenticateRequest(
  requestHeaders: Headers,
  environment: AuthEnvironment,
  verifyJwt: VerifyAccessJwt = verifyAccessToken,
): Promise<AuthUser | null> {
  if (
    environment.APP_ENV === 'development' &&
    requestHeaders.get('x-account-view-local-auth') === 'disabled'
  ) {
    return null;
  }

  try {
    const localUser = localDevelopmentUser(requestHeaders, environment);
    if (localUser) return localUser;
  } catch {
    return null;
  }

  const token = requestHeaders.get('cf-access-jwt-assertion')?.trim();
  if (!token) {
    console.warn('[access-auth] assertion header missing');
    return null;
  }

  try {
    return await verifyJwt(token, environment);
  } catch (error) {
    console.warn('[access-auth] assertion rejected', authFailureCode(error));
    return null;
  }
}

function authFailureCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'UNKNOWN';

  const code = Reflect.get(error, 'code');
  if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) return code;

  const safeMessageCodes = new Map<string, string>([
    ['Invalid token format', 'INVALID_TOKEN_FORMAT'],
    ['Invalid Access token type', 'INVALID_TOKEN_TYPE'],
    [
      'Service tokens cannot represent an interactive user',
      'SERVICE_TOKEN_REJECTED',
    ],
    ['Missing Access audience', 'MISSING_ACCESS_AUDIENCE'],
    ['Missing Access team domain', 'MISSING_ACCESS_TEAM_DOMAIN'],
    ['Invalid Access team domain', 'INVALID_ACCESS_TEAM_DOMAIN'],
    ['Invalid subject', 'INVALID_SUBJECT'],
    ['Invalid email', 'INVALID_EMAIL'],
  ]);
  const message = Reflect.get(error, 'message');
  if (typeof message === 'string') {
    const safeCode = safeMessageCodes.get(message);
    if (safeCode) return safeCode;
  }

  const name = Reflect.get(error, 'name');
  if (typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
    return name;
  }

  return 'UNKNOWN';
}

export async function verifyAccessToken(
  token: string,
  environment: AuthEnvironment,
  key?: JWTVerifyGetKey,
): Promise<AuthUser> {
  const issuer = accessIssuer(environment.ACCESS_TEAM_DOMAIN);
  const audience = requiredValue(environment.ACCESS_AUD, 'Access audience');
  const verificationKey = key ?? remoteKeySet(issuer);
  const { payload } = await jwtVerify(token, verificationKey, {
    algorithms: ['RS256'],
    audience,
    issuer,
  });

  return userFromAccessPayload(payload);
}

function userFromAccessPayload(payload: JWTPayload): AuthUser {
  if (payload.type !== 'app') throw new Error('Invalid Access token type');
  if (
    payload.service_token_id ||
    payload.service_token_status === true ||
    (typeof payload.common_name === 'string' &&
      payload.common_name.endsWith('.access'))
  ) {
    throw new Error('Service tokens cannot represent an interactive user');
  }

  const subject = requiredClaim(payload.sub, 'subject', 512);
  const email = normalizeEmail(payload.email);
  const fullName = optionalDisplayName(payload.name);

  return {
    userId: `cloudflare:${subject}`,
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

function localDevelopmentUser(
  requestHeaders: Headers,
  environment: AuthEnvironment,
): AuthUser | null {
  if (
    environment.APP_ENV !== 'development' ||
    environment.LOCAL_AUTH_ENABLED !== 'true' ||
    !isLoopbackHost(requestHeaders.get('host'))
  ) {
    return null;
  }

  const subject = requiredClaim(
    environment.LOCAL_AUTH_USER_ID,
    'local user ID',
    512,
  );
  const email = normalizeEmail(environment.LOCAL_AUTH_EMAIL);
  const fullName = optionalDisplayName(environment.LOCAL_AUTH_NAME);

  return {
    userId: `local:${subject}`,
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

function remoteKeySet(issuer: string): JWTVerifyGetKey {
  let keySet = remoteKeySets.get(issuer);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer));
    remoteKeySets.set(issuer, keySet);
  }
  return keySet;
}

function accessIssuer(value: string | undefined): string {
  const configured = requiredValue(value, 'Access team domain');
  const url = new URL(configured);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !url.hostname.endsWith('.cloudflareaccess.com')
  ) {
    throw new Error('Invalid Access team domain');
  }
  return url.origin;
}

function isLoopbackHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  try {
    const hostname = new URL(`http://${hostHeader}`).hostname;
    return (
      hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

function requiredValue(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing ${label}`);
  return normalized;
}

function requiredClaim(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maxLength ||
    hasControlCharacters(value)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value.trim();
}

function normalizeEmail(value: unknown): string {
  const email = requiredClaim(value, 'email', 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('Invalid email');
  return email;
}

function optionalDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (
    !normalized ||
    normalized.length > 200 ||
    hasControlCharacters(normalized)
  ) {
    return null;
  }
  return normalized;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}
