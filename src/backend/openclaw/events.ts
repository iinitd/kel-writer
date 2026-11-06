import type { BackendAgentStreamMessage, BackendAgentTimeline, BackendAgentUpdateMessage, BackendPermissionRequest, BackendPermissionRequestMessage, BackendStreamEvent, BackendTimelineEntry, BackendTimelineItem, FetchAgentTimelineOptions } from "../types";
import { messageAliases, messageId, messageText, projectHistory, projectMessage, sameHistoryItem, type OpenClawHistoryItem } from "./history";
import { OpenClawSessionRegistry, isoTime, uniqueId } from "./sessions";
import type { OpenClawTransport } from "./transport";
import { asNumber, asRecord, asString, isRecord, OpenClawRpcError, type GatewayEvent } from "./wire";

type RecordItem = OpenClawHistoryItem & { seqStart: number; seqEnd: number; runId?: string };
type Run = { text: string; segment: number; segmentOffset: number; segmentClosed: boolean; reasoning: string; finished: boolean; chatSeq: number; agentSeq: number; aliases: string[]; retired: OpenClawHistoryItem[]; sessionAbortable?: boolean };
type Input = { text: string; echoed: boolean; runId?: string };
type Journal = { epoch: string; seq: number; revision: number; sessionId?: string; lifecycleRevision?: string; records: Map<string, RecordItem>; known: Map<string, OpenClawHistoryItem>; runs: Map<string, Run>; inputs: Map<string, Input> };
type Listener<T> = (message: T) => void;

function subscribe<T>(set: Set<Listener<T>>, listener: Listener<T>): () => void {
  set.add(listener); return () => { set.delete(listener); };
}
function notify<T>(set: Set<Listener<T>>, value: T): void {
  for (const listener of [...set]) if (set.has(listener)) { try { listener(value); } catch { /* Isolate subscriber failures. */ } }
}

/** Owns the local sequence domain: transport seq and transcript messageSeq never mix. */
export class OpenClawEvents {
  private readonly journals = new Map<string, Journal>();
  private readonly tracked = new Set<string>();
  private readonly subscribed = new Set<string>();
  private readonly subscribing = new Map<string, Promise<void>>();
  private readonly streamListeners = new Set<Listener<BackendAgentStreamMessage>>();
  private readonly updateListeners = new Set<Listener<BackendAgentUpdateMessage>>();
  private readonly permissionListeners = new Set<Listener<BackendPermissionRequestMessage>>();
  private readonly approvals = new Map<string, { key: string; request: BackendPermissionRequest }>();
  private readonly recovering = new Map<string, GatewayEvent[]>();
  private readonly stopEvents: () => void;
  private readonly stopStatus: () => void;
  private closed = false;
  private generation = 0;
  private ready: Promise<void> = Promise.resolve();
  private recoveryFailed = false;

  constructor(private readonly transport: OpenClawTransport, private readonly sessions: OpenClawSessionRegistry) {
    this.stopEvents = transport.onEvent((event) => this.receive(event));
    this.stopStatus = transport.subscribeConnectionStatus((state) => {
      if (state.status === "disconnected" || state.status === "disposed") {
        this.generation++; this.subscribed.clear(); this.subscribing.clear();
        // A partial buffer from a dead connection cannot be the starting point
        // for incremental deltas. Rebuild it from authoritative history first.
        for (const [key, journal] of this.journals) {
          for (const [id, row] of journal.records) if (row.runId && !journal.runs.get(row.runId)?.finished) journal.records.delete(id);
          journal.runs.clear(); this.recovering.set(key, []);
        }
      }
      if (state.status === "connected" && !this.closed) this.beginRecovery();
    });
  }

  onAgentStream(listener: Listener<BackendAgentStreamMessage>): () => void { return subscribe(this.streamListeners, listener); }
  onAgentUpdate(listener: Listener<BackendAgentUpdateMessage>): () => void { return subscribe(this.updateListeners, listener); }
  onPermissionRequest(listener: Listener<BackendPermissionRequestMessage>): () => void { return subscribe(this.permissionListeners, listener); }
  whenReady(): Promise<void> {
    if (this.closed) return Promise.reject(new OpenClawRpcError("DISPOSED", "OpenClaw backend is closed."));
    // A failed reconciliation must not permanently poison the connected backend.
    // The next explicit read/send retries subscriptions and authoritative history.
    if (this.recoveryFailed && this.transport.getConnectionState().status === "connected") this.beginRecovery();
    return this.ready;
  }

