// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { CDPClient } from "../cdp/client.js";
import { CDPEvaluationError, CDPTimeoutError } from "../cdp/errors.js";

/** URL pattern matching LinkedIn Voyager API endpoints. */
export const VOYAGER_URL_PATTERN = /\/voyager\/api\//;

/** Default timeout for response wait operations (ms). */
const DEFAULT_TIMEOUT = 30_000;

/**
 * A captured Voyager API response.
 */
export interface VoyagerResponse {
  /** The full request URL. */
  readonly url: string;
  /** HTTP status code. */
  readonly status: number;
  /** Parsed JSON response body, or raw string if JSON parsing failed. */
  readonly body: unknown;
}

/**
 * Callback for intercepted Voyager API responses.
 */
export type VoyagerResponseHandler = (response: VoyagerResponse) => void;

/**
 * Options for active Voyager API fetching.
 */
export interface VoyagerFetchOptions {
  /** Additional HTTP headers to include in the request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Shape returned by the in-page fetch expression. */
interface PageFetchResult {
  url: string;
  status: number;
  body: unknown;
  error?: string;
}

/**
 * CDP Network domain listener for LinkedIn Voyager API responses.
 *
 * Intercepts HTTP responses matching the Voyager API URL pattern
 * (`/voyager/api/`) via the Chrome DevTools Protocol Network domain.
 *
 * Two modes of operation:
 * - **Passive**: Enable the interceptor and register handlers to capture
 *   Voyager responses triggered by page navigation, scrolling, or user
 *   interaction within the LinkedIn WebView.
 * - **Active**: Use {@link fetch} to execute Voyager API requests directly
 *   in the page context (which has the LinkedIn session cookies).
 *
 * The interceptor is read-only — it does not modify requests or responses,
 * so it coexists safely with LinkedHelper's mockttp proxy.
 */
export class VoyagerInterceptor {
  private readonly client: CDPClient;
  private readonly handlers = new Set<VoyagerResponseHandler>();
  private readonly pendingRequests = new Map<
    string,
    { url: string; status: number }
  >();
  private interceptEnabled = false;

  constructor(client: CDPClient) {
    this.client = client;
  }

  /** Whether passive interception is currently enabled. */
  get isEnabled(): boolean {
    return this.interceptEnabled;
  }

  /**
   * Enable the CDP Network domain and start intercepting Voyager responses.
   *
   * Subscribes to `Network.responseReceived`, `Network.loadingFinished`,
   * and `Network.loadingFailed` events.  Responses matching the Voyager
   * URL pattern are captured and emitted to registered handlers.
   */
  async enable(): Promise<void> {
    if (this.interceptEnabled) return;
    await this.client.send("Network.enable");
    this.client.on("Network.responseReceived", this.handleResponseReceived);
    this.client.on("Network.loadingFinished", this.handleLoadingFinished);
    this.client.on("Network.loadingFailed", this.handleLoadingFailed);
    this.interceptEnabled = true;
  }

  /**
   * Disable the CDP Network domain and stop intercepting.
   *
   * Cleans up event listeners and pending request state.
   */
  async disable(): Promise<void> {
    if (!this.interceptEnabled) return;
    this.interceptEnabled = false;
    this.client.off("Network.responseReceived", this.handleResponseReceived);
    this.client.off("Network.loadingFinished", this.handleLoadingFinished);
    this.client.off("Network.loadingFailed", this.handleLoadingFailed);
    this.pendingRequests.clear();
    await this.client.send("Network.disable").catch(() => {});
  }

  /**
   * Register a handler for passively intercepted Voyager responses.
   */
  onResponse(handler: VoyagerResponseHandler): void {
    this.handlers.add(handler);
  }

  /**
   * Remove a previously registered response handler.
   */
  offResponse(handler: VoyagerResponseHandler): void {
    this.handlers.delete(handler);
  }

  /**
   * Wait for the next Voyager response matching an optional URL filter.
   *
   * Requires the interceptor to be {@link enable}d.
   *
   * @param filter  - Optional predicate applied to the response URL.
   * @param timeout - Maximum wait time in ms (default: 30 000).
   */
  async waitForResponse(
    filter?: (url: string) => boolean,
    timeout?: number,
  ): Promise<VoyagerResponse> {
    if (!this.interceptEnabled) {
      throw new Error(
        "VoyagerInterceptor is not enabled — call enable() before waitForResponse()",
      );
    }

    const ms = timeout ?? DEFAULT_TIMEOUT;

    return new Promise<VoyagerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.offResponse(handler);
        reject(new CDPTimeoutError("Timed out waiting for Voyager response"));
      }, ms);

