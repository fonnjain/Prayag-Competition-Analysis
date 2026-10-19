export type WorkspaceApp =
  | "home"
  | "product-database"
  | "competition-analysis"
  | "mrp-generator"
  | "price-finder"
  | "admin";

const WORKSPACE_LINKS = [
  { app: "home", href: "/", label: "Home" },
  { app: "product-database", href: "/product-db/", label: "Product Database" },
  { app: "competition-analysis", href: "/analysis/", label: "Competition Analysis" },
  { app: "mrp-generator", href: "/analysis/mrp-generator", label: "MRP Generator" },
  { app: "price-finder", href: "/price-finder/", label: "Price Finder" },
  { app: "admin", href: "/admin", label: "Admin" },
] as const;

/** Presentation only, never an authorization guard. A resolved anonymous visitor
 * deliberately sees protected non-admin apps so those links can lead to sign-in.
 * While identity is unresolved, no app links are shown (the header's prior rule).
 */
export function getWorkspaceLinks(
  user: { role?: string | null } | null,
  isLoading = false,
) {
  if (isLoading) return [];
  const restricted = user?.role === "user" || user?.role === "counter";
  return WORKSPACE_LINKS.filter((link) =>
    (!restricted || link.app === "price-finder") &&
    (user?.role === "admin" || (link.app !== "admin" && link.app !== "mrp-generator")),
  );
}
