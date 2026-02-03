import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";

const server = createServer();
const transport = new StdioServerTransport();

try {
  await server.connect(transport);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to start MCP server: ${message}\n`);
  process.exit(1);
}

process.stderr.write("lhremote MCP server running on stdio\n");

function shutdown() {
  server
    .close()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error during shutdown: ${message}\n`);
    })
    .finally(() => {
      process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
