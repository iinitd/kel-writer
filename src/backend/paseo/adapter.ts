import type { DaemonClient, DaemonEvent } from "@getpaseo/client/internal/daemon-client";
import type {
  BackendAgentStreamMessage,
  BackendAgentUpdateMessage,
  BackendPermissionRequestMessage,
  BackendPermissionResponse,
  ConnectionState,
  CreateAgentOptions,
  FetchAgentsOptions,
  FetchAgentTimelineOptions,
  WriterBackend,
} from "../types";
import {
  mapAgent,
  mapAgentEntry,
  mapAgentStream,
  mapAgentTimeline,
  mapAgentUpdate,
  mapConnectionState,
  mapDirectory,
  mapFile,
  mapPermissionMessage,
  mapProvidersSnapshot,
  mapWorkspace,
} from "./mappers";

/** Private implementation; callers receive only the WriterBackend contract. */
export class PaseoBackend implements WriterBackend {
  readonly kind = "paseo" as const;

  constructor(private readonly client: DaemonClient) {}

  connect(): Promise<void> {
    return this.client.connect();
  }

  close(): Promise<void> {
    return this.client.close();
  }

  setReconnectEnabled(enabled: boolean): void {
    this.client.setReconnectEnabled(enabled);
  }

  getConnectionState(): ConnectionState {
    return mapConnectionState(this.client.getConnectionState());
  }

  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void {
    return this.client.subscribeConnectionStatus((state) => listener(mapConnectionState(state)));
  }

  getLastServerInfoMessage(): { version: string | null } | null {
    const info = this.client.getLastServerInfoMessage();
    return info ? { version: info.version } : null;
  }

  async fetchWorkspaces() {
    const result = await this.client.fetchWorkspaces();
    return {
      entries: result.entries.map(mapWorkspace),
      pageInfo: { hasMore: result.pageInfo.hasMore, nextCursor: result.pageInfo.nextCursor },
    };
  }

  async fetchAgents(options?: FetchAgentsOptions) {
    const result = await this.client.fetchAgents(options ? {
      scope: options.scope,
      filter: options.filter ? { includeArchived: options.filter.includeArchived } : undefined,
      sort: options.sort?.map((sort) => ({ key: sort.key, direction: sort.direction })),
      page: options.page ? { limit: options.page.limit, cursor: options.page.cursor } : undefined,
    } : undefined);
    return {
      entries: result.entries.map(mapAgentEntry),
      pageInfo: { hasMore: result.pageInfo.hasMore, nextCursor: result.pageInfo.nextCursor },
    };
  }

  async fetchAgent(agentId: string) {
    const result = await this.client.fetchAgent(agentId);
    return result ? { agent: mapAgent(result.agent) } : null;
  }

  async createAgent(options: CreateAgentOptions) {
    return mapAgent(await this.client.createAgent({
      provider: options.provider,
      cwd: options.cwd,
      model: options.model,
      workspaceId: options.workspaceId,
      initialPrompt: options.initialPrompt,
    }));
  }

  async archiveAgent(agentId: string): Promise<void> {
    await this.client.archiveAgent(agentId);
  }

  cancelAgent(agentId: string): Promise<void> {
    return this.client.cancelAgent(agentId);
  }

  setAgentModel(agentId: string, model: string | null): Promise<void> {
    return this.client.setAgentModel(agentId, model);
  }

  sendAgentMessage(agentId: string, text: string, options?: { messageId?: string }): Promise<void> {
    return this.client.sendAgentMessage(agentId, text, options ? { messageId: options.messageId } : undefined);
  }

  async fetchAgentTimeline(agentId: string, options?: FetchAgentTimelineOptions) {
    return mapAgentTimeline(await this.client.fetchAgentTimeline(agentId, options ? {
      direction: options.direction,
      projection: options.projection,
      limit: options.limit,
    } : undefined));
  }

  async listDirectory(cwd: string, path: string) {
    return mapDirectory(await this.client.listDirectory(cwd, path));
  }

  async readFile(cwd: string, path: string) {
    return mapFile(await this.client.readFile(cwd, path));
  }

  async getProvidersSnapshot(options?: { cwd?: string }) {
    return mapProvidersSnapshot(await this.client.getProvidersSnapshot(
      options ? { cwd: options.cwd } : undefined,
    ));
  }

  respondToPermission(agentId: string, requestId: string, response: BackendPermissionResponse): Promise<void> {
    return this.client.respondToPermission(agentId, requestId, {
      behavior: response.behavior,
      selectedActionId: response.selectedActionId,
    });
  }

  onAgentStream(listener: (message: BackendAgentStreamMessage) => void): () => void {
    return this.client.subscribe((message: DaemonEvent) => {
      if (message.type === "agent_stream") listener(mapAgentStream(message));
    });
  }

  onAgentUpdate(listener: (message: BackendAgentUpdateMessage) => void): () => void {
    return this.client.subscribe((message: DaemonEvent) => {
      if (message.type !== "agent_update") return;
      const update = mapAgentUpdate(message);
      if (update) listener(update);
    });
  }

  onPermissionRequest(listener: (message: BackendPermissionRequestMessage) => void): () => void {
    return this.client.subscribe((message: DaemonEvent) => {
      if (message.type === "agent_permission_request") listener(mapPermissionMessage(message));
    });
  }
}
