import type { ReactNode } from "react";

/** One placement rule: title left, existing bucket control right, on one row. */
export function BucketPageHeader({ title, control }: { title: ReactNode; control: ReactNode }) {
  return (
    <header data-testid="bucket-page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, width: "100%" }}>
      <div data-testid="bucket-page-title" style={{ minWidth: 0, flex: "1 1 auto" }}>{title}</div>
      <div data-testid="bucket-header-control" style={{ marginLeft: "auto", minWidth: 0, maxWidth: "65%", flex: "0 1 auto" }}>{control}</div>
    </header>
  );
}