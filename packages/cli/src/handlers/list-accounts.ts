import { errorMessage, LauncherService } from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#account--instance | list-accounts} CLI command. */
export async function handleListAccounts(options: {
  cdpPort?: number;
  json?: boolean;
}): Promise<void> {
  const launcher = new LauncherService(options.cdpPort);

  try {
    await launcher.connect();
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const accounts = await launcher.listAccounts();

    if (options.json) {
      process.stdout.write(JSON.stringify(accounts, null, 2) + "\n");
    } else if (accounts.length === 0) {
      process.stdout.write("No accounts found\n");
    } else {
      for (const account of accounts) {
        const email = account.email ? ` <${account.email}>` : "";
        process.stdout.write(
          `${String(account.id)}\t${account.name}${email}\n`,
        );
      }
    }
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    launcher.disconnect();
  }
}
