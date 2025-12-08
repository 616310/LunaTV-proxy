import { Agent } from 'undici';

const CONNECT_TIMEOUT =
  Number(process.env.HTTP_CONNECT_TIMEOUT ?? 10_000);
const KEEP_ALIVE_TIMEOUT =
  Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT ?? 60_000);
const KEEP_ALIVE_MAX_TIMEOUT =
  Number(process.env.HTTP_KEEP_ALIVE_MAX_TIMEOUT ?? 60_000);

export const sharedDispatcher = new Agent({
  connectTimeout: CONNECT_TIMEOUT,
  keepAliveTimeout: KEEP_ALIVE_TIMEOUT,
  keepAliveMaxTimeout: KEEP_ALIVE_MAX_TIMEOUT,
  pipelining: Number(process.env.HTTP_PIPELINING ?? 1),
});

export type DispatcherRequestInit = RequestInit & {
  dispatcher?: Agent;
};

export function fetchWithDispatcher(
  input: RequestInfo | URL,
  init: DispatcherRequestInit = {}
) {
  const merged: DispatcherRequestInit = {
    dispatcher: sharedDispatcher,
    ...init,
  };
  return fetch(input, merged as RequestInit);
}

export function getDownloadConcurrency() {
  const raw = Number(process.env.DOWNLOAD_SEGMENT_CONCURRENCY ?? 4);
  return Number.isNaN(raw) || raw < 1 ? 1 : Math.floor(raw);
}
