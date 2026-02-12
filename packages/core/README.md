# @lhremote/core

Core library for [lhremote](https://github.com/alexey-pelykh/lhremote) — LinkedHelper automation toolkit.

This package provides services, data access, and CDP communication for controlling LinkedHelper. It is the foundation that both [`@lhremote/mcp`](../mcp) and [`@lhremote/cli`](../cli) build on.

## Installation

```bash
npm install @lhremote/core
```

## Key Exports

### Services

| Export | Description |
|--------|-------------|
| `AppService` | Detect, launch, and quit the LinkedHelper application |
| `InstanceService` | Start and stop LinkedHelper instances for individual accounts |
| `LauncherService` | Low-level launcher interaction via CDP |
| `CampaignService` | Create, configure, start, stop, and monitor campaigns |
| `resolveAccount` | Resolve the active account ID from a running instance |
| `checkStatus` | Check launcher, instance, and database health |
| `startInstanceWithRecovery` | Start an instance with automatic retry on failure |
| `withDatabase` / `withInstanceDatabase` | Scoped database access helpers |

### Data Access

| Export | Description |
|--------|-------------|
| `CampaignRepository` | Campaign CRUD and action-chain management |
| `ProfileRepository` | Profile lookups and search |
| `MessageRepository` | Messaging history queries |
| `DatabaseClient` | SQLite database connection management |
| `discoverDatabase` / `discoverAllDatabases` | Locate LinkedHelper database files on disk |

### Campaign Formats

| Export | Description |
|--------|-------------|
| `parseCampaignYaml` / `parseCampaignJson` | Parse campaign configuration |
| `serializeCampaignYaml` / `serializeCampaignJson` | Serialize campaign configuration |

### Action Catalog

| Export | Description |
|--------|-------------|
| `getActionTypeCatalog` | List all available action types with metadata |
| `getActionTypeInfo` | Get details for a specific action type |

### CDP

| Export | Description |
|--------|-------------|
| `findApp` | Detect running LinkedHelper instances via process inspection |
| `discoverInstancePort` | Find the CDP port for a running instance |

### Error Types

The library exports domain-specific error classes (`CampaignNotFoundError`, `CDPConnectionError`, `DatabaseNotFoundError`, etc.) that consumers can use for fine-grained error handling.

## Usage

```typescript
import {
  findApp,
  resolveAccount,
  CampaignService,
  withInstanceDatabase,
} from "@lhremote/core";

// Detect LinkedHelper
const apps = await findApp();
const cdpPort = apps[0].cdpPort!;

// Resolve the active account
const accountId = await resolveAccount(cdpPort);

// Work with campaigns
await withInstanceDatabase(cdpPort, accountId, async ({ instance, db }) => {
  const campaigns = new CampaignService(instance, db);
  const list = await campaigns.list();
  console.log(list);
});
```

## License

[AGPL-3.0-only](https://github.com/alexey-pelykh/lhremote/blob/main/LICENSE)
