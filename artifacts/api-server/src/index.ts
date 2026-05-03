import app from "./app";
import { logger } from "./lib/logger";
import { env } from "./lib/env";
import { seedCapabilities } from "./lib/seed-capabilities";

seedCapabilities()
  .then(() => logger.info("Capabilities seeded"))
  .catch((err) => logger.warn({ err }, "Capability seed failed (non-fatal)"));

app.listen(env.PORT, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port: env.PORT, env: env.NODE_ENV }, "Server listening");
});
