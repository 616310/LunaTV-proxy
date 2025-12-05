/* eslint-disable no-console */

const DEFAULT_PROXY_PATH =
  process.env.NEXT_PUBLIC_STREAM_PROXY_PATH?.trim() ||
  process.env.STREAM_PROXY_PATH?.trim() ||
  '/api/proxy';

const PROXY_PARAM = 'url=';

export function getProxyPath() {
  return DEFAULT_PROXY_PATH;
}

function isAlreadyProxied(url: string) {
  if (!url) return true;
  const proxyPath = getProxyPath();
  return url.includes(proxyPath) && url.includes(PROXY_PARAM);
}

export function buildProxyUrl(
  targetUrl: string,
  type: 'manifest' | 'segment' = 'segment'
): string {
  if (!targetUrl || isAlreadyProxied(targetUrl)) {
    return targetUrl;
  }
  const base = getProxyPath();
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}type=${type}&url=${encodeURIComponent(targetUrl)}`;
}

export function wrapEpisodesWithProxy(episodes: string[]): string[] {
  if (!Array.isArray(episodes) || episodes.length === 0) {
    return episodes;
  }
  return episodes.map((episodeUrl) => buildProxyUrl(episodeUrl, 'manifest'));
}
