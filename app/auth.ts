import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  authenticateRequest,
  type AuthEnvironment,
  type AuthUser,
} from '@/lib/access-auth';

export type { AuthUser } from '@/lib/access-auth';

export async function getAuthUser(): Promise<AuthUser | null> {
  return authenticateRequest(
    await headers(),
    env as unknown as AuthEnvironment,
  );
}

export async function requireAuthUser(_returnTo: string): Promise<AuthUser> {
  const user = await getAuthUser();
  if (user) return user;

  // Access normally challenges unauthenticated requests before they reach the
  // Worker. If its assertion is absent or invalid, clear the application
  // session rather than accepting unverified identity headers.
  redirect(accessLogoutPath());
}

export function accessLogoutPath(): string {
  return '/cdn-cgi/access/logout';
}
