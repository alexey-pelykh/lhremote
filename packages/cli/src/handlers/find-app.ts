import { errorMessage, findApp } from "@lhremote/core";

/** Handle the {@link https://github.com/alexey-pelykh/lhremote#app-management | find-app} CLI command. */
export async function handleFindApp(options: {
  json?: boolean;
}): Promise<void> {
  try {
    const apps = await findApp();

    if (options.json) {
      process.stdout.write(JSON.stringify(apps, null, 2) + "\n");
      return;
    }

    if (apps.length === 0) {
      process.stdout.write("No running LinkedHelper instances found\n");
      return;
    }

    for (const app of apps) {
      const port =
        app.cdpPort !== null ? `CDP port ${String(app.cdpPort)}` : "no CDP port";
      const status = app.connectable ? "connectable" : "not connectable";
      process.stdout.write(
        `PID ${String(app.pid)} — ${port} — ${status}\n`,
      );
    }
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