  private beginRecovery(): void {
    const generation = ++this.generation;
    this.recoveryFailed = false;
    for (const key of this.tracked) this.recovering.set(key, []);
    this.ready = this.reconnect().catch((error: unknown) => {
      if (!this.closed && generation === this.generation) {
        this.generation++; this.recoveryFailed = true;
        this.recovering.clear(); this.subscribed.clear(); this.subscribing.clear();
        for (const key of this.tracked) {
          const item: BackendTimelineItem = { type: "error", message: error instanceof Error ? error.message : "OpenClaw stream recovery failed." };
          this.put(key, { key: `recovery-error:${uniqueId()}`, item, timestamp: new Date().toISOString(), aliases: [] }, item);
        }
      }
      throw error;
    });
    // Automatic reconnection has no caller awaiting its promise. Explicit reads
    // still observe the rejection, and subsequent calls can retry via whenReady.
    void this.ready.catch(() => {});
  }
  publishAgent(key: string): void {
    const agent = this.sessions.getAgent(key); if (agent) notify(this.updateListeners, { agentId: key, agent });
  }
  reportError(key: string, error: unknown): void {
    const item: BackendTimelineItem = { type: "error", message: error instanceof Error ? error.message : "OpenClaw request failed." };
    this.put(key, { key: `error:${uniqueId()}`, item, timestamp: new Date().toISOString(), aliases: [] }, item);
    this.sessions.updateStatus(key, "error"); this.publishAgent(key);
    this.emit(key, { type: "turn_failed" });
  }

  private journal(key: string): Journal {
    let journal = this.journals.get(key);
    if (!journal) { journal = { epoch: uniqueId(), seq: 0, revision: 0, records: new Map(), known: new Map(), runs: new Map(), inputs: new Map() }; this.journals.set(key, journal); }
    return journal;
  }

  private emit(key: string, event: BackendStreamEvent): number {
    const journal = this.journal(key);
    const seq = ++journal.seq;
    notify(this.streamListeners, { agentId: key, event, epoch: journal.epoch, seq });
    return seq;
  }

  private invalidate(key: string, reset = false): void {
    const journal = this.journal(key);
    if (reset) {
      journal.revision++; journal.epoch = uniqueId(); journal.seq = 0;
      journal.records.clear(); journal.known.clear(); journal.runs.clear(); journal.inputs.clear();
    }
    // Parent handles this additive signal by refetching a coherent snapshot.
    // Reset rotates the local epoch before the parent begins history catch-up.
    this.emit(key, { type: "timeline_invalidated" });
  }

  private incarnation(key: string, row: Record<string, unknown>): void {
    const journal = this.journal(key);
    const sessionId = asString(row.sessionId);
    const lifecycleRevision = asString(row.lifecycleRevision);
    if ((sessionId && journal.sessionId && sessionId !== journal.sessionId) ||
      (lifecycleRevision && journal.lifecycleRevision && lifecycleRevision !== journal.lifecycleRevision)) this.invalidate(key, true);
    if (sessionId) journal.sessionId = sessionId;
    if (lifecycleRevision) journal.lifecycleRevision = lifecycleRevision;
  }

  private put(key: string, row: OpenClawHistoryItem, liveItem?: BackendTimelineItem, runId?: string): void {
    const journal = this.journal(key);
    const existing = journal.records.get(row.key);
    const seq = liveItem ? journal.seq + 1 : journal.seq;
    journal.records.set(row.key, { ...row, seqStart: existing?.seqStart ?? seq, seqEnd: seq, runId: runId ?? existing?.runId });
    if (liveItem) this.emit(key, { type: "timeline", item: liveItem });
  }

  async track(key: string): Promise<void> {
    this.tracked.add(key); this.journal(key);
    if (this.subscribed.has(key) || !this.transport.hasMethod("sessions.messages.subscribe")) return;
    const existing = this.subscribing.get(key); if (existing) return existing;
    const generation = this.generation;
    const request = (async () => {
      const scope = await this.sessions.ensureScope(key);
      await this.transport.request("sessions.messages.subscribe", { key, agentId: scope.agentId });
      if (!this.closed && this.generation === generation) this.subscribed.add(key);
    })();
    this.subscribing.set(key, request);
    try { await request; } finally { if (this.subscribing.get(key) === request) this.subscribing.delete(key); }
  }

