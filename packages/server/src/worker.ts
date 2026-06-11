/**
 * Cloudflare Workers girişi (deploy hedefi) — DESIGN.md §6.2.
 */
import { createApp } from "./app.js";
import { buildProvider, type Env } from "./config.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = createApp({ provider: buildProvider(env) });
    return app.fetch(request);
  },
};
