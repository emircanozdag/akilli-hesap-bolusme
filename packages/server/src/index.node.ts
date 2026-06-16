/**
 * Yerel geliştirme girişi (Node). `npm run dev -w @ahb/server`.
 * Anahtar yoksa MockProvider ile çalışır → uçtan uca anahtarsız test.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { config as loadEnv } from "dotenv";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { buildAssignmentProvider, buildProvider } from "./config.js";

// packages/server/.env dosyasını yükle (Git'e sızmaz, .gitignore'da).
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "../.env") });

const provider = buildProvider(process.env);
const assignmentProvider = buildAssignmentProvider(process.env);
const app = createApp({ provider, assignmentProvider });
const port = Number(process.env.PORT ?? 8787);

function lanAddresses(): string[] {
  const ips: string[] = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`AHB server (provider: ${provider.name}) → http://localhost:${info.port}`);
  for (const ip of lanAddresses()) {
    console.log(`  LAN → http://${ip}:${info.port}`);
  }
});
