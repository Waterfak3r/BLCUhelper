// Free listing reads: one retry for transient transport/upstream failures within the original deadline.
import { setTimeout } from "node:timers/promises";
import { guardedFetch, type GuardedFetchOptions, type GuardedResponse } from "../lib/http-fetch.ts";
import { config } from "../config.ts";

const RETRY_DELAY_MS = 1000;
const TRANSIENT_CODES = new Set(["ECONNRESET", "EPIPE", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);

function transientTransport(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || TRANSIENT_CODES.has((error as NodeJS.ErrnoException).code ?? "")) return true;
  if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(transientTransport);
  return transientTransport(error.cause);
}

function youtubeFeed(input: string): boolean {
  const url = new URL(input);
  return url.protocol === "https:" && ["youtube.com", "www.youtube.com"].includes(url.hostname)
    && url.pathname === "/feeds/videos.xml" && /^UC[\w-]{22}$/.test(url.searchParams.get("channel_id") ?? "");
}

function transientResponse(input: string, res: GuardedResponse): boolean {
  // A working YouTube channel feed can intermittently return 404. Other missing URLs stay errors.
  return [500, 502, 503, 504].includes(res.status) || res.status === 404 && youtubeFeed(input) && youtubeFeed(res.url);
}

export function rewriteListingUrl(input: string, hostMap: Map<string, string>): string {
  if (hostMap.size === 0) return input;
  try {
    const u = new URL(input);
    const hostWithPort = u.host.toLowerCase();
    const hostname = u.hostname.toLowerCase();
    const mappedWithPort = hostMap.get(hostWithPort);
    if (mappedWithPort) {
      if (mappedWithPort.includes(":")) {
        const [targetHost, targetPort] = mappedWithPort.split(":");
        u.hostname = targetHost!;
        u.port = targetPort!;
      } else {
        u.hostname = mappedWithPort;
        u.port = "";
      }
      return u.toString();
    }
    const mappedHost = hostMap.get(hostname);
    if (mappedHost) {
      if (mappedHost.includes(":")) {
        const [targetHost, targetPort] = mappedHost.split(":");
        u.hostname = targetHost!;
        u.port = targetPort!;
      } else {
        u.hostname = mappedHost;
      }
      return u.toString();
    }
  } catch {
    // Keep original on invalid URL
  }
  return input;
}

export async function fetchListing(input: string, opts: GuardedFetchOptions = {}): Promise<GuardedResponse> {
  const targetUrl = opts.privateFeedHost === false ? input : rewriteListingUrl(input, config.feedHostMap);
  const repeatable = (opts.method ?? "GET").toUpperCase() === "GET" && opts.body === undefined;
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  for (let attempt = 0; ; attempt++) {
    const canRetry = () => repeatable && attempt === 0 && deadline - Date.now() > RETRY_DELAY_MS;
    try {
      // Listing addresses come from the source configuration, so a listed private feed host may serve them.
      const res = await guardedFetch(targetUrl, { ...opts, privateFeedHost: true, timeoutMs: Math.max(1, deadline - Date.now()) });
      if (!canRetry() || !transientResponse(input, res)) return res;
    } catch (error) {
      if (!canRetry() || !transientTransport(error)) throw error;
    }
    await setTimeout(RETRY_DELAY_MS);
  }
}
