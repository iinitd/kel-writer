import { Platform } from "react-native";
import type { WriterBackend } from "../types";
import { OpenClawBackend } from "./adapter";
import type { OpenClawConnectionOptions } from "./transport";

export function createOpenClawClient(options: OpenClawConnectionOptions): WriterBackend {
  return new OpenClawBackend({
    ...options,
    platform: options.platform ?? Platform.OS,
    caps: options.caps ?? ["tool-events", "exec-approvals", "chat-only-assistant-text"],
  });
}

export async function connectOpenClawGateway(options: OpenClawConnectionOptions): Promise<WriterBackend> {
  const client = createOpenClawClient({ ...options, reconnectEnabled: false });
  try {
    await client.connect();
    client.setReconnectEnabled(true);
    return client;
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}
