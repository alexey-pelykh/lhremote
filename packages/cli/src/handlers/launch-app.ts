import { AppService, errorMessage } from "@lhremote/core";

export async function handleLaunchApp(options: {
  cdpPort?: number;
}): Promise<void> {
  const app = new AppService(options.cdpPort);

  try {
    await app.launch();
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `LinkedHelper launched on CDP port ${String(app.cdpPort)}\n`,
  );
}
