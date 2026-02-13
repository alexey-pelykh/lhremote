// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import type { Protocol } from "devtools-protocol";
import type { CdpTarget } from "../types/cdp.js";
import { isLoopbackAddress } from "../utils/loopback.js";
import {
  CDPConnectionError,
  CDPEvaluationError,
  CDPTimeoutError,
} from "./errors.js";
import { discoverTargets } from "./discovery.js";

/** Default timeout for CDP requests (ms). */
const DEFAULT_TIMEOUT = 30_000;

/** Maximum reconnection attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 5;

/** Base delay for exponential backoff (ms). */
const RECONNECT_BASE_DELAY = 500;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

type EventListener = (params: unknown) => void;

/**
 * Chrome DevTools Protocol client.
 *
 * Communicates with a CDP-enabled process over WebSocket, providing:
 * - Request/response correlation via incrementing message IDs
 * - Event subscription
 * - Convenience helpers for `Runtime.evaluate` and `Page.navigate`
 * - Automatic reconnection with exponential backoff
 */
export class CDPClient {
  private readonly port: number;
  private readonly host: string;
  private readonly timeout: number;

  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Map<string, Set<EventListener>>();

  private connected = false;
  private targetId: string | null = null;
  private reconnecting = false;

  constructor(
    port: number,
    options?: { host?: string; timeout?: number; allowRemote?: boolean },
  ) {
    this.port = port;
    this.host = options?.host ?? "127.0.0.1";
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT;

    if (!isLoopbackAddress(this.host) && !options?.allowRemote) {
      throw new CDPConnectionError(
        `Remote CDP connections to "${this.host}" are not allowed. ` +
          "Use the allowRemote option to connect to non-loopback addresses.",
      );
    }
  }

  /**
   * Open a WebSocket connection to a CDP target.
   *
   * @param targetId - Specific target ID to connect to.  When omitted the
   *   first `page` target is used.
   */
  async connect(targetId?: string): Promise<void> {
    const wsUrl = await this.resolveWebSocketUrl(targetId);
    await this.openWebSocket(wsUrl);
  }

