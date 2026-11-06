import type { BackendPermissionResponse, ConnectionState, CreateAgentOptions, FetchAgentsOptions, FetchAgentTimelineOptions, WriterBackend } from "../types";
import { OpenClawEvents } from "./events";
import { OpenClawFiles } from "./files";
import { OpenClawModels } from "./models";
import { OpenClawSessionRegistry, uniqueId, type OpenClawFileScope } from "./sessions";
import { OpenClawTransport, type OpenClawConnectionOptions } from "./transport";
import { asRecord, OpenClawRpcError } from "./wire";

/** All OpenClaw protocol details remain behind the WriterBackend contract. */
export class OpenClawBackend implements WriterBackend {
  readonly kind = "openclaw" as const;
  readonly transport: OpenClawTransport;
  readonly sessions: OpenClawSessionRegistry;
  private readonly events: OpenClawEvents;
  private readonly models: OpenClawModels;
  private readonly files: OpenClawFiles;

  constructor(options: OpenClawConnectionOptions) {
    this.transport = new OpenClawTransport({ ...options, caps: [...new Set([...(options.caps ?? []), "tool-events", "exec-approvals", "chat-only-assistant-text"])] });
    this.models = new OpenClawModels(this.transport);
    this.sessions = new OpenClawSessionRegistry(this.transport, this.models, options.storage);
    this.events = new OpenClawEvents(this.transport, this.sessions);
    this.files = new OpenClawFiles(this.transport, (cwd) => this.resolveFileScope(cwd));
  }

  async connect(): Promise<void> {
    await this.transport.connect();
    for (const method of ["agents.list", "sessions.list", "chat.history", "chat.send", "chat.abort", "models.list"]) {
      if (!this.transport.hasMethod(method)) throw new OpenClawRpcError("NOT_IMPLEMENTED", `This OpenClaw gateway does not support the required ${method} method.`);
    }
    await this.events.whenReady();
  }
  async close(): Promise<void> { this.events.close(); await this.transport.close(); }
  setReconnectEnabled(enabled: boolean): void { this.transport.setReconnectEnabled(enabled); }
  getConnectionState(): ConnectionState { return this.transport.getConnectionState(); }
  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void { return this.transport.subscribeConnectionStatus(listener); }
  getLastServerInfoMessage(): { version: string | null } | null { return this.transport.getLastServerInfoMessage(); }
  fetchWorkspaces() { return this.sessions.fetchWorkspaces(); }
  fetchAgents(options?: FetchAgentsOptions) { return this.sessions.fetchAgents(options); }
  async fetchAgent(key: string) { const result = await this.sessions.fetchAgent(key); if (result) await this.events.track(key); return result; }
  async createAgent(options: CreateAgentOptions) {
    const agent = await this.sessions.createAgent(options);
    await this.events.track(agent.id); this.events.publishAgent(agent.id);
    if (options.initialPrompt) {
      try { await this.sendAgentMessage(agent.id, options.initialPrompt); }
      catch (error) { this.events.reportError(agent.id, error); }
    }
    return this.sessions.getAgent(agent.id) ?? agent;
  }
  async archiveAgent(key: string): Promise<void> { await this.sessions.archiveAgent(key); this.events.publishAgent(key); }
  cancelAgent(key: string): Promise<void> { return this.events.cancel(key); }
  async setAgentModel(key: string, model: string | null): Promise<void> { await this.sessions.setAgentModel(key, model); this.events.publishAgent(key); }
  async sendAgentMessage(key: string, text: string, options?: { messageId?: string }): Promise<void> {
    await this.events.whenReady(); await this.events.track(key);
    const scope = await this.sessions.ensureScope(key);
    const messageId = options?.messageId ?? uniqueId();
    this.events.registerInput(key, messageId, text);
    try {
      const result = asRecord(await this.transport.request("chat.send", { sessionKey: key, agentId: scope.agentId, message: text, idempotencyKey: messageId }));
      this.events.acceptInput(key, messageId, result);
    } catch (error) { this.events.forgetInput(key, messageId); throw error; }
  }
  fetchAgentTimeline(key: string, options?: FetchAgentTimelineOptions) { return this.events.fetchTimeline(key, options); }
  setActiveAgent(key: string | null): void { this.sessions.setActiveAgent(key); }
  resolveFileScope(cwd: string): Promise<OpenClawFileScope> { return this.sessions.resolveFileScope(cwd); }
  listDirectory(cwd: string, path: string) { return this.files.listDirectory(cwd, path); }
  readFile(cwd: string, path: string) { return this.files.readFile(cwd, path); }
  async getProvidersSnapshot(options?: { cwd?: string }) {
    const scope = options?.cwd ? await this.resolveFileScope(options.cwd) : undefined;
    return this.models.snapshot(scope);
  }
  respondToPermission(key: string, requestId: string, response: BackendPermissionResponse): Promise<void> {
    if (response.behavior !== "allow") return Promise.reject(new Error("Unsupported OpenClaw approval response."));
    return this.events.respondToPermission(key, requestId, response.selectedActionId);
  }
  onAgentStream: WriterBackend["onAgentStream"] = (listener) => this.events.onAgentStream(listener);
  onAgentUpdate: WriterBackend["onAgentUpdate"] = (listener) => this.events.onAgentUpdate(listener);
  onPermissionRequest: WriterBackend["onPermissionRequest"] = (listener) => this.events.onPermissionRequest(listener);
}
