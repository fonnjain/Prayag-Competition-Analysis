import { describe, expect, it } from "vitest";
import {
  collisionSafeScenarioName,
  ensureDefaultP012Scenario,
  isVerifiedLegacyCanonical,
  isVerifiedP017Canonical,
  isVerifiedP017Policy,
  P017_CANONICAL_MARKER,
} from "./mrpGenerator";
import { DEFAULT_P012_SCENARIO } from "../lib/mrpGenerator";

const legacyRow = (overrides: Record<string, unknown> = {}) => ({
  name: DEFAULT_P012_SCENARIO.name,
  description: DEFAULT_P012_SCENARIO.description,
  scope: DEFAULT_P012_SCENARIO.scope,
  rules: { policyVersion: 3, policy: DEFAULT_P012_SCENARIO.policy },
  ...overrides,
});

describe("P017 migration identity and collision safety", () => {
  it("does not migrate a same-name arbitrary user scenario", () => {
    expect(isVerifiedLegacyCanonical(legacyRow({
      rules: { policyVersion: 3, policy: { ...DEFAULT_P012_SCENARIO.policy, holdBelow: 51 } },
    }))).toBe(false);
  });

  it("accepts only the verified marker or exact legacy signature", () => {
    expect(isVerifiedLegacyCanonical(legacyRow())).toBe(true);
    expect(isVerifiedLegacyCanonical(legacyRow({
      rules: { ...legacyRow().rules, p012DefaultKey: "canonical", policy: { holdBelow: "edited" } },
      description: "User edited description",
    }))).toBe(true);
  });

  it("chooses a deterministic unused superseded/user-saved name", () => {
    expect(collisionSafeScenarioName("5% below nearest (superseded)", [
      "5% below nearest (superseded)",
      "5% below nearest (superseded) 2",
    ])).toBe("5% below nearest (superseded) 3");
    expect(collisionSafeScenarioName("Capture where we are clearly below (user saved)", [
      "Capture where we are clearly below",
    ])).toBe("Capture where we are clearly below (user saved)");
  });

  it("recognizes the durable marker without relying on its display name", () => {
    expect(isVerifiedP017Canonical({
      ...legacyRow({ name: "User renamed P017" }),
      rules: { p017Migration: P017_CANONICAL_MARKER },
    })).toBe(true);
  });

  it("does not treat a new-name row carrying only the old marker/policy as P017", () => {
    expect(isVerifiedP017Canonical({
      ...legacyRow({ name: "Capture where we are clearly below" }),
      rules: { ...legacyRow().rules, p012DefaultKey: "canonical" },
    })).toBe(false);
    expect(isVerifiedP017Policy({
      ...legacyRow({ name: "Capture where we are clearly below" }),
      rules: { ...legacyRow().rules, p012DefaultKey: "canonical" },
    })).toBe(false);
  });

  it("executes the legacy-new-name migration before seeding P017 and is idempotent", async () => {
    const rows: any[] = [{
      id: 901017,
      name: "5% below nearest (legacy fixture)",
      description: DEFAULT_P012_SCENARIO.description,
      scope: JSON.stringify(DEFAULT_P012_SCENARIO.scope),
      rules: JSON.stringify({
        policyVersion: 3,
        p012DefaultKey: "canonical",
        policy: DEFAULT_P012_SCENARIO.policy,
      }),
    }, {
      id: 901019,
      name: "Capture where we are clearly below",
      description: DEFAULT_P012_SCENARIO.description,
      scope: JSON.stringify(DEFAULT_P012_SCENARIO.scope),
      rules: JSON.stringify({
        policyVersion: 3,
        p012DefaultKey: "canonical",
        policy: DEFAULT_P012_SCENARIO.policy,
      }),
    }];
    let updateIndex = 0;
    const fakeDatabase: any = {
      select: () => ({ from: async () => rows }),
      update: () => ({
        set: (changes: any) => ({
          where: () => ({
            returning: async () => {
              const row = rows[updateIndex++];
              Object.assign(row, changes);
              return [row];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (values: any) => ({
          returning: async () => {
            const row = { id: 901018, ...values };
            rows.push(row);
            return [row];
          },
        }),
      }),
    };
    const first = await ensureDefaultP012Scenario("p017-test", fakeDatabase);
    expect(rows.find((row) => row.id === 901017)).toEqual(expect.objectContaining({
      name: "5% below nearest (superseded)",
      description: expect.stringContaining("Superseded by P017"),
    }));
    expect(rows.find((row) => row.id === 901019)).toEqual(expect.objectContaining({
      name: "5% below nearest (superseded) 2",
      description: expect.stringContaining("Superseded by P017"),
    }));
    expect(first.name).toBe("Capture where we are clearly below");
    expect(JSON.parse(rows.find((row) => row.id === 901017).rules)).toEqual(expect.objectContaining({
      policyVersion: 3,
      policy: DEFAULT_P012_SCENARIO.policy,
    }));
    const second = await ensureDefaultP012Scenario("p017-test", fakeDatabase);
    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(3);
  });
});