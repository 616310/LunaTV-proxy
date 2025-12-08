/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';

import {
  fetchWithDispatcher,
  getDownloadConcurrency,
} from '@/lib/http-client';
import { getProxyPath } from '@/lib/proxy-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_PROTOCOLS = ['http:', 'https:'];
const SEGMENT_CONCURRENCY = getDownloadConcurrency();

function normalizeNestedUrl(raw: string | null): string | null {
  if (!raw) return null;
  let current = raw.trim();
  if (!current) return null;

  const isHttp = (value: string) =>
    value.startsWith('http://') || value.startsWith('https://');

  for (let i = 0; i < 3; i += 1) {
    if (isHttp(current)) {
      return current;
    }
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        break;
      }
      current = decoded;
    } catch {
      break;
    }
  }

  return isHttp(current) ? current : null;
}

function extractUpstreamUrl(
  raw: string,
  request: NextRequest
): URL | null {
  try {
    const base = request.nextUrl.origin;
    const absolute = raw.startsWith('http')
      ? new URL(raw)
      : new URL(raw, base);
    const proxyPath = getProxyPath();
    if (
      proxyPath &&
      absolute.pathname.startsWith(proxyPath) &&
      absolute.searchParams.has('url')
    ) {
      const resolved = normalizeNestedUrl(absolute.searchParams.get('url'));
      if (!resolved) {
        return null;
      }
      return new URL(resolved);
    }
    return absolute;
  } catch {
    return null;
  }
}

function pickHeaders(request: NextRequest, target: URL) {
  const headers = new Headers();
  const forwardKeys = ['user-agent', 'accept', 'accept-language'];
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

function parseManifest(
  manifest: string,
  baseUrl: URL
): {
  segments: string[];
  variants: { url: string; bandwidth: number }[];
} {
  const lines = manifest.split(/\r?\n/);
  const segments: string[] = [];
  const variants: { url: string; bandwidth: number }[] = [];
  let currentBandwidth = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
      currentBandwidth = bandwidthMatch ? Number(bandwidthMatch[1]) : 0;
      continue;
    }
    if (line.startsWith('#')) continue;
    const resolved = new URL(line, baseUrl).toString();
    if (line.endsWith('.m3u8')) {
      variants.push({ url: resolved, bandwidth: currentBandwidth });
      continue;
    }
    segments.push(resolved);
  }

  return { segments, variants };
}

async function collectSegments(
  upstreamUrl: URL,
  request: NextRequest,
  depth = 0
): Promise<string[]> {
  if (depth > 2) {
    throw new Error('Manifest nesting too deep');
  }

  const manifestResponse = await fetchWithDispatcher(upstreamUrl, {
    headers: pickHeaders(request, upstreamUrl),
    signal: request.signal,
  });
  if (!manifestResponse.ok) {
    throw new Error(`Manifest fetch failed: ${manifestResponse.status}`);
  }
  const text = await manifestResponse.text();
  const parsed = parseManifest(text, upstreamUrl);
  if (parsed.segments.length > 0) {
    return parsed.segments;
  }
  if (parsed.variants.length > 0) {
    parsed.variants.sort((a, b) => b.bandwidth - a.bandwidth);
    const nextUrl = new URL(parsed.variants[0].url);
    return collectSegments(nextUrl, request, depth + 1);
  }
  throw new Error('未找到可下载的分片');
}

