# ADR-003: SQLite Database Access via Direct File System

## Status

Accepted

## Context

LinkedHelper stores per-account data (profiles, messages, campaigns, actions) in SQLite databases on disk. Each LinkedIn account has its own database file at a platform-specific path (e.g., `~/Library/Application Support/linked-helper/Partitions/linked-helper-account-{id}-main/lh.db` on macOS).

To expose query and campaign management capabilities, lhremote needs to read (and occasionally write to) these databases. The question is how to access them: through LinkedHelper's own runtime (via CDP and evaluated JavaScript), through a custom HTTP/REST wrapper, or by accessing the SQLite files directly.

## Decision

Access LinkedHelper's SQLite databases directly via the file system using Node.js built-in `node:sqlite` module (`DatabaseSync`).

**Key design choices:**

1. **Read-only by default** (`readOnly: true`) — LinkedHelper uses WAL (Write-Ahead Logging) journaling mode, which allows concurrent readers without blocking the application's write operations. Most lhremote queries (profile lookups, message history, campaign listing) are read-only.

2. **Opt-in write mode** — campaign management operations (create, update, delete, reorder actions) open the database with `readOnly: false`. This is used sparingly and documented as a write operation.

3. **Database discovery** by scanning the `Partitions/` directory — `discoverDatabase(accountId)` resolves the platform-specific path for a given account, while `discoverAllDatabases()` enumerates all account databases by scanning the partitions directory structure.

4. **Repository pattern** for data access — `ProfileRepository`, `MessageRepository`, and `CampaignRepository` encapsulate SQL queries and transform raw rows into typed domain objects. Each repository receives a `DatabaseClient` (which wraps `DatabaseSync`) via constructor injection.

## Alternatives Considered

### Query via CDP Runtime.evaluate

Execute SQL queries through LinkedHelper's JavaScript runtime by evaluating code that calls the application's internal database APIs. This would piggyback on LinkedHelper's own database connection. However, it would be slower (serialization through CDP + JavaScript evaluation overhead), harder to test (requires a running application), and limited to whatever query interface LinkedHelper exposes internally.

### Custom HTTP wrapper service

Run a separate HTTP service that opens the SQLite databases and exposes REST endpoints. This adds deployment complexity (another process to manage), introduces HTTP serialization overhead, and provides no benefit since the databases are local files. The caller and the database are on the same machine.

### ORM / query builder

Use an ORM like Drizzle or Prisma instead of raw SQL. The database schema is owned by LinkedHelper and may change between versions. An ORM would add a schema definition layer that must be kept in sync with an external application's schema. Raw SQL with typed repositories is simpler and gives full control over query construction.

## Consequences

**Positive:**

- Zero additional infrastructure — no HTTP service, no middleware, just file access
- Fastest possible read path — direct SQLite access with no serialization overhead
- WAL mode allows safe concurrent reads while LinkedHelper is running
- Node.js built-in `node:sqlite` means no native addon compilation or external dependency
- Repository pattern provides a clean abstraction for testing (mock the `DatabaseSync` interface)
- Full SQL expressiveness for complex queries (joins across profiles, positions, education, skills)

**Negative:**

- LinkedHelper's schema is undocumented and may change between versions — queries are coupled to the current schema structure
- Write operations bypass any application-level validation that LinkedHelper may perform
- Database path discovery is platform-specific, requiring different paths for macOS, Windows, and Linux
- If LinkedHelper changes its database journaling mode from WAL, concurrent reads could cause locking conflicts
- Direct file access means lhremote must run on the same machine as LinkedHelper

**Neutral:**

- The `DatabaseSync` API is synchronous, which is acceptable for the query patterns used (short-lived reads and targeted writes) but would not suit high-throughput streaming scenarios
