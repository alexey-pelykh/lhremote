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
| `waitForInstancePort` | Wait for an instance CDP port to become available |
| `waitForInstanceShutdown` | Wait for an instance to shut down |
| `withDatabase` / `withInstanceDatabase` | Scoped database access helpers |

### Data Access

| Export | Description |
|--------|-------------|
| `CampaignRepository` | Campaign CRUD and action-chain management |
| `ProfileRepository` | Profile lookups and search |
| `MessageRepository` | Messaging history queries |
| `CampaignStatisticsRepository` | Campaign execution statistics queries |
| `CollectionListRepository` | Collection (List) CRUD and people management |
| `DatabaseClient` | SQLite database connection management |
| `discoverDatabase` / `discoverAllDatabases` | Locate LinkedHelper database files on disk |

### Campaign Formats

| Export | Description |
|--------|-------------|
| `parseCampaignYaml` / `parseCampaignJson` | Parse campaign configuration |
| `serializeCampaignYaml` / `serializeCampaignJson` | Serialize campaign configuration |
| `CampaignFormatError` | Error thrown on invalid campaign format input |

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
| `discoverTargets` | Discover CDP targets on a given port |
| `killInstanceProcesses` | Kill processes associated with a LinkedHelper instance |

### Operations

| Export | Description |
|--------|-------------|
| `campaignCreate` | Create a new campaign from parsed configuration |
| `campaignGet` | Get detailed campaign information |
| `campaignList` | List existing campaigns |
| `campaignUpdate` | Update a campaign's name/description |
| `campaignDelete` | Delete (archive) a campaign |
| `campaignExport` | Export campaign configuration |
| `campaignStart` | Start a campaign with target persons |
| `campaignStop` | Stop a running campaign |
| `campaignRetry` | Reset specified people for re-run |
| `campaignMoveNext` | Move people from one action to the next |
| `campaignStatus` | Retrieve campaign status with statistics and action details |
| `campaignStatistics` | Get per-action statistics |
| `campaignAddAction` | Add an action to a campaign |
| `campaignRemoveAction` | Remove an action from a campaign |
| `campaignUpdateAction` | Update an existing action's configuration |
| `campaignReorderActions` | Reorder actions in a campaign |
| `campaignExcludeList` | View the exclude list for a campaign or action |
| `campaignExcludeAdd` | Add people to an exclude list |
| `campaignExcludeRemove` | Remove people from an exclude list |
| `campaignListPeople` | List people assigned to a campaign |
| `campaignRemovePeople` | Remove people from a campaign target list |
| `importPeopleFromUrls` | Import LinkedIn profile URLs into a campaign |
| `collectPeople` | Collect people from a LinkedIn page into a campaign |
| `queryProfilesBulk` | Look up multiple profiles in a single call |
| `queryMessages` | Query messaging history |
| `checkReplies` | Check for new message replies |
| `scrapeMessagingHistory` | Scrape messaging history from LinkedIn |
| `getErrors` | Query current UI errors and dialogs |
| `listCollections` | List all LinkedHelper collections |
| `createCollection` | Create a new collection |
| `deleteCollection` | Delete a collection |
| `addPeopleToCollection` | Add people to a collection |
| `removePeopleFromCollection` | Remove people from a collection |
| `importPeopleFromCollection` | Import collection people into a campaign |

### Constants & Utilities

| Export | Description |
|--------|-------------|
| `DEFAULT_CDP_PORT` | Default CDP port used by LinkedHelper |
| `delay` | Promise-based delay helper |
| `errorMessage` | Extract a human-readable message from an unknown error |
| `isCdpPort` | Check whether a value is a valid CDP port number |
| `isLoopbackAddress` | Check whether a string is a loopback IP address |

### Error Types

| Export | Description |
|--------|-------------|
| `ServiceError` | Base class for service-layer errors |
| `AccountResolutionError` | Failed to resolve the active account |
| `ActionExecutionError` | Action execution failed |
| `AppLaunchError` | LinkedHelper application failed to launch |
| `AppNotFoundError` | LinkedHelper application not found |
| `CampaignExecutionError` | Campaign execution failed |
| `CampaignTimeoutError` | Campaign operation timed out |
| `ExtractionTimeoutError` | Data extraction timed out |
| `InstanceNotRunningError` | Target instance is not running |
| `InvalidProfileUrlError` | Invalid LinkedIn profile URL |
| `LinkedHelperNotRunningError` | LinkedHelper is not running |
| `StartInstanceError` | Instance failed to start |
| `WrongPortError` | Connected to wrong port / unexpected endpoint |
| `CampaignNotFoundError` | Campaign not found in the database |
| `ActionNotFoundError` | Action not found in the database |
| `ChatNotFoundError` | Chat not found in the database |
| `DatabaseError` | General database error |
| `DatabaseNotFoundError` | Database file not found on disk |
| `ExcludeListNotFoundError` | Exclude list not found in the database |
| `NoNextActionError` | No next action available in the campaign |
| `ProfileNotFoundError` | Profile not found in the database |
| `CDPConnectionError` | CDP connection failed |
| `CDPError` | General CDP protocol error |
| `CDPEvaluationError` | CDP JavaScript evaluation failed |
| `CDPTimeoutError` | CDP operation timed out |
| `LinkedHelperUnreachableError` | LinkedHelper processes detected but CDP endpoint unreachable |
| `CollectionError` | General collection operation error |
| `CollectionBusyError` | Collection operation blocked (LinkedHelper busy) |
| `UIBlockedError` | LinkedHelper UI blocked by dialog or popup |

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
