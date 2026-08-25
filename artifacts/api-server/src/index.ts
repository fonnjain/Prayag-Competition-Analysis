import app from "./app";
import { logger } from "./lib/logger";
import { seedCatalogIfEmpty, backfillCatalogSizes, seedVariantPricesIfEmpty } from "./lib/catalogSeed";
import { seedAdminUser } from "./lib/adminSeed";
import { correctSparshVol62EffectiveDate } from "./lib/competitorPeriodCorrection";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  try {
    await seedAdminUser();
  } catch (seedErr) {
    logger.error({ err: seedErr }, "Failed to seed admin user");
  }

  try {
    await seedCatalogIfEmpty();
    await backfillCatalogSizes();
  } catch (seedErr) {
    logger.error({ err: seedErr }, "Failed to seed product catalog");
  }

  try {
    await seedVariantPricesIfEmpty();
  } catch (seedErr) {
    logger.error({ err: seedErr }, "Failed to seed sanitaryware variant prices");
  }

  try {
    const correction = await correctSparshVol62EffectiveDate();
    logger.info(correction, "Checked Sparsh Vol 6.2 effective-date correction");
  } catch (correctionErr) {
    logger.fatal(
      { err: correctionErr },
      "Sparsh Vol 6.2 effective-date correction preflight failed",
    );
    process.exit(1);
  }
});
