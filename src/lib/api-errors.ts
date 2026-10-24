import { NextResponse } from 'next/server';
import { redactSecrets } from './fetcher';

export function invalidRequest() {
  return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
}

export function failedRequest(status = 500) {
  return NextResponse.json({ error: 'Request failed' }, { status });
}

export function logUpstreamError(scope: string, error: unknown): void {
  const message = error instanceof Error ? redactSecrets(error.message) : 'Unknown error';
  console.error(`${scope}: ${message}`);
}
