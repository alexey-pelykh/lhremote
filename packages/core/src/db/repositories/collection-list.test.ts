// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it, vi } from "vitest";

import type { DatabaseClient } from "../client.js";
import { CollectionListRepository } from "./collection-list.js";

/**
 * An `Error` whose `message` is `value`.
 *
 * `new Error(value)` would coerce it, which is the very step under test.  The
 * construction mirrors `error-message.test.ts` § `errorMessage totality`, and
 * so does its warrant: `message` is typed `string` but is not one by
 * construction -- a subclass assigning `this.message`, an error rehydrated
 * across a worker or IPC boundary, and a `Proxy` can each produce one, and the
 * catch blocks below accept whatever the driver threw.  No producer in this
 * repo builds one today; these pin the contract `unknown` promises to accept,
 * not an observed source.
 */
function errorWithMessage(value: unknown): Error {
  const error = new Error("placeholder");
  Object.defineProperty(error, "message", { value, configurable: true });
  return error;
}

/** A prepared statement whose three verbs are individually scriptable. */
interface FakeStatement {
  get: (...args: unknown[]) => unknown;
  run: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown;
}

/**
 * A stand-in `DatabaseClient` that dispatches `prepare` on the SQL text.
 *
 * Hand-rolled rather than driven off the fixture database, because the shapes
 * under test are ones a real driver never produces: `node:sqlite` raises
 * errors carrying string messages, so a fixture cannot reach the branch these
 * tests exist for.  The statements the repository prepares but does not use on
 * these paths answer harmlessly.
 */
function fakeClient(
  scripted: Partial<Record<string, Partial<FakeStatement>>>,
): DatabaseClient {
  const inert: FakeStatement = {
    get: () => undefined,
    run: () => ({ changes: 1 }),
    all: () => [],
  };

  const db = {
    prepare: vi.fn((sql: string): FakeStatement => {
      for (const [needle, overrides] of Object.entries(scripted)) {
        if (sql.includes(needle)) return { ...inert, ...overrides };
      }
      return { ...inert };
    }),
    exec: vi.fn(),
  };

  return { db } as unknown as DatabaseClient;
}

describe("CollectionListRepository.resolveInternalAccountId", () => {
  /**
   * `instanceof Error` establishes the value is an `Error`.  It establishes
   * NOTHING about `message`, so reading `.includes` on a non-string one raises
   * `TypeError` from inside the catch -- replacing the driver's own failure
   * with an unrelated type error before it can reach the caller.
   *
   * Pinned on the classification's own terms rather than on "does not throw"
   * alone: what the caller must still receive is the error the driver raised.
   */
  it("rethrows a non-string-message error rather than raising from inside the catch", () => {
    const raised = errorWithMessage(42);
    const repo = new CollectionListRepository(
      fakeClient({
        "FROM li_accounts": {
          get: () => {
            throw raised;
          },
        },
      }),
    );

    let failure: unknown;
    try {
      repo.resolveInternalAccountId(7);
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBe(raised);
    expect(failure).not.toBeInstanceOf(TypeError);
  });

  /**
   * The other half of the same coercion: a non-string message whose text DOES
   * carry the phrase must still take the missing-table fallback.  Coercing
   * rather than discarding is what keeps that true -- reading `""` for every
   * non-string would be total too, and would re-route this case to the
   * rethrow above.
   */
  it("still takes the missing-table fallback on a non-string message carrying the phrase", () => {
    const repo = new CollectionListRepository(
      fakeClient({
        "FROM li_accounts": {
          get: () => {
            throw errorWithMessage({
              toString: () => "no such table: li_accounts",
            });
          },
        },
      }),
    );

    expect(repo.resolveInternalAccountId(7)).toBe(7);
  });

  it("takes the missing-table fallback on the string message a driver raises", () => {
    const repo = new CollectionListRepository(
      fakeClient({
        "FROM li_accounts": {
          get: () => {
            throw new Error("no such table: li_accounts");
          },
        },
      }),
    );

    expect(repo.resolveInternalAccountId(7)).toBe(7);
  });

  it("rethrows the string-message error a driver raises for anything else", () => {
    const repo = new CollectionListRepository(
      fakeClient({
        "FROM li_accounts": {
          get: () => {
            throw new Error("database disk image is malformed");
          },
        },
      }),
    );

    expect(() => repo.resolveInternalAccountId(7)).toThrow(
      "database disk image is malformed",
    );
  });

  it("resolves the internal id when the mapping row is present", () => {
    const repo = new CollectionListRepository(
      fakeClient({ "FROM li_accounts": { get: () => ({ id: 99 }) } }),
    );

    expect(repo.resolveInternalAccountId(7)).toBe(99);
  });
});

describe("CollectionListRepository.deleteCollection", () => {
  /**
   * Both sibling catches are pinned, and separately.  The two lines are
   * byte-identical, which is exactly the condition under which fixing one and
   * missing the other leaves a green suite.
   */
  const scriptedDelete = (
    statement: "collection_people_versions_logs" | "collection_people_versions",
    thrown: unknown,
  ): DatabaseClient =>
    fakeClient({
      "SELECT name FROM collections": { get: () => ({ name: "My List" }) },
      [`DELETE FROM ${statement} `]: {
        run: () => {
          throw thrown;
        },
      },
    });

  for (const statement of [
    "collection_people_versions_logs",
    "collection_people_versions",
  ] as const) {
    it(`rethrows a non-string-message error from the ${statement} delete`, () => {
      const raised = errorWithMessage(42);
      const repo = new CollectionListRepository(
        scriptedDelete(statement, raised),
      );

      let failure: unknown;
      try {
        repo.deleteCollection(1);
      } catch (error: unknown) {
        failure = error;
      }

      expect(failure).toBe(raised);
      expect(failure).not.toBeInstanceOf(TypeError);
    });

    it(`still absorbs a non-string constraint message from the ${statement} delete`, () => {
      const repo = new CollectionListRepository(
        scriptedDelete(
          statement,
          errorWithMessage({
            toString: () => "FOREIGN KEY constraint failed",
          }),
        ),
      );

      expect(repo.deleteCollection(1)).toBe(true);
    });

    it(`absorbs the string constraint message a driver raises from the ${statement} delete`, () => {
      const repo = new CollectionListRepository(
        scriptedDelete(statement, new Error("FOREIGN KEY constraint failed")),
      );

      expect(repo.deleteCollection(1)).toBe(true);
    });

    it(`rethrows the string-message error a driver raises for anything else from the ${statement} delete`, () => {
      const repo = new CollectionListRepository(
        scriptedDelete(statement, new Error("database is locked")),
      );

      expect(() => repo.deleteCollection(1)).toThrow("database is locked");
    });
  }

  it("returns false for a collection that is not a named list", () => {
    const repo = new CollectionListRepository(
      fakeClient({ "SELECT name FROM collections": { get: () => undefined } }),
    );

    expect(repo.deleteCollection(1)).toBe(false);
  });
});
