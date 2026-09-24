import { describe, expect, it } from "vitest";
import {
  apolloPipeIdentity,
  apolloPipeIdentityV2,
  assertApolloCodeAvailable,
  matchApolloPipe,
  normalizeApolloDescription,
  normalizeApolloSize,
  reserveAPUGD007,
  assertAPUGD007Owner,
  type ApolloPipeRow,
} from "./apolloPipeIdentity.js";

const local = (id: string, description: string, size: string, category = "SWR PIPE", prayagCode = `P-${id}`): ApolloPipeRow => ({
  id,
  competitorCode: `INT-${id}`,
  codeSource: "locally_assigned",
  description,
  size,
  category,
  prayagCode,
});

describe("P045 Apollo pipe identity", () => {
  it("normalizes case, Unicode, punctuation, whitespace, and unit synonyms", () => {
    expect(normalizeApolloDescription("  Ø-Pipe,  ÁGri  PIPE ")).toBe("ø pipe agri pipe");
    expect(normalizeApolloSize(" 15 MILLIMETRES ")).toBe("15mm");
    expect(apolloPipeIdentity("Ø-Pipe Ágri", "15 mm")).toBe(
      apolloPipeIdentity("ø pipe agri", "15 millimetre"),
    );
  });

  it("matches local rows by V2 identity, not their generated code", () => {
    const row = local("1", "UPVC pipe", "15 mm", "UPVC PIPE", "PU-1");
    expect(matchApolloPipe({ codeSource: "locally_assigned", competitorCode: "APU999", description: "edited heading", size: "15 millimetres", category: "upvc pipe", prayagCode: "pu-1" }, [row])).toEqual({
      kind: "matched",
      row,
      by: "identity",
    });
    expect(matchApolloPipe({ codeSource: "locally_assigned", competitorCode: "APU999", description: "UPVC pipe", size: "15 mm" }, [row]).kind).toBe("new");
  });

  it("matches supplier rows by code and refuses ambiguous local identities", () => {
    const supplier: ApolloPipeRow = { ...local("s", "fitting", "20 mm"), codeSource: "supplier", competitorCode: "ABC-1" };
    expect(matchApolloPipe({ codeSource: "supplier", competitorCode: "abc1", description: "unrelated", size: "1 m" }, [supplier]).kind).toBe("matched");
    const rows = [local("1", "SWR pipe", "110 mm", "SWR PIPE", "U-1"), local("2", "SWR PIPE", "110 millimetres", "SWR PIPE", "U-1")];
    expect(matchApolloPipe({ codeSource: "locally_assigned", competitorCode: null, description: "swr-pipe", size: "110mm", category: "swr pipe", prayagCode: "u-1" }, rows)).toMatchObject({ kind: "ambiguous" });
    expect(matchApolloPipe({ codeSource: "locally_assigned", competitorCode: "ABC-1", description: "other", size: "20mm" }, [supplier]).kind).toBe("new");
    expect(matchApolloPipe({ codeSource: "supplier", competitorCode: "MISSING", description: "SWR pipe", size: "110mm" }, rows).kind).toBe("new");
  });

  it("returns new for no match and rejects any existing minted code", () => {
    expect(matchApolloPipe({ codeSource: "locally_assigned", competitorCode: null, description: "new pipe", size: "1 m" }, []).kind).toBe("new");
    expect(() => assertApolloCodeAvailable("APC-001", ["APC001", "OTHER"])).toThrow(/already exists/);
    expect(() => assertApolloCodeAvailable("NEW-1", ["APC001"])).not.toThrow();
  });

  it("binds APUGD007 to one normalized owner and permits that owner when priced", () => {
    const reservation = reserveAPUGD007("UGD PIPE", "U-11B", "110 millimetres", {
      prayagCode: "U-11B",
      sheet: "UGD PIPE", sourceRow: 14,
    });
    expect(reservation.owner).toBe("v2|ugd pipe|U11B|110mm");
    expect(() => assertAPUGD007Owner("ugd pipe", "U11B", "110 mm", reservation)).not.toThrow();
    expect(() => assertAPUGD007Owner("ugd pipe", "U11C", "110 mm", reservation)).toThrow(/reserved for/);
  });

  it("creates V2 keys without heading text and rejects changed code or size", () => {
    const key = apolloPipeIdentityV2("UGD PIPE", "U-11B", "110");
    expect(key).toBe("v2|ugd pipe|U11B|110");
    expect(key).not.toContain("ring");
    expect(apolloPipeIdentityV2("UGD PIPE", "U-11C", "110")).not.toBe(key);
    expect(apolloPipeIdentityV2("UGD PIPE", "U-11B", "90")).not.toBe(key);
    expect(apolloPipeIdentityV2("UGD PIPE", "U-11B", "110")).toBe(key);
  });
});
