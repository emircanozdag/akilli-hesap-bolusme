/**
 * Node fetch sarmalayıcısı — global fetch'in 10 sn bağlantı zaman aşımını uzatır.
 * Gemini'ye ilk TLS bağlantısı yavaş ağda 10 sn'yi aşabiliyordu (UND_ERR_CONNECT_TIMEOUT).
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Agent, fetch: undiciFetch } = require("undici") as {
  Agent: new (opts: {
    connect?: { timeout?: number };
    bodyTimeout?: number;
    headersTimeout?: number;
  }) => unknown;
  fetch: (url: string, init?: Record<string, unknown>) => Promise<Response>;
};

const CONNECT_TIMEOUT_MS = 30_000;
const BODY_TIMEOUT_MS = 90_000;

const agent = new Agent({
  connect: { timeout: CONNECT_TIMEOUT_MS },
  bodyTimeout: BODY_TIMEOUT_MS,
  headersTimeout: BODY_TIMEOUT_MS,
});

/** GeminiProvider'a enjekte edilecek fetch (yalnızca Node sunucu). */
export const geminiFetch: typeof fetch = ((url, init) =>
  undiciFetch(url as string, { ...init, dispatcher: agent })) as typeof fetch;
