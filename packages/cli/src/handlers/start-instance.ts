import {
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";

export async function handleStartInstance(
  accountIdArg: string,
  options: { cdpPort?: number },
): Promise<void> {
  const accountId = Number(accountIdArg);
  const cdpPort = options.cdpPort ?? 9222;
  const launcher = new LauncherService(cdpPort);

  try {
    await launcher.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const outcome = await startInstanceWithRecovery(
      launcher,
      accountId,
      cdpPort,
    );

    if (outcome.status === "timeout") {
      process.stderr.write(
        "Instance started but failed to initialize within timeout.\n",
      );
      process.exitCode = 1;
      return;
    }

    const verb =
      outcome.status === "already_running"
        ? "already running"
        : "started";

    process.stdout.write(
      `Instance ${verb} for account ${String(accountId)} on CDP port ${String(outcome.port)}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    launcher.disconnect();
  }
}