  private async reconnect(): Promise<void> {
    const generation = this.generation;
    if (this.transport.hasMethod("sessions.subscribe")) await this.transport.request("sessions.subscribe", {});
    await Promise.all([...this.tracked].map(async (key) => {
      if (!this.recovering.has(key)) this.recovering.set(key, []);
      if (!await this.sessions.fetchAgent(key)) throw new OpenClawRpcError("SESSION_NOT_FOUND", `OpenClaw session ${key} is no longer available.`);
      await this.track(key);
      for (let attempt = 0; ; attempt++) {
        try { await this.loadTimeline(key); break; }
        catch (error) {
          // Metadata can reveal a reset only after a response arrives. Its old
          // transcript is rejected; retry against the newly cached incarnation.
          if (!(error instanceof OpenClawRpcError) || error.code !== "HISTORY_INVALIDATED" ||
            attempt >= 2 || this.closed || generation !== this.generation) throw error;
        }
      }
      if (this.closed || generation !== this.generation) return;
      const queued = this.recovering.get(key) ?? [];
      this.recovering.delete(key);
      for (const event of queued) this.receive(event);
      this.invalidate(key);
    }));
  }

  registerInput(key: string, id: string, text: string): void {
    const journal = this.journal(key);
    const existing = journal.inputs.get(id);
    if (existing && existing.text !== text) throw new Error("An OpenClaw message ID cannot be reused for different text.");
    if (!existing) journal.inputs.set(id, { text, echoed: false });
  }

  acceptInput(key: string, id: string, result: Record<string, unknown>): void {
    const journal = this.journal(key);
    const input = journal.inputs.get(id); if (!input) return;
    input.runId = asString(result.runId) ?? input.runId;
    if (!input.echoed) {
      input.echoed = true;
      this.put(key, { key: `input:${id}:user`, item: { type: "user_message", text: input.text, messageId: id }, timestamp: new Date().toISOString(), aliases: [`input:${id}`] }, { type: "user_message", text: input.text, messageId: id });
    }
    // Acceptance (including queue admission) is not run completion.
    if (result.status === "started" || result.status === "accepted" || result.status === "queued") {
      this.sessions.updateStatus(key, "running"); this.publishAgent(key);
    }
  }

  forgetInput(key: string, id: string): void {
    const input = this.journal(key).inputs.get(id);
    if (input && !input.echoed) this.journal(key).inputs.delete(id);
  }

  private run(key: string, runId: string, live = true): Run {
    const journal = this.journal(key);
    let run = journal.runs.get(runId);
    if (!run) {
      run = { text: "", segment: 0, segmentOffset: 0, segmentClosed: false, reasoning: "", finished: false, chatSeq: -1, agentSeq: -1, aliases: [`run:${runId}`], retired: [] };
      const input = [...journal.inputs.entries()].find(([id, entry]) => entry.runId === runId || id === runId);
      if (input) {
        if (live && !input[1].echoed) this.acceptInput(key, input[0], { runId });
      }
      journal.runs.set(runId, run);
      this.sessions.updateStatus(key, "running");
      if (live) { this.emit(key, { type: "turn_started" }); this.publishAgent(key); }
    }
    return run;
  }

  private assistant(key: string, runId: string, text: string, aliases: string[], live = true): void {
    const run = this.run(key, runId, live);
    if (run.finished) return;
    const previous = run.text;
    if (text === previous) {
      run.aliases = [...new Set([...run.aliases, ...aliases])];
      const record = this.journal(key).records.get(`run:${runId}:assistant:${run.segment}`);
      if (record) record.aliases = run.aliases;
      return;
    }
    if (run.segmentClosed) {
      run.segment++; run.segmentOffset = text.startsWith(previous) ? previous.length : 0; run.segmentClosed = false;
      run.aliases = [`run:${runId}`];
    }
    run.aliases = [...new Set([...run.aliases, ...aliases])];
    run.text = text;
    const id = `openclaw-run:${runId}:${run.segment}`;
    const replacement = !text.startsWith(previous) && this.journal(key).records.has(`run:${runId}:assistant:${run.segment}`);
    const segmentText = text.slice(run.segmentOffset);
    const liveItem: BackendTimelineItem & { replace?: boolean } = { type: "assistant_message", text: replacement ? segmentText : text.startsWith(previous) ? text.slice(previous.length) : segmentText, messageId: id, ...(replacement ? { replace: true } : {}) };
    this.put(key, { key: `run:${runId}:assistant:${run.segment}`, item: { type: "assistant_message", text: segmentText, messageId: id }, timestamp: new Date().toISOString(), aliases: run.aliases }, live ? liveItem : undefined, runId);
  }

