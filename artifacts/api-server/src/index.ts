import app from "./app";
import { logger } from "./lib/logger";
import { seedCapabilities } from "./lib/seed-capabilities";

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

seedCapabilities()
  .then(() => logger.info("Capabilities seeded"))
  .catch((err) => logger.warn({ err }, "Capability seed failed (non-fatal)"));

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