  /**
   * Close the connection.  Pending requests are rejected.
   */
  disconnect(): void {
    this.connected = false;
    this.rejectAllPending(new CDPConnectionError("Client disconnected"));

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Send a raw CDP method call and wait for the response.
   *
   * @param method - CDP method name, e.g. `"Runtime.evaluate"`.
   * @param params - Method parameters.
   * @returns The `result` field from the CDP response.
   */
  async send(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    const ws = this.ws;
    if (!ws || !this.connected) {
      throw new CDPConnectionError("Not connected");
    }

    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params });

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CDPTimeoutError(`Timed out waiting for response to ${method} (id=${id.toString()})`));
      }, this.timeout);

      this.pending.set(id, { resolve, reject, timer });
      ws.send(message);
    });
  }

  /**
   * Evaluate a JavaScript expression via `Runtime.evaluate`.
   *
   * @param expression  - JavaScript source to evaluate.
   * @param awaitPromise - Whether to await a Promise result (default `false`).
   * @returns The deserialized value from the remote context.
   */
  async evaluate<T = unknown>(
    expression: string,
    awaitPromise = false,
  ): Promise<T> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    })) as {
      result?: { value?: unknown };
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    };

    if (result.exceptionDetails) {
      const desc =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "Unknown evaluation error";
      throw new CDPEvaluationError(desc);
    }

    return result.result?.value as T;
  }

  /**
   * Navigate the target to the given URL via `Page.navigate`.
   *
   * Only `http:` and `https:` schemes are allowed.  Other schemes such as
   * `file:`, `javascript:`, or `data:` are rejected to prevent misuse.
   *
   * @throws {TypeError} If the URL uses an unsupported scheme.
   */
  async navigate(url: string): Promise<Protocol.Page.NavigateResponse> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new TypeError(`Unsafe URL scheme: ${parsed.protocol}`);
    }

    return (await this.send("Page.navigate", {
      url,
    })) as Protocol.Page.NavigateResponse;
  }

  /**
   * Subscribe to a CDP event.
   *
   * @param event    - Event name, e.g. `"Page.loadEventFired"`.
   * @param listener - Callback receiving the event parameters.
   */
  on(event: string, listener: EventListener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  /**
   * Remove a previously registered event listener.
   */
  off(event: string, listener: EventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Wait for a single occurrence of a CDP event.
   *
   * @param event   - Event name.
   * @param timeout - Maximum wait time in ms (default: client timeout).
   */
  async waitForEvent(
    event: string,
    timeout?: number,
  ): Promise<unknown> {
    const ms = timeout ?? this.timeout;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(event, handler);
        reject(new CDPTimeoutError(`Timed out waiting for event ${event}`));
      }, ms);

      const handler: EventListener = (params) => {
        clearTimeout(timer);
        this.off(event, handler);
        resolve(params);
      };

      this.on(event, handler);
    });
  }

  /** Whether the client currently has an open connection. */
  get isConnected(): boolean {
    return this.connected;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Resolve a `ws://` URL for the given target ID, or the first page target.
   */
  private async resolveWebSocketUrl(
    targetId?: string,
  ): Promise<string> {
    const targets = await discoverTargets(this.port, this.host);

    let target: CdpTarget | undefined;
    if (targetId) {
      target = targets.find((t) => t.id === targetId);
    } else {
      target = targets.find((t) => t.type === "page");
    }

    if (!target) {
      throw new CDPConnectionError(
        targetId
          ? `Target ${targetId} not found among ${targets.length.toString()} targets`
          : `No page target found among ${targets.length.toString()} targets`,
      );
    }

    if (!target.webSocketDebuggerUrl) {
      throw new CDPConnectionError(
        `Target ${target.id} has no webSocketDebuggerUrl (another debugger may be attached)`,
      );
    }

    this.targetId = target.id;
    return target.webSocketDebuggerUrl;
  }

  /**
   * Open a WebSocket and wire up message handling.
   */
  private openWebSocket(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      let settled = false;

      ws.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        this.ws = ws;
        this.connected = true;
        resolve();
      });

      ws.addEventListener("message", (event: MessageEvent) => {
        const data: unknown = event.data;
        this.handleMessage(
          typeof data === "string" ? data : String(data),
        );
      });

      ws.addEventListener("close", () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.rejectAllPending(new CDPConnectionError("WebSocket closed"));
        if (!settled) {
          settled = true;
          reject(new CDPConnectionError(`WebSocket closed before opening to ${url}`));
        } else if (wasConnected) {
          void this.attemptReconnect();
        }
      });

      ws.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          reject(
            new CDPConnectionError(`WebSocket connection failed to ${url}`),
          );
        }
      });
    });
  }

  /**
   * Handle an incoming WebSocket message — either a method response or an event.
   */
  private handleMessage(raw: string): void {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message: string } };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return; // ignore malformed frames
    }

    // Response to a pending request
    if (msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);

        if (msg.error) {
          pending.reject(new CDPEvaluationError(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Event
    if (msg.method) {
      const set = this.listeners.get(msg.method);
      if (set) {
        for (const listener of set) {
          listener(msg.params);
        }
      }
    }
  }

  /**
   * Attempt to reconnect with exponential backoff.
   */
  private async attemptReconnect(): Promise<void> {
    if (this.reconnecting || !this.targetId) {
      return;
    }
    this.reconnecting = true;

    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
      const delay = RECONNECT_BASE_DELAY * 2 ** attempt;
      await new Promise<void>((r) => setTimeout(r, delay));

      try {
        await this.connect(this.targetId ?? undefined);
        this.reconnecting = false;
        return;
      } catch {
        // continue to next attempt
      }
    }

    this.reconnecting = false;
  }

  /**
   * Reject all pending requests (used on disconnect / close).
   */
  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
