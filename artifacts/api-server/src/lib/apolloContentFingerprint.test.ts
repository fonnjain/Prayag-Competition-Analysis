import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { parseApolloMaster } from "./apolloMaster";
import { apolloContentFingerprint, APOLLO_TRUSTED_CONTENT_FINGERPRINT } from "./apolloContentFingerprint";

const source = fileURLToPath(new URL("../../../../attached_assets/Competitor_Master_-_Plumbing_Apollo_1790252780224.xlsx", import.meta.url));

describe("P047 Apollo content fingerprint", () => {
  it("matches the trusted parsed priced-row hash", () => {
    expect(apolloContentFingerprint(parseApolloMaster(readFileSync(source)).rows))
      .toBe(APOLLO_TRUSTED_CONTENT_FINGERPRINT);
  });

  it("accepts XLSX.read -> XLSX.write reserialization, but rejects a price change", () => {
    const originalBytes = readFileSync(source);
    const originalBook = XLSX.read(originalBytes, { type: "buffer" });
    const reSavedBytes = XLSX.write(originalBook, { type: "buffer", bookType: "xlsx" });
    const reSavedBook = XLSX.read(reSavedBytes, { type: "buffer" });
    expect(Buffer.compare(originalBytes, reSavedBytes)).not.toBe(0);
    expect(reSavedBytes.length).not.toBe(originalBytes.length);
    expect(originalBook.SheetNames).toHaveLength(13);
    expect(originalBook.SheetNames[0]).toBe(" CPVC PIPE");
    expect(reSavedBook.SheetNames).toEqual(originalBook.SheetNames);

    const originalRows = parseApolloMaster(originalBytes).rows;
    const reSavedRows = parseApolloMaster(reSavedBytes).rows;
    expect(reSavedRows).toHaveLength(698);
    expect(reSavedRows).toEqual(originalRows);
    expect(apolloContentFingerprint(reSavedRows)).toBe(APOLLO_TRUSTED_CONTENT_FINGERPRINT);

    const changed = reSavedRows.map((row, index) => index === 0 ? { ...row, price: row.price + 0.01 } : { ...row });
    expect(apolloContentFingerprint(changed))
      .not.toBe(APOLLO_TRUSTED_CONTENT_FINGERPRINT);
  });
});