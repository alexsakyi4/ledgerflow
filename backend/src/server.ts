import "dotenv/config";
import app from "./app";
import { env } from "./config/env";
import { db } from "./config/db";

const server = app.listen(Number(env.PORT), "0.0.0.0", () => {
  console.log(`🚀 Accounting API listening on port ${env.PORT}`);
  console.log(`📦 Environment: ${env.NODE_ENV}`);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  server.close();
  await db.$disconnect();
  process.exit(0);
});