function streamSegmentsWithPrefetch(
  segments: string[],
  request: NextRequest
) {
  const concurrency = SEGMENT_CONCURRENCY;
  const bufferMap = new Map<number, Uint8Array[]>();
  const upstreamAbort = new AbortController();
  let cleanupRef: (() => void) | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let nextToFetch = 0;
      let nextToStream = 0;
      let active = 0;
      let closed = false;
      let failed = false;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener('abort', requestAbort);
        upstreamAbort.abort();
        bufferMap.clear();
        cleanupRef = null;
      };
      cleanupRef = cleanup;

      const requestAbort = () => {
        if (closed) return;
        cleanup();
        controller.error(new DOMException('Aborted', 'AbortError'));
      };

      request.signal.addEventListener('abort', requestAbort);

      const flush = () => {
        if (failed) return;
        while (bufferMap.has(nextToStream)) {
          const chunks = bufferMap.get(nextToStream);
          if (!chunks) {
            break;
          }
          bufferMap.delete(nextToStream);
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          nextToStream += 1;
        }
        if (
          nextToStream >= segments.length &&
          active === 0 &&
          !closed &&
          !failed
        ) {
          cleanup();
          controller.close();
        }
      };

      const schedule = () => {
        if (failed) return;
        while (
          active < concurrency &&
          nextToFetch < segments.length
        ) {
          const index = nextToFetch;
          nextToFetch += 1;
          active += 1;
          void downloadSegment(index);
        }
        if (
          !failed &&
          active === 0 &&
          nextToFetch >= segments.length
        ) {
          flush();
        }
      };

      const downloadSegment = async (index: number) => {
        try {
          const segmentUrl = new URL(segments[index]);
          const response = await fetchWithDispatcher(segmentUrl, {
            headers: pickHeaders(request, segmentUrl),
            signal: upstreamAbort.signal,
          });
          if (!response.ok || !response.body) {
            throw new Error(`分片下载失败: ${segmentUrl}`);
          }
          const reader = response.body.getReader();
          const collected: Uint8Array[] = [];
          let readerDone = false;
          while (!readerDone) {
            const { value, done } = await reader.read();
            if (done) {
              readerDone = true;
              break;
            }
            if (value) {
              collected.push(value);
            }
          }
          bufferMap.set(index, collected);
          flush();
        } catch (error) {
          if (!failed) {
            failed = true;
            cleanup();
            const reason =
              error instanceof Error
                ? error
                : new Error('分片下载失败');
            controller.error(reason);
          }
        } finally {
          active -= 1;
          if (!failed) {
            schedule();
          }
        }
      };

      schedule();
    },
    cancel() {
      upstreamAbort.abort();
      cleanupRef?.();
    },
  });
}

function buildDisposition(filename: string, extension: string) {
  const base = filename || 'lunatv';
  const asciiFallback =
    Array.from(base)
      .map((char) => (char.charCodeAt(0) <= 0x7f ? char : '_'))
      .join('') || 'lunatv';
  const encoded = encodeURIComponent(base);
  const normalizedExt = extension.startsWith('.') ? extension : `.${extension}`;
  return `attachment; filename="${asciiFallback}${normalizedExt}"; filename*=UTF-8''${encoded}${normalizedExt}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const urlParam = searchParams.get('url');
  const filenameParam = searchParams.get('filename') || 'lunatv';

  if (!urlParam) {
    return NextResponse.json(
      { error: '缺少 url 参数' },
      { status: 400 }
    );
  }

  const upstreamUrl = extractUpstreamUrl(urlParam, request);
  if (!upstreamUrl || !ALLOWED_PROTOCOLS.includes(upstreamUrl.protocol)) {
    return NextResponse.json({ error: '无效的 url' }, { status: 400 });
  }

  const extension = path.extname(upstreamUrl.pathname).toLowerCase();
  const headers = new Headers();

  if (extension === '.m3u8') {
    try {
      const segments = await collectSegments(upstreamUrl, request);
      const stream = streamSegmentsWithPrefetch(segments, request);
      headers.set(
        'content-disposition',
        buildDisposition(filenameParam, '.ts')
      );
      headers.set('content-type', 'video/mp2t');
      headers.set('cache-control', 'no-cache');
      return new NextResponse(stream, { headers });
    } catch (error) {
      console.error('下载失败:', error);
      return NextResponse.json(
        { error: '下载失败', detail: (error as Error).message },
        { status: 502 }
      );
    }
  }

  try {
    const upstreamResponse = await fetchWithDispatcher(upstreamUrl, {
      headers: pickHeaders(request, upstreamUrl),
      signal: request.signal,
    });
    if (!upstreamResponse.ok) {
      return NextResponse.json(
        { error: `上游返回 ${upstreamResponse.status}` },
        { status: upstreamResponse.status }
      );
    }

    const downloadExt = extension || '.bin';
    headers.set(
      'content-disposition',
      buildDisposition(filenameParam, downloadExt)
    );
    const contentType = upstreamResponse.headers.get('content-type');
    if (contentType) {
      headers.set('content-type', contentType);
    } else {
      headers.set('content-type', 'application/octet-stream');
    }
    headers.set('cache-control', 'no-cache');
    return new NextResponse(upstreamResponse.body, {
      headers,
      status: upstreamResponse.status,
    });
  } catch (error) {
    console.error('下载失败:', error);
    return NextResponse.json(
      { error: '下载失败' },
      { status: 502 }
    );
  }
}