  private receive(event: GatewayEvent): void {
    if (this.closed) return;
    const payload = asRecord(event.payload);
    const key = asString(payload.sessionKey) ?? asString(payload.key);
    if (key && this.recovering.has(key)) { this.recovering.get(key)!.push(event); return; }
    if (event.event === "exec.approval.requested") { this.approval(payload); return; }
    if (event.event === "exec.approval.resolved") {
      const id = asString(payload.id); const approval = id ? this.approvals.get(id) : undefined;
      if (approval) { this.approvals.delete(id!); this.emit(approval.key, { type: "permission_resolved" }); }
      return;
    }
    if (!key) return;
    const metadata: Record<string, unknown> = isRecord(payload.session) ? payload.session : {
      ...(asString(payload.sessionId) ? { sessionId: payload.sessionId } : {}),
      ...(asString(payload.lifecycleRevision) ? { lifecycleRevision: payload.lifecycleRevision } : {}),
    };
    // Cache identity before invalidation listeners request another snapshot;
    // otherwise ensureScope would rotate the journal back to its old identity.
    if (Object.keys(metadata).length) this.sessions.upsert(metadata, key);
    this.incarnation(key, metadata);
    if (isRecord(payload.session)) this.publishAgent(key);
    if (event.event === "sessions.changed") {
      const reason = asString(payload.reason) ?? "";
      // History resets also arrive as phase=message without a message identity.
      const reset = ["reset", "new", "rewind", "delete"].includes(reason) ||
        (payload.phase === "message" && !asString(payload.messageId) && asNumber(payload.messageSeq) === undefined);
      if (reset) this.invalidate(key, true);
      else if (payload.phase === "message" && !this.journal(key).known.has(`message:${asString(payload.messageId)}:user`) &&
        ![...this.journal(key).known.values()].some((row) => row.aliases.includes(`message:${asString(payload.messageId)}`))) this.invalidate(key);
      this.publishAgent(key); return;
    }
    if (event.event === "chat") this.chat(key, payload);
    else if (event.event === "agent") this.agent(key, payload);
    else if (event.event === "session.message") this.committed(key, payload);
  }

  private chat(key: string, payload: Record<string, unknown>): void {
    const runId = asString(payload.runId); if (!runId) return;
    // Full message snapshots can establish a new baseline after recovery fails.
    // A bare incremental delta needs a known buffer or another history attempt.
    if (this.recoveryFailed && payload.state === "delta" && !isRecord(payload.message) &&
      payload.replace !== true && !this.journal(key).runs.has(runId)) return;
    const run = this.run(key, runId);
    const seq = asNumber(payload.seq);
    if (seq !== undefined && seq <= run.chatSeq) return;
    if (seq !== undefined) run.chatSeq = seq;
    if (run.finished) return;
    const state = asString(payload.state);
    let aliases = messageAliases(payload.message, payload);
    if (isRecord(payload.message)) {
      let message = payload.message;
      if (state === "final" || state === "error" || state === "aborted") {
        const projected = this.terminalOccurrence(run, message, aliases);
        message = projected.message; aliases = projected.aliases;
      }
      // Terminal snapshots can follow an already committed occurrence. Match its
      // exact receipt, rather than reopening the retired buffer under a new ID.
      const committed = [...this.journal(key).known.values()].find((row) => row.item.type === "assistant_message" &&
        aliases.some((alias) => (alias.startsWith("input:") || alias.startsWith("message:")) && row.aliases.includes(alias)));
      const canonicalId = committed?.aliases.find((alias) => alias.startsWith("message:"))?.slice(8);
      if (canonicalId) this.committed(key, { ...payload, message, messageId: canonicalId });
      else this.assistant(key, runId, messageText(message), aliases);
    } else if (typeof payload.deltaText === "string") {
      this.assistant(key, runId, payload.replace === true ? payload.deltaText : run.text + payload.deltaText, aliases);
    }
    if (state === "final" || state === "error" || state === "aborted") {
      run.finished = true;
      if (state === "error" || (state === "aborted" && typeof payload.errorMessage === "string")) {
        const message = asString(payload.errorMessage) ?? "OpenClaw run failed.";
        this.put(key, { key: `run:${runId}:error`, item: { type: "error", message }, timestamp: new Date().toISOString(), aliases: [] }, { type: "error", message }, runId);
      }
      this.emit(key, { type: state === "final" ? "turn_completed" : state === "aborted" ? "turn_canceled" : "turn_failed" });
      const active = [...this.journal(key).runs.values()].some((entry) => !entry.finished);
      this.sessions.updateStatus(key, active ? "running" : state === "error" ? "error" : "idle"); this.publishAgent(key);
    }
  }

