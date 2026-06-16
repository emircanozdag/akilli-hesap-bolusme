/**
 * Cloudflare Workers girişi (deploy hedefi) — DESIGN.md §6.2.
 */
import { createApp } from "./app.js";
import { buildAssignmentProvider, buildProvider, type Env } from "./config.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = createApp({
      provider: buildProvider(env),
      assignmentProvider: buildAssignmentProvider(env),
    });
    return app.fetch(request);
  },
};
