// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// `js-string.ts` is deliberately absent from this barrel, and it is the only
// module here that is.  `../index.js` re-exports this file wholesale, so adding
// a line here publishes the symbol from `@lhremote/core` — and `jsString` is an
// in-page-codegen primitive with no meaning to a consumer, which would then be
// breaking to withdraw.  Its three call sites import it by path, as every
// intra-package import here does; the barrel is the public-API surface, not the
// import mechanism.

export { isCdpPort } from "./cdp-port.js";
export { delay, randomDelay, gaussianRandom, gaussianDelay, gaussianBetween, maybeBreak, simulateReadingTime } from "./delay.js";
export { errorMessage } from "./error-message.js";
export { isLoopbackAddress } from "./loopback.js";
export { SessionPacer, rhythmMultiplier } from "./session-pacer.js";
