// Resilient fetch wrapper with retry, backoff, and error handling

interface FetchOptions extends RequestInit {
  retries?: number;
  backoffMs?: number;
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
  const { retries = 3, backoffMs = 1000, ...fetchOptions } = options;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);

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
      if (attempt === retries) throw error;
      await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt)));
    }
  }

  throw new Error(`Failed after ${retries + 1} attempts: ${url}`);
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
