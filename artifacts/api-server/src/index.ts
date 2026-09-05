import app from "./app";
import { logger } from "./lib/logger";
import { seedCatalogIfEmpty, backfillCatalogSizes, seedVariantPricesIfEmpty } from "./lib/catalogSeed";
import { seedAdminUser } from "./lib/adminSeed";
import { applyChValveNameCorrections } from "./lib/chValveNameCorrections";

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

async function prepareCatalog() {
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
    const result = await applyChValveNameCorrections();
    logger.info(result, "Applied audited concealed-valve name corrections");
  } catch (correctionErr) {
    throw new Error("Failed to apply concealed-valve name corrections", {
      cause: correctionErr,
    });
  }
}

async function startServer() {
  await prepareCatalog();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

startServer().catch((err) => {
  logger.error({ err }, "API server startup failed");
  process.exit(1);
});
