import {
  type Account,
  discoverInstancePort,
  InstanceService,
  LauncherService,
  parseMessageTemplate,
} from "@lhremote/core";

export async function handleSendMessage(
  personId: number,
  message: string,
  options: {
    cdpPort?: number;
    json?: boolean;
  },
): Promise<void> {
  const cdpPort = options.cdpPort ?? 9222;

  // Parse message template before connecting (fail fast on invalid variables)
  let messageTemplate;
  try {
    messageTemplate = parseMessageTemplate(message);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Invalid message template: ${errorMessage}\n`);
    process.exitCode = 1;
    return;
  }

  // Connect to launcher to verify LinkedHelper is running
  const launcher = new LauncherService(cdpPort);

  try {
    await launcher.connect();
    const accounts = await launcher.listAccounts();
    if (accounts.length === 0) {
      process.stderr.write("No accounts found.\n");
      process.exitCode = 1;
      return;
    }
    if (accounts.length > 1) {
      process.stderr.write(
        "Multiple accounts found. Cannot determine which instance to use.\n",
      );
      process.exitCode = 1;
      return;
    }
    // Suppress unused variable - we verify single account exists
    void (accounts[0] as Account);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${errorMessage}\n`);
    process.exitCode = 1;
    return;
  } finally {
    launcher.disconnect();
  }

  // Discover instance CDP port
  const instancePort = await discoverInstancePort(cdpPort);
  if (instancePort === null) {
    process.stderr.write(
      "No LinkedHelper instance is running. Use start-instance first.\n",
    );
    process.exitCode = 1;
    return;
  }

  // Connect to instance and execute action
  const instance = new InstanceService(instancePort);

  try {
    await instance.connect();

    process.stderr.write("Sending message...\n");

    // Execute the MessageToPerson action
    await instance.executeAction("MessageToPerson", {
      personIds: [personId],
      messageTemplate,
    });

    process.stderr.write("Done.\n");

    if (options.json) {
      process.stdout.write(
        JSON.stringify(
          { success: true, personId, actionType: "MessageToPerson" },
          null,
          2,
        ) + "\n",
      );
    } else {
      process.stdout.write(`Message sent to person ${String(personId)}.\n`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${errorMessage}\n`);
    process.exitCode = 1;
  } finally {
    instance.disconnect();
  }
}
