import { Ollama, type Fetch } from "ollama";
import { Agent, fetch as undiciFetch } from "undici";

/** Long enough for a cold vision model on CPU; a hung Ollama still fails, and the job retries */
export const DEFAULT_OLLAMA_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * An Ollama client without Node fetch's 300 s limits. Ollama sends no headers until it has
 * loaded the model and read the prompt, and a vision model reading a page image on CPU can
 * take longer than that on its first call, which the built-in fetch reports as
 * UND_ERR_HEADERS_TIMEOUT.
 */
export function createOllamaClient(host: string, timeoutMs = DEFAULT_OLLAMA_TIMEOUT_MS): Ollama {
  const dispatcher = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
  const patient = (url: string, init?: RequestInit) =>
    undiciFetch(url, { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher });

  return new Ollama({ host, fetch: patient as unknown as Fetch });
}
