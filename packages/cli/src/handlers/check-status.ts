import { checkStatus, errorMessage } from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#account--instance | check-status} CLI command. */
export async function handleCheckStatus(options: {
  cdpPort?: number;
  json?: boolean;
}): Promise<void> {
  try {
    const report = await checkStatus(options.cdpPort);

    if (options.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      return;
    }

    // Launcher status
    if (report.launcher.reachable) {
      process.stdout.write(
        `Launcher: reachable on port ${String(report.launcher.port)}\n`,
      );
    } else {
      process.stdout.write(
        `Launcher: not reachable on port ${String(report.launcher.port)}\n`,
      );
    }

    // Instance status
    if (report.instances.length === 0) {
      process.stdout.write("Instances: none\n");
    } else {
      for (const instance of report.instances) {
        const port =
          instance.cdpPort !== null
            ? `CDP port ${String(instance.cdpPort)}`
            : "not running";
        process.stdout.write(
          `Instance: ${instance.accountName} (${String(instance.accountId)}) — ${port}\n`,
        );
      }
    }

    // Database status
    if (report.databases.length === 0) {
      process.stdout.write("Databases: none found\n");
    } else {
      for (const db of report.databases) {
        process.stdout.write(
          `Database: account ${String(db.accountId)} — ${String(db.profileCount)} profiles — ${db.path}\n`,
        );
      }
    }
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
