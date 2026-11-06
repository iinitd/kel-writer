import { OpenCodeBackend } from "./adapter";
import type { OpenCodeConnectionOptions } from "./transport";

export type { OpenCodeConnectionOptions } from "./transport";

/** Connect and validate an OpenCode server before exposing it to the writer. */
export async function connectOpenCodeServer(options: OpenCodeConnectionOptions): Promise<OpenCodeBackend> {
  const backend = new OpenCodeBackend({ ...options, reconnectEnabled: false });
  try {
    await backend.connect();
    backend.setReconnectEnabled(true);
    return backend;
  } catch (error) {
    await backend.close().catch(() => {});
    throw error;
  }
}
