const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

const csrfToken = (): string | undefined => document.cookie.split('; ').find((cookie) => cookie.startsWith('clipforge_csrf='))?.split('=').slice(1).join('=');

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) { super(message); }
}

export const api = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(init.method ?? 'GET')) {
    const token = csrfToken();
    if (token) headers.set('x-csrf-token', decodeURIComponent(token));
  }
  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers, credentials: 'include' });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string; details?: unknown } } | T | null;
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(response.status, error?.code ?? 'REQUEST_FAILED', error?.message ?? 'The request could not be completed.', error?.details);
  }
  return body as T;
};

export const post = <T>(path: string, body?: unknown): Promise<T> => api<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown): Promise<T> => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = (path: string): Promise<void> => api<void>(path, { method: 'DELETE' });

export const upload = <T>(path: string, body: FormData, onProgress: (percent: number) => void): Promise<T> => new Promise((resolve, reject) => {
  const request = new XMLHttpRequest();
  request.open('POST', `${BASE_URL}${path}`);
  request.withCredentials = true;
  const token = csrfToken();
  if (token) request.setRequestHeader('x-csrf-token', decodeURIComponent(token));
  request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
  request.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'The upload could not reach the server.'));
  request.onload = () => {
    const response = (() => { try { return JSON.parse(request.responseText) as { error?: { code?: string; message?: string; details?: unknown } } & T; } catch { return null; } })();
    if (request.status >= 200 && request.status < 300 && response) { resolve(response as T); return; }
    const error = response?.error;
    reject(new ApiError(request.status, error?.code ?? 'REQUEST_FAILED', error?.message ?? 'The upload could not be completed.', error?.details));
  };
  request.send(body);
});
