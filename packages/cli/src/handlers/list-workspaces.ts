// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { errorMessage, LauncherService, resolveAppPort } from "@lhremote/core";

/**
 * Handle the `list-workspaces` CLI command.
 *
 * Lists LinkedHelper workspaces the current LH user belongs to.
 * Workspaces are a LinkedHelper 2.113.x feature; on earlier versions
 * the command prints nothing (no workspaces exist).
 */
export async function handleListWorkspaces(options: {
  cdpPort?: number;
  cdpHost?: string;
  allowRemote?: boolean;
  json?: boolean;
}): Promise<void> {
  let port: number;
  try {
    port = options.cdpPort ?? await resolveAppPort("launcher");
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  const launcher = new LauncherService(port, {
    ...(options.cdpHost !== undefined && { host: options.cdpHost }),
    ...(options.allowRemote !== undefined && { allowRemote: options.allowRemote }),
  });

  try {
    await launcher.connect();
  } catch (error) {
    const message = errorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const workspaces = await launcher.listWorkspaces();

    if (options.json) {
      process.stdout.write(JSON.stringify(workspaces, null, 2) + "\n");
    } else if (workspaces.length === 0) {
      process.stdout.write("No workspaces found\n");
    } else {
      for (const ws of workspaces) {
        const marker = ws.selected ? "*" : " ";
        process.stdout.write(
          `${marker} ${String(ws.id)}\t${ws.name}\t[${ws.workspaceUser.role}]\n`,
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
