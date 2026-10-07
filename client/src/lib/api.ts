import type { SessionUser } from './types';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionChange: ((user: SessionUser | null) => void) | null = null;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function setSessionListener(fn: (user: SessionUser | null) => void) {
  onSessionChange = fn;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

/** Uses the httpOnly refresh cookie to get a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok || r.status === 204) {
        accessToken = null;
        onSessionChange?.(null);
        return false;
      }
      const data = (await r.json()) as { accessToken: string; user: SessionUser };
      accessToken = data.accessToken;
      onSessionChange?.(data.user);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function raw(method: string, path: string, body?: unknown, retry = true): Promise<Response> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return raw(method, path, body, false);
  }
  return res;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await raw(method, path, body);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  /** Authenticated file download as an object URL (for receipts behind auth). */
  blobUrl: async (path: string) => {
    const res = await raw('GET', path);
    if (!res.ok) throw new ApiError(res.status, 'Could not load file');
    return URL.createObjectURL(await res.blob());
  },
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
