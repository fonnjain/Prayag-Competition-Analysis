import { describe, expect, it } from "vitest";
import { assertTestDatabaseName } from "./testDatabaseGuard";

describe("API suite database-target guard", () => {
  it("rejects an outside database name with no fixture setup", () => {
    expect(() => assertTestDatabaseName("neondb")).toThrow(
      'Refusing to run API tests: PostgreSQL current_database() = "neondb" is not an allowed development/test database.',
    );
  });

  it("allows only the explicitly named development and test databases", () => {
    expect(() => assertTestDatabaseName("heliumdb")).not.toThrow();
    expect(() => assertTestDatabaseName("heliumdb_test")).not.toThrow();
    expect(() => assertTestDatabaseName("heliumdb-copy")).toThrow(/Refusing to run API tests/);
  });
});