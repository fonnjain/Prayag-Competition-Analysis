import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./lib/seed";
import { seedCatalogIfEmpty, backfillCatalogSizes } from "./lib/catalogSeed";

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
    await seedIfEmpty();
  } catch (seedErr) {
    logger.error({ err: seedErr }, "Failed to seed database");
  }

  try {
    await seedCatalogIfEmpty();
    await backfillCatalogSizes();
  } catch (seedErr) {
    logger.error({ err: seedErr }, "Failed to seed product catalog");
  }
});
