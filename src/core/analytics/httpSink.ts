import type { AnalyticsSink, DeliverableEvent } from './transport';

/**
 * Delivers batches over HTTP, in PostHog's capture format.
 *
 * PostHog was chosen over writing events into our own Postgres for one decisive
 * reason: **the funnel we care about happens before anyone signs in.** PRD §30's
 * headline metric is import → workout start, and most of that happens on a first run
 * with no account. Storing it in Supabase would mean an anonymous-insert policy on a
 * table — a standing write endpoint for the internet — to collect data a product
 * analytics tool already handles with a write-only key and an anonymous distinct id.
 *
 * The project API key is write-only and designed to ship in clients, like the
 * Supabase anon key and unlike the Anthropic one. It can enqueue events; it cannot
 * read them back.
 *
 * The format is small enough that any compatible collector works, and the sink is
 * behind `AnalyticsSink` regardless — switching vendors is this file.
 */

export interface HttpSinkConfig {
  /** e.g. https://eu.i.posthog.com/batch/ */
  endpoint: string;
  /** Write-only project key. */
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Guards against a slow collector holding a request open indefinitely. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class HttpAnalyticsSink implements AnalyticsSink {
  readonly id = 'http';

  constructor(private readonly config: HttpSinkConfig) {}

  async send(events: DeliverableEvent[]): Promise<boolean> {
    if (events.length === 0) return true;

    const doFetch = this.config.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const response = await doFetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: this.config.apiKey,
          batch: events.map(toCaptureEvent),
        }),
        signal: controller.signal,
      });

      // A 4xx means this batch will never be accepted — malformed, or a bad key.
      // Retrying it forever would block every event behind it, so drop it.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return true;
      }

      return response.ok;
    } catch {
      // Network failure or timeout: keep the batch and try again later.
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toCaptureEvent(event: DeliverableEvent): Record<string, unknown> {
  return {
    event: event.name,
    distinct_id: event.deviceId,
    timestamp: new Date(event.at).toISOString(),
    properties: event.properties,
  };
}
