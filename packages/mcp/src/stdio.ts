import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { errorMessage } from "@lhremote/core";

import { createServer } from "./server.js";

/**
 * Start the MCP server on stdio and register signal handlers for
 * graceful shutdown. This function does not return under normal
 * operation — the process stays alive until SIGINT/SIGTERM.
 */
export async function runStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  try {
    await server.connect(transport);
  } catch (error: unknown) {
    const message = errorMessage(error);
    process.stderr.write(`Failed to start MCP server: ${message}\n`);
    process.exit(1);
  }

  process.stderr.write("lhremote MCP server running on stdio\n");

  function shutdown() {
    server
      .close()
      .catch((error: unknown) => {
        const message = errorMessage(error);
        process.stderr.write(`Error during shutdown: ${message}\n`);
      })
      .finally(() => {
        process.exit(0);
      });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
