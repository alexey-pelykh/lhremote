import { createRequire } from "node:module";

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";

import { createServer } from "./server.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

let server: McpServer | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  await server?.close();
  client = undefined;
  server = undefined;
});

async function connectPair() {
  const { Client: ClientCtor } = await import(
    "@modelcontextprotocol/sdk/client/index.js"
  );
  const { InMemoryTransport } = await import(
    "@modelcontextprotocol/sdk/inMemory.js"
  );

  server = createServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new ClientCtor({ name: "test-client", version: "1.0.0" });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { server, client };
}

describe("createServer", () => {
  it("returns an McpServer instance", () => {
    server = createServer();

    expect(server).toBeDefined();
    expect(server).toHaveProperty("connect");
    expect(server).toHaveProperty("close");
    expect(server).toHaveProperty("tool");
  });

  it("can connect and close with an in-memory transport", async () => {
    const { client: c } = await connectPair();

    const info = c.getServerVersion();
    expect(info).toEqual(
      expect.objectContaining({ name: "@lhremote/mcp", version }),
    );
  });

  it("advertises tools capability", async () => {
    const { client: c } = await connectPair();

    const capabilities = c.getServerCapabilities();
    expect(capabilities?.tools).toBeDefined();
  });

  it("lists registered tools", async () => {
    const { client: c } = await connectPair();

    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain("find-app");
    expect(names).toContain("launch-app");
    expect(names).toContain("quit-app");
    expect(names).toContain("list-accounts");
    expect(names).toContain("start-instance");
    expect(names).toContain("stop-instance");
    expect(names).toContain("query-profile");
    expect(names).toContain("query-profiles");
    expect(names).toContain("query-messages");
    expect(names).toContain("scrape-messaging-history");
    expect(names).toContain("campaign-create");
    expect(names).toContain("campaign-delete");
    expect(names).toContain("campaign-export");
    expect(names).toContain("campaign-get");
    expect(names).toContain("campaign-list");
    expect(names).toContain("campaign-start");
    expect(names).toContain("campaign-status");
    expect(names).toContain("campaign-stop");
    expect(names).toContain("campaign-update");
    expect(names).toContain("check-replies");
    expect(names).toContain("check-status");
    expect(names).toContain("describe-actions");
    expect(names).toContain("import-people-from-urls");
    expect(names).toHaveLength(23);
  });
});
