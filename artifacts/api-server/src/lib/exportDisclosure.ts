/** Recognise only our single-cell disclosure records, never arbitrary bad data. */
export function isExportDisclosureRow(row: unknown[]): boolean {
  const cells = row.map(cell => String(cell ?? "").trim()).filter(Boolean);
  if (cells.length !== 1) return false;
  const text = cells[0];
  const labelled = /^Showing: List name: ("(?:[^"\\]|\\.)*") · Type: (?:Included|Excluded) · Effect: (?:\d+ items hidden from results|only \d+ items shown)$/.exec(text);
  if (labelled) {
    try { return typeof JSON.parse(labelled[1]) === "string"; } catch { return false; }
  }
  return /^(?:Bucket lists: none applied\.?|Bucket lists do not apply here\.?|Display-only product filter; no source product or price data changed\.)$/.test(text)
    || /^Showing: .+ — (?:Included|Excluded) · \d+ items (?:shown|hidden)$/.test(text)
    || /^Bucket list applied: .+ \((?:Included|Excluded)\) - (?:showing only \d+ items|\d+ items hidden from results)$/.test(text);
}

/** Blank, don't remove: provenance/diagnostic worksheet row numbers stay intact. */
export function hideExportDisclosures(grid: unknown[][]): unknown[][] {
  return grid.map(row => isExportDisclosureRow(row) ? [] : row);
}

export function workbookHeaderRow(grid: unknown[][]): number {
  for (let row = 0; row < Math.min(grid.length, 15); row++) {
    if (isExportDisclosureRow(grid[row])) continue;
    const strings = grid[row].filter(cell =>
      typeof cell === "string" && cell.trim() && isNaN(Number(cell)));
    if (strings.length >= 2) return row;
  }
  return 0;
}