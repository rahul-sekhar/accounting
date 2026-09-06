import { getChatGPTUser } from '@/app/chatgpt-auth';
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function identity(request?: Request) {
  const user = await getChatGPTUser();
  if (!user) throw new AppError('Please sign in to access your accounts.', 401);
  if (request && request.method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin)
      throw new AppError(
        'This request must come from your account workspace.',
        403,
      );
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new AppError('Expected JSON.', 415);
  }
  return user;
}
export async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('Missing request body.');
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 6_000_000) {
      await reader.cancel();
      throw new AppError('This import is too large.', 413);
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    all.set(p, offset);
    offset += p.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    throw new AppError('Invalid request body.');
  }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export function failure(error: unknown) {
  if (error instanceof AppError)
    return json({ error: error.message }, error.status);
  return json(
    { error: 'The request could not be completed. Please try again.' },
    500,
  );
}
export function textValue(value: unknown, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new AppError('Please check the required fields.');
  return value.trim();
}