  private agent(key: string, payload: Record<string, unknown>, live = true): void {
    const runId = asString(payload.runId); if (!runId) return;
    const data = asRecord(payload.data);
    // chat owns assistant text; tool/reasoning streams add distinct timeline items.
    if (payload.stream === "assistant") return;
    const run = this.run(key, runId, live);
    const seq = asNumber(payload.seq);
    if (seq !== undefined && seq <= run.agentSeq) return;
    if (seq !== undefined) run.agentSeq = seq;
    if (run.finished && payload.stream !== "tool") return;
    if (payload.stream === "tool" || payload.stream === "activity") {
      if (run.text) run.segmentClosed = true;
      const callId = asString(data.toolCallId) ?? asString(data.callId) ?? asString(data.itemId);
      const phase = asString(data.phase);
      const status = data.isError === true || data.status === "failed" ? "failed" : data.status === "canceled" ? "canceled" : phase === "result" || phase === "end" || data.status === "completed" ? "completed" : "running";
      const item: BackendTimelineItem = { type: "tool_call", callId, name: asString(data.name) ?? asString(data.title) ?? "tool", status };
      this.put(key, { key: `tool:${callId ?? `${runId}:${seq ?? uniqueId()}`}`, item, timestamp: isoTime(payload.ts, Date.now()), aliases: callId ? [`tool:${callId}`] : [] }, live ? item : undefined, runId);
    } else if (payload.stream === "reasoning" || payload.stream === "thinking") {
      if (run.text) run.segmentClosed = true;
      const cumulative = asString(data.text) ?? asString(data.thinking);
      const delta = asString(data.delta);
      const next = cumulative ?? run.reasoning + (delta ?? "");
      const suffix = next.startsWith(run.reasoning) ? next.slice(run.reasoning.length) : next;
      run.reasoning = next;
      if (suffix) this.put(key, { key: `run:${runId}:reasoning`, item: { type: "reasoning", text: next }, timestamp: isoTime(payload.ts, Date.now()), aliases: [] }, live ? { type: "reasoning", text: suffix } : undefined, runId);
    } else if (payload.stream === "lifecycle") {
      const phase = asString(data.phase);
      if (phase === "error" && typeof data.error === "string") {
        const item: BackendTimelineItem = { type: "error", message: data.error };
        this.put(key, { key: `run:${runId}:lifecycle-error`, item, timestamp: isoTime(payload.ts, Date.now()), aliases: [] }, live ? item : undefined, runId);
      }
      // The chat terminal owns completion. Lifecycle end can precede final text.
    }
  }

  private terminalOccurrence(run: Run, message: Record<string, unknown>, aliases: string[]): { message: Record<string, unknown>; aliases: string[] } {
    const original = messageText(message);
    let text = original;
    // The terminal may aggregate committed commentary and the last answer.
    // Retire only exact occurrence prefixes with the gateway's turn separator.
    for (const retired of run.retired) {
      if (retired.item.type !== "assistant_message" || !retired.item.text) continue;
      const prefix = `${retired.item.text}\n\n`;
      if (!text.startsWith(prefix)) break;
      text = text.slice(prefix.length);
    }
    const last = run.retired[run.retired.length - 1];
    if (!run.text && last?.item.type === "assistant_message" && text === last.item.text) {
      // A fully committed aggregate has no active suffix. Point its remaining
      // text at the last canonical occurrence, without reusing earlier receipts.
      aliases = [...new Set([...aliases, ...last.aliases])];
    }
    return { message: text === original ? message : { ...message, content: [{ type: "text", text }] }, aliases };
  }

  private closeAssistantOccurrence(key: string, record: OpenClawHistoryItem & { runId?: string }): void {
    if (record.item.type !== "assistant_message") return;
    const runId = record.runId ?? record.aliases.find((alias) => alias.startsWith("run:"))?.slice(4);
    if (!runId) return;
    const run = this.journal(key).runs.get(runId);
    if (!run || run.finished || record.item.messageId !== `openclaw-run:${runId}:${run.segment}`) return;
    // Persisted tool-use narration retires the gateway's current text buffer.
    // The next producer item starts fresh, even when its text begins with A.
    if (!run.retired.some((row) => row.key === record.key)) run.retired.push({ ...record, aliases: [...record.aliases] });
    run.text = ""; run.segmentOffset = 0; run.segmentClosed = true;
    run.aliases = [`run:${runId}`];
  }

