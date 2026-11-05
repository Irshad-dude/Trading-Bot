import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
const DEFAULT_TIMEOUT_MS = 4000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const pathStr = path.join('/');
  const queryStr = req.nextUrl.search;
  const targetUrl = `${BACKEND_URL}/api/${pathStr}${queryStr}`;

  try {
    const res = await fetch(targetUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    const msg = error instanceof Error ? error.message : 'Backend unreachable';
    return NextResponse.json(
      {
        error: isTimeout ? 'Backend request timed out' : msg,
        path: pathStr,
        status: isTimeout ? 504 : 502,
        timestamp: new Date().toISOString(),
      },
      { status: isTimeout ? 504 : 502 }
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const pathStr = path.join('/');
  const targetUrl = `${BACKEND_URL}/api/${pathStr}`;

  try {
    const body = await req.json().catch(() => ({}));
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    const msg = error instanceof Error ? error.message : 'Backend unreachable';
    return NextResponse.json(
      {
        error: isTimeout ? 'Backend request timed out' : msg,
        path: pathStr,
        status: isTimeout ? 504 : 502,
        timestamp: new Date().toISOString(),
      },
      { status: isTimeout ? 504 : 502 }
    );
  }
}
