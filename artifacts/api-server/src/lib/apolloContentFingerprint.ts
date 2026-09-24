import { createHash } from "node:crypto";
import type { ApolloMasterRow } from "./apolloMaster";

const normalize = (value: unknown): string => {
  const text = String(value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
  return text || "";
};

/** Stable identity for the parsed (priced) Apollo rows, independent of XLSX bytes. */
export function apolloContentFingerprint(rows: readonly ApolloMasterRow[]): string {
  const records = rows.map((row) => [
    normalize(row.category).toUpperCase(),
    normalize(row.description),
    normalize(row.size) || "",
    normalize(row.prayagCode).toUpperCase() || "",
    normalize(row.competitorCode).toUpperCase(),
    normalize(row.codeSource),
    Number(row.price).toFixed(2),
    normalize(row.sheet),
    String(Math.trunc(Number(row.sourceRow))),
  ].join("|")).sort();
  return createHash("sha256").update(records.join("\n"), "utf8").digest("hex");
}

export const APOLLO_TRUSTED_CONTENT_FINGERPRINT =
  "6b6c87af32eea3ff21d5f4fadd2af892e3d777ec182c998f54416216d1043181";