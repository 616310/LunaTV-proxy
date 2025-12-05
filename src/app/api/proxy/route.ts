/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { buildProxyUrl } from '@/lib/proxy-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

function resolveUrl(raw: string, base: URL) {
  try {
    return new URL(raw, base).toString();
  } catch {
    return raw;
  }
}

function rewriteManifest(content: string, upstreamUrl: URL) {
  const lines = content.split(/\r?\n/);
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line;
      }
      if (trimmed.startsWith('#EXT-X-KEY')) {
        return line.replace(/URI="([^"]+)"/, (_, uri) => {
          const resolved = resolveUrl(uri, upstreamUrl);
          const proxied = buildProxyUrl(resolved, 'segment');
          return `URI="${proxied}"`;
        });
      }
      if (trimmed.startsWith('#')) {
        return line;
      }
      const resolved = resolveUrl(trimmed, upstreamUrl);
      const type = resolved.endsWith('.m3u8') ? 'manifest' : 'segment';
      return buildProxyUrl(resolved, type);
    })
    .join('\n');
}

function pickHeaders(request: NextRequest, target: URL) {
  const headers = new Headers();
  const forwardKeys = [
    'user-agent',
    'accept',
    'accept-language',
    'range',
    'accept-encoding',
  ];
  forwardKeys.forEach((key) => {
    const value = request.headers.get(key);
    if (value) {
      headers.set(key, value);
    }
  });
  headers.set('host', target.host);
  headers.set('referer', `${target.origin}/`);
  headers.set('origin', target.origin);
  return headers;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const urlParam = searchParams.get('url');
  if (!urlParam) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(urlParam);
  } catch {
    return NextResponse.json({ error: 'Invalid url parameter' }, { status: 400 });
  }

  if (!ALLOWED_PROTOCOLS.includes(upstreamUrl.protocol)) {
    return NextResponse.json(
      { error: 'Protocol not allowed' },
      { status: 400 }
    );
  }

  const type = (searchParams.get('type') || 'segment') as
    | 'segment'
    | 'manifest';

  try {
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: pickHeaders(request, upstreamUrl),
    });

    if (!upstreamResponse.ok) {
      if (type === 'segment') {
        return NextResponse.json(
          { error: `Upstream error ${upstreamResponse.status}` },
          { status: upstreamResponse.status }
        );
      }
      return NextResponse.json(
        { error: `Manifest upstream error ${upstreamResponse.status}` },
        { status: upstreamResponse.status }
      );
    }

    if (type === 'manifest') {
      const manifest = await upstreamResponse.text();
      const rewritten = rewriteManifest(manifest, upstreamUrl);
      const headers = new Headers();
      headers.set(
        'content-type',
        'application/vnd.apple.mpegurl; charset=utf-8'
      );
      headers.set('cache-control', 'private, max-age=5');
      return new NextResponse(rewritten, { headers });
    }

    const headers = new Headers();
    const contentType = upstreamResponse.headers.get('content-type');
    if (contentType) {
      headers.set('content-type', contentType);
    }
    const acceptRanges = upstreamResponse.headers.get('accept-ranges');
    if (acceptRanges) {
      headers.set('accept-ranges', acceptRanges);
    }
    const contentRange = upstreamResponse.headers.get('content-range');
    if (contentRange) {
      headers.set('content-range', contentRange);
    }
    headers.set('cache-control', 'private, max-age=5');
    return new NextResponse(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers,
    });
  } catch (error) {
    console.error('Proxy request failed:', error);
    return NextResponse.json(
      { error: 'Proxy request failed' },
      { status: 502 }
    );
  }
}
