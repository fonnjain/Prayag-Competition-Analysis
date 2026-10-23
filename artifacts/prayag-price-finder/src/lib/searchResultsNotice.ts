import { createElement } from "react";

/** Kept outside the scrollable options; a server cap must be visible immediately. */
export function SearchResultsNotice({ text, testId }: { text: string; testId: string }) {
  return createElement("p", {
    role: "status",
    className: "shrink-0 border-b px-3 py-2 text-xs text-muted-foreground",
    "data-testid": testId,
  }, text);
}