  private matchHistoryRecord(journal: Journal, row: OpenClawHistoryItem): RecordItem | undefined {
    const exact = journal.records.get(row.key);
    if (exact) return exact;
    const known = journal.known.get(row.key);
    return [...journal.records.values()].find((entry) => {
      if (!sameHistoryItem(entry, row)) return false;
      if (known?.item.type !== "assistant_message") return true;
      if (entry.item.type !== "assistant_message") return false;
      // A reconciled canonical occurrence must not consume a later live segment
      // merely because both have the same run and text. Require its exposed ID
      // or an exact occurrence receipt before considering that segment again.
      return (entry.item.messageId !== undefined && entry.item.messageId === known.item.messageId) ||
        entry.aliases.some((alias) => (alias.startsWith("message:") || alias.startsWith("input:")) && row.aliases.includes(alias));
    });
  }

  private committed(key: string, payload: Record<string, unknown>): void {
    if (!isRecord(payload.message)) return;
    const journal = this.journal(key);
    const fallback = `committed:${messageId(payload.message, payload) ?? uniqueId()}`;
    const projected = projectMessage(payload.message, fallback, payload);
    for (const row of projected) {
      const inputAlias = row.aliases.find((alias) => alias.startsWith("input:") && journal.inputs.has(alias.slice(6)));
      if (row.item.type === "user_message" && inputAlias) {
        const id = inputAlias.slice(6); row.item.messageId = id; journal.inputs.get(id)!.echoed = true;
      }
      const existing = this.matchHistoryRecord(journal, row);
      const known = journal.known.get(row.key);
      if (!existing && known) {
        if (known.item.type === "assistant_message" && row.item.type === "assistant_message") row.item = { ...row.item, messageId: known.item.messageId };
        this.closeAssistantOccurrence(key, known);
        journal.known.set(row.key, row);
        if (JSON.stringify(known.item) === JSON.stringify(row.item)) continue;
        const item: BackendTimelineItem & { replace?: boolean } = row.item.type === "assistant_message" ? { ...row.item, replace: true } : row.item;
        this.put(key, row, item); continue;
      }
      if (existing) {
        journal.records.delete(existing.key);
        if (existing.item.type === "assistant_message" && row.item.type === "assistant_message") {
          row.item = { ...row.item, messageId: existing.item.messageId };
          this.closeAssistantOccurrence(key, { ...row, runId: existing.runId });
        }
        // A persisted final text may extend the last streamed snapshot.
        if (existing.item.type === "assistant_message" && row.item.type === "assistant_message") {
          const text = row.item.text;
          const old = existing.item.text;
          if (text !== old) {
            const item: BackendTimelineItem & { replace?: boolean } = { ...row.item, messageId: existing.item.messageId, text: text.startsWith(old) ? text.slice(old.length) : text, ...(!text.startsWith(old) ? { replace: true } : {}) };
            this.put(key, row, item, existing.runId); journal.known.set(row.key, row); continue;
          }
        }
        if (existing.item.type === "tool_call" && row.item.type === "tool_call" && existing.item.status !== row.item.status) {
          this.put(key, row, row.item, existing.runId);
        } else journal.records.set(row.key, { ...row, seqStart: existing.seqStart, seqEnd: existing.seqEnd, runId: existing.runId });
      } else this.put(key, row, row.item);
      journal.known.set(row.key, row);
    }
  }

  private approval(payload: Record<string, unknown>): void {
    const id = asString(payload.id);
    const requestData = asRecord(payload.request);
    const key = asString(requestData.sessionKey) ?? asString(payload.sessionKey);
    if (!id || !key || this.approvals.has(id)) return;
    const request: BackendPermissionRequest = { id, actions: [{ id: "allow-once", behavior: "allow" }, { id: "deny", behavior: "deny" }] };
    this.approvals.set(id, { key, request });
    this.emit(key, { type: "permission_requested", request }); notify(this.permissionListeners, { agentId: key, request });
  }

  async respondToPermission(key: string, id: string, selectedActionId?: string): Promise<void> {
    const approval = this.approvals.get(id);
    if (!approval || approval.key !== key) throw new Error("This OpenClaw approval is no longer pending for this conversation.");
    const decision = selectedActionId ?? "allow-once";
    if (decision !== "allow-once") throw new Error("OpenClaw Writer approvals allow this request once; persistent grants are not enabled.");
    await this.transport.request("exec.approval.resolve", { id, decision });
    if (this.approvals.delete(id)) this.emit(key, { type: "permission_resolved" });
  }

