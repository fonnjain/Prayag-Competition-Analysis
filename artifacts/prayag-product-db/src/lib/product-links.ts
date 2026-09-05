export function productDetailHref(itemCode: string): string {
  const params = new URLSearchParams({ itemCode });
  return `/product?${params.toString()}`;
}

export function productHistoryExportHref(itemCode: string): string {
  const params = new URLSearchParams({
    type: "history",
    format: "xlsx",
    itemCode,
  });
  return `/api/catalog/export?${params.toString()}`;
}

export function itemCodeFromLocation(
  search: string,
  legacyPathValue?: string,
): string {
  return (
    new URLSearchParams(search).get("itemCode")?.trim() ||
    legacyPathValue?.trim() ||
    ""
  );
}