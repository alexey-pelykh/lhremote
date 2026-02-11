import type { Account } from "../types/index.js";
import { LauncherService } from "./launcher.js";
import { ServiceError } from "./errors.js";

/**
 * Thrown when account resolution fails because no accounts exist,
 * or multiple accounts exist and automatic selection is not possible.
 */
export class AccountResolutionError extends ServiceError {
  readonly reason: "no-accounts" | "multiple-accounts";

  constructor(reason: "no-accounts" | "multiple-accounts") {
    const message =
      reason === "no-accounts"
        ? "No accounts found."
        : "Multiple accounts found. Cannot determine which instance to use.";
    super(message);
    this.name = "AccountResolutionError";
    this.reason = reason;
  }
}

/**
 * Connect to the LinkedHelper launcher, resolve the single account,
 * and return its ID.
 *
 * Throws {@link LinkedHelperNotRunningError} if the launcher is unreachable,
 * {@link AccountResolutionError} if zero or multiple accounts exist,
 * or the underlying CDP/launcher error on other failures.
 */
export async function resolveAccount(cdpPort: number): Promise<number> {
  const launcher = new LauncherService(cdpPort);

  try {
    await launcher.connect();

    const accounts = await launcher.listAccounts();
    if (accounts.length === 0) {
      throw new AccountResolutionError("no-accounts");
    }
    if (accounts.length > 1) {
      throw new AccountResolutionError("multiple-accounts");
    }
    return (accounts[0] as Account).id;
  } finally {
    launcher.disconnect();
  }
}
