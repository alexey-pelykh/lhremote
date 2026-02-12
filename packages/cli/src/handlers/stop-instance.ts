import { errorMessage, LauncherService } from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#account--instance | stop-instance} CLI command. */
export async function handleStopInstance(
  accountIdArg: string,
  options: { cdpPort?: number },
): Promise<void> {
  const accountId = Number(accountIdArg);
  const cdpPort = options.cdpPort ?? 9222;
  const launcher = new LauncherService(cdpPort);

  try {
    await launcher.connect();
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    await launcher.stopInstance(accountId);
    process.stdout.write(
      `Instance stopped for account ${String(accountId)}\n`,
    );
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    launcher.disconnect();
  }
}
