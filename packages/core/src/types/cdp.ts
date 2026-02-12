// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

/**
 * Entry returned by Chrome's HTTP `/json/list` debugging endpoint.
 *
 * This is NOT part of the CDP protocol itself — it's Chrome's proprietary
 * HTTP interface for target discovery.  For protocol-level types
 * (Runtime, Page, Target, etc.) use `devtools-protocol` directly.
 */
export interface CdpTarget {
  description: string;
  devtoolsFrontendUrl: string;
  id: string;
  title: string;
  type: string;
  url: string;
  /** Missing when another debugger client is already attached. */
  webSocketDebuggerUrl?: string | undefined;
}