      const handler: VoyagerResponseHandler = (response) => {
        if (!filter || filter(response.url)) {
          clearTimeout(timer);
          this.offResponse(handler);
          resolve(response);
        }
      };

      this.onResponse(handler);
    });
  }

  /**
   * Execute a Voyager API request in the LinkedIn page context.
   *
   * Runs `fetch()` inside the WebView where LinkedIn session cookies are
   * available, automatically extracting the CSRF token from cookies.
   *
   * Does not require the interceptor to be {@link enable}d — works
   * independently of the Network domain.
   *
   * @param path    - Voyager API path (e.g. `/voyager/api/feed/dash/feedUpdates`).
   *                  Full URLs starting with `https://` are also accepted.
   * @param options - Optional fetch configuration.
   */
  async fetch(
    path: string,
    options?: VoyagerFetchOptions,
  ): Promise<VoyagerResponse> {
    const fullUrl = path.startsWith("https://")
      ? path
      : `https://www.linkedin.com${path.startsWith("/") ? "" : "/"}${path}`;

    // Guard: only send credentials to LinkedIn origins
    const parsed = new URL(fullUrl);
    if (
      parsed.hostname !== "www.linkedin.com" &&
      parsed.hostname !== "linkedin.com" &&
      !parsed.hostname.endsWith(".linkedin.com")
    ) {
      throw new Error(
        `Voyager fetch restricted to linkedin.com origins, got: ${parsed.hostname}`,
      );
    }

    const extraHeaders = JSON.stringify(options?.headers ?? {});

    const result = await this.client.evaluate<PageFetchResult>(
      `(async () => {
        try {
          const jsessionid = document.cookie
            .split(";")
            .map(c => c.trim())
            .find(c => c.startsWith("JSESSIONID="));
          let csrfToken = jsessionid
            ? jsessionid.substring(jsessionid.indexOf("=") + 1).replace(/"/g, "")
            : "";
          if (!csrfToken.startsWith("ajax:")) {
            csrfToken = "ajax:" + csrfToken;
          }

          const response = await fetch(${JSON.stringify(fullUrl)}, {
            headers: {
              "Csrf-Token": csrfToken,
              "X-RestLi-Protocol-Version": "2.0.0",
              ...${extraHeaders},
            },
            credentials: "include",
          });

          const text = await response.text();
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }

          return { url: response.url, status: response.status, body };
        } catch (e) {
          return { url: ${JSON.stringify(fullUrl)}, status: 0, body: null, error: String(e) };
        }
      })()`,
      true,
    );

    if (result.error) {
      throw new CDPEvaluationError(`Voyager fetch failed: ${result.error}`);
    }

    return {
      url: result.url,
      status: result.status,
      body: result.body,
    };
  }

  // ---------------------------------------------------------------------------
  // Private — CDP event handlers
  // ---------------------------------------------------------------------------

  private handleResponseReceived = (params: unknown): void => {
    const { requestId, response } = params as {
      requestId: string;
      response: { url: string; status: number };
    };

    if (VOYAGER_URL_PATTERN.test(response.url)) {
      this.pendingRequests.set(requestId, {
        url: response.url,
        status: response.status,
      });
    }
  };

  private handleLoadingFinished = (params: unknown): void => {
    const { requestId } = params as { requestId: string };
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;
    this.pendingRequests.delete(requestId);

    void this.fetchAndEmitBody(requestId, pending);
  };

  private handleLoadingFailed = (params: unknown): void => {
    const { requestId } = params as { requestId: string };
    this.pendingRequests.delete(requestId);
  };

  private async fetchAndEmitBody(
    requestId: string,
    meta: { url: string; status: number },
  ): Promise<void> {
    let body: unknown;
    try {
      const result = (await this.client.send("Network.getResponseBody", {
        requestId,
      })) as { body: string; base64Encoded: boolean };

      const raw = result.base64Encoded
        ? Buffer.from(result.body, "base64").toString("utf8")
        : result.body;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    } catch {
      // Body retrieval can fail for cached or evicted responses — skip silently
      return;
    }

    const response: VoyagerResponse = {
      url: meta.url,
      status: meta.status,
      body,
    };

    for (const handler of this.handlers) {
      try {
        handler(response);
      } catch {
        // Isolate handler errors so one failing handler doesn't block others
      }
    }
  }
}
