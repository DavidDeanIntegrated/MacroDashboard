// Resilient fetch wrapper with retry, backoff, and error handling

import { config } from './config';

interface FetchOptions extends RequestInit {
  retries?: number;
  backoffMs?: number;
  timeoutMs?: number;
}

// Strip provider credentials from a URL or error string before it is logged.
export function redactSecrets(value: string): string {
  let out = value.replace(/([?&#](?:api_key|apikey|token|access_token)=)[^&#\s]*/gi, '$1REDACTED');
  const secrets = [
    config.polygon.apiKey,
    config.fred.apiKey,
    config.finnhub.apiKey,
    config.alpaca.apiKey,
    config.alpaca.apiSecret,
  ];
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('REDACTED');
  }
  return out;
}

// Encode one relative or absolute path so caller-supplied text cannot add segments.
export function encodeUpstreamPath(path: string): string {
  if (!path.startsWith('/')) throw new Error('Invalid path');
  const parts = path.split('/');
  return parts.map((part, index) => {
    if (index === 0) return '';
    if (part === '' || part === '.' || part === '..') throw new Error('Invalid path segment');
    return encodeURIComponent(part);
  }).join('/');
}

// Encode a relative path that may contain subdirectories (EDGAR primary documents).
// Returns null when a segment would escape the directory.
export function encodeUpstreamRelative(value: string): string | null {
  if (!value || /[\\?#]/.test(value)) return null;
  const parts = value.split('/').filter((part) => part.length > 0);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) return null;
  return parts.map((part) => encodeURIComponent(part)).join('/');
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public provider: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function resilientFetch(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { retries = 3, backoffMs = 1000, timeoutMs = 10000, ...fetchOptions } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        ...fetchOptions,
        signal: fetchOptions.signal || controller.signal,
      }).finally(() => clearTimeout(timeout));

      // Rate limited — back off and retry
      if (response.status === 429 && attempt < retries) {
        const retryAfter = response.headers.get('Retry-After');
        const waitMs = retryAfter
          ? parseInt(retryAfter) * 1000
          : backoffMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      return response;
    } catch (error) {
      if (attempt === retries) {
        const detail = error instanceof Error ? redactSecrets(error.message) : 'request failed';
        throw new Error(`Failed after ${retries + 1} attempts: ${redactSecrets(url)} (${detail})`);
      }
      await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt)));
    }
  }

  throw new Error(`Failed after ${retries + 1} attempts: ${redactSecrets(url)}`);
}

export async function fetchJson<T>(
  url: string,
  options: FetchOptions & { provider?: string } = {}
): Promise<T> {
  const { provider = 'unknown', ...fetchOptions } = options;
  const response = await resilientFetch(url, fetchOptions);

  if (!response.ok) {
    throw new ApiError(
      `${provider} API error: ${response.status} ${response.statusText}`,
      response.status,
      provider
    );
  }

  return response.json() as Promise<T>;
}