  async fetchTimeline(key: string, options?: FetchAgentTimelineOptions): Promise<BackendAgentTimeline> {
    await this.whenReady(); await this.track(key); return this.loadTimeline(key, options);
  }

  private async loadTimeline(key: string, options?: FetchAgentTimelineOptions): Promise<BackendAgentTimeline> {
    const scope = await this.sessions.ensureScope(key);
    const journal = this.journal(key);
    this.incarnation(key, { sessionId: scope.sessionId, lifecycleRevision: scope.lifecycleRevision });
    const revision = journal.revision;
    const generation = this.generation;
    const startingSeq = journal.seq;
    const limit = Math.max(1, Math.min(1000, options?.limit ?? 1000));
    const inputRunIds = [...journal.inputs].map(([id, input]) => input.runId ?? id).slice(-50);
    const response = asRecord(await this.transport.request("chat.history", { sessionKey: key, agentId: scope.agentId, limit, ...(inputRunIds.length ? { inputRunIds } : {}) }));
    if (!Array.isArray(response.messages)) throw new OpenClawRpcError("PROTOCOL_ERROR", "chat.history did not return transcript messages.");
    let history = projectHistory(response.messages);
    let page = response;
    let offset = 0;
    // Tail pages can be byte-limited before reaching the requested projection
    // size. nextOffset counts source rows, so it must not be guessed from text.
    while (page.hasMore === true && history.length < limit) {
      const next = asNumber(page.nextOffset);
      if (next === undefined || !Number.isSafeInteger(next) || next <= offset) throw new OpenClawRpcError("PROTOCOL_ERROR", "OpenClaw history pagination did not advance.");
      offset = next;
      page = asRecord(await this.transport.request("chat.history", { sessionKey: key, agentId: scope.agentId, limit, offset }));
      if (!Array.isArray(page.messages)) throw new OpenClawRpcError("PROTOCOL_ERROR", "chat.history did not return a transcript page.");
      history = [...projectHistory(page.messages), ...history];
    }
    if (this.closed || generation !== this.generation) throw new OpenClawRpcError("NOT_CONNECTED", "OpenClaw history was interrupted by a connection change; reconnect and refresh.");
    if (revision !== journal.revision) throw new OpenClawRpcError("HISTORY_INVALIDATED", "OpenClaw reset or rewound this conversation while history was loading; refresh its timeline.");
    const historyKeys = new Set<string>();
    history = history.filter((row) => { if (historyKeys.has(row.key)) return false; historyKeys.add(row.key); return true; });
    const receipts = Array.isArray(response.inputReceipts) ? response.inputReceipts : Array.isArray(response.inputConsumptions) ? response.inputConsumptions : [];
    for (const receipt of receipts.filter(isRecord)) {
      const runId = asString(receipt.runId); const canonicalId = asString(receipt.consumedByEventId);
      const input = [...journal.inputs.entries()].find(([id, entry]) => entry.runId === runId || id === runId);
      if (!input || !canonicalId) continue;
      for (const row of history) if (row.aliases.includes(`message:${canonicalId}`)) {
        row.aliases.push(`input:${input[0]}`);
        if (row.item.type === "user_message") row.item.messageId = input[0];
      }
    }
    const liveStatus = this.sessions.getAgent(key)?.status;
    if (isRecord(response.sessionInfo)) {
      const metadata = {
        ...response.sessionInfo,
        ...(asString(response.sessionId) ? { sessionId: asString(response.sessionInfo.sessionId) ?? response.sessionId } : {}),
      };
      this.sessions.upsert(metadata, key);
      this.incarnation(key, metadata);
    } else if (asString(response.sessionId)) {
      this.sessions.upsert({ sessionId: response.sessionId }, key);
      this.incarnation(key, response);
    }
    // Response metadata can reveal a reset that had no live notification. Never
    // insert this response's transcript or in-flight buffer into the new epoch.
    if (revision !== journal.revision) throw new OpenClawRpcError("HISTORY_INVALIDATED", "OpenClaw history metadata changed this conversation's incarnation; refresh its timeline.");
    if (journal.seq !== startingSeq && liveStatus) this.sessions.updateStatus(key, liveStatus);
    const flight = asRecord(response.inFlightRun);
    const runId = asString(flight.runId);
    if (runId) {
      const run = this.run(key, runId, false);
      run.sessionAbortable = flight.sessionAbortable === true;
      let replayText: string | undefined;
      if (Array.isArray(flight.events)) for (const event of flight.events.filter(isRecord)) {
        if (event.stream === "assistant") {
          const data = asRecord(event.data);
          replayText = asString(data.text) ?? (data.replace === true ? "" : replayText ?? "") + (asString(data.delta) ?? "");
        } else this.agent(key, event, false);
      }
      const text = asString(flight.text) ?? replayText;
      if (text !== undefined && (!run.text || text.startsWith(run.text) || (journal.seq === startingSeq && !run.text.startsWith(text)))) this.assistant(key, runId, text, run.aliases, false);
    }
    const rows: RecordItem[] = history.map((row) => {
      const match = this.matchHistoryRecord(journal, row);
      if (match) journal.records.delete(match.key);
      // Preserve newer updates in this snapshot's watermark, including tools.
      const preserveLive = match && (match.seqEnd > startingSeq ||
        (match.item.type === "assistant_message" && row.item.type === "assistant_message" && match.item.text.startsWith(row.item.text)) ||
        (match.item.type === "tool_call" && row.item.type === "tool_call" && match.item.status !== "running" && row.item.status === "running"));
      let item = preserveLive ? match.item : row.item;
      const exposed = match ?? journal.known.get(row.key);
      if (exposed?.item.type === "assistant_message" && item.type === "assistant_message") item = { ...item, messageId: exposed.item.messageId };
      const reconciled = { ...row, item, aliases: [...new Set([...row.aliases, ...(match?.aliases ?? [])])] };
      journal.known.set(row.key, reconciled);
      if (match && preserveLive) journal.records.set(row.key, { ...reconciled, seqStart: match.seqStart, seqEnd: match.seqEnd, runId: match.runId });
      return { ...reconciled, seqStart: match?.seqStart ?? 0, seqEnd: match?.seqEnd ?? 0 };
    });
    for (const [id, row] of journal.records) {
      if (row.seqEnd <= startingSeq && row.aliases.some((alias) => alias.startsWith("message:"))) {
        // Durable rows outside this tail window must not leak back into it from
        // a previous subscription. Provisional rows remain until a receipt lands.
        journal.known.set(row.key, row); journal.records.delete(id);
      }
    }
    while (journal.known.size > 4000) journal.known.delete(journal.known.keys().next().value!);
    const included = new Set(rows.map((row) => row.key));
    rows.push(...[...journal.records.values()].filter((row) => !included.has(row.key)));
    // Tool starts/results share one visible row, preserving the terminal result.
    const tools = new Map<string, number>();
    const merged: RecordItem[] = [];
    for (const row of rows) {
      if (row.item.type === "tool_call" && row.item.callId) {
        const index = tools.get(row.item.callId);
        if (index !== undefined) { const previous = merged[index]!; if (row.item.status !== "running" || previous.item.type !== "tool_call" || previous.item.status === "running") merged[index] = row; continue; }
        tools.set(row.item.callId, merged.length);
      }
      merged.push(row);
    }
    const entries: BackendTimelineEntry[] = merged.slice(-limit).map((row) => ({ item: row.item, timestamp: row.timestamp, seqStart: row.seqStart, seqEnd: row.seqEnd, sourceSeqRanges: row.seqEnd ? [{ startSeq: row.seqStart, endSeq: row.seqEnd }] : [] }));
    // This synchronous boundary covers every emitted event through seq, including
    // uncommitted user, assistant and tool buffers received during the RPC.
    const maxSeq = journal.seq;
    return { agentId: key, agent: this.sessions.getAgent(key) ?? null, epoch: journal.epoch, window: { minSeq: 0, maxSeq, nextSeq: maxSeq + 1 }, entries };
  }

  async cancel(key: string): Promise<void> {
    const scope = await this.sessions.ensureScope(key);
    const native = [...this.journal(key).runs.values()].some((run) => !run.finished && run.sessionAbortable);
    if (native && this.transport.hasMethod("sessions.abort")) await this.transport.request("sessions.abort", { key, agentId: scope.agentId });
    else await this.transport.request("chat.abort", { sessionKey: key, agentId: scope.agentId });
  }

  close(): void {
    this.closed = true; this.generation++; this.stopEvents(); this.stopStatus();
    this.streamListeners.clear(); this.updateListeners.clear(); this.permissionListeners.clear();
    this.tracked.clear(); this.subscribed.clear(); this.subscribing.clear(); this.recovering.clear(); this.approvals.clear(); this.journals.clear();
  }
}
