/**
 * POST /api/admin/seed-aliases
 * One-shot: seeds the SPARSH_ALIASES list into competitor_code_aliases for
 * production and reports what was inserted.  Protected by X-Repair-Key header
 * (same SESSION_SECRET used for the MRP repair).  Remove after use.
 */
import { Router, type IRouter } from "express";
import { db, competitorCodeAliasesTable } from "@workspace/db";

const router: IRouter = Router();

const SPARSH_ALIASES = [
  { oldCode: "WC-100",   newCode: "WC-180",   note: "Waste Coupling Half Thread 31/32mm (H/T)" },
  { oldCode: "PJS-255",  newCode: "PSJ-255",  note: "Jet Spray 1 Mtr — letters transposed" },
  { oldCode: "PJS-256",  newCode: "PSJ-256",  note: "Jet Spray 1.5 Mtr — letters transposed" },
  { oldCode: "WMH-2331", newCode: "WIH-2331", note: "Washing Machine Inlet Hose 1.5 Mtr" },
  { oldCode: "WMH-2332", newCode: "WIH-2332", note: "Washing Machine Inlet Hose 3 Mtr" },
  { oldCode: "RPS-2285", newCode: "RPS-2265", note: "Sink Mixer" },
  { oldCode: "WMP-186",  newCode: "WMP-188",  note: "Washing Machine Pipe 2 Mtr" },
  { oldCode: "WMP-188",  newCode: "WMP-189",  note: "Washing Machine Pipe 3 Mtr" },
];

router.post("/admin/seed-aliases", async (req, res) => {
  const key = req.headers["x-repair-key"];
  if (!key || key !== process.env.SESSION_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const competitor = "Sparsh Pearl";
  let inserted = 0;
  let skipped = 0;

  for (const a of SPARSH_ALIASES) {
    const rows = await db
      .insert(competitorCodeAliasesTable)
      .values({ competitor, oldCode: a.oldCode, newCode: a.newCode, note: a.note })
      .onConflictDoNothing()
      .returning();
    if (rows.length > 0) inserted++;
    else skipped++;
  }

  // Read back to confirm
  const all = await db.select().from(competitorCodeAliasesTable);
  res.json({ status: "ok", inserted, skipped, total: all.length, rows: all });
});

export default router;
