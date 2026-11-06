import type { AgentModelDefinition, BackendProvidersSnapshot } from "../types";
import type { OpenClawTransport } from "./transport";
import { asRecord, asString, isRecord, OpenClawRpcError } from "./wire";

export interface OpenClawProfile {
  id: string;
  name: string;
  workspace?: string;
  model: string | null;
  degraded: boolean;
}

export function qualifiedModel(model: unknown, provider?: unknown): string | null {
  const id = asString(model);
  const owner = asString(provider);
  if (!id) return null;
  return owner && !id.startsWith(`${owner}/`) ? `${owner}/${id}` : id;
}

export function profileProvider(agentId: string): string { return `openclaw:${agentId}`; }

export function profileId(provider: string): string {
  if (!provider.startsWith("openclaw:") || provider.length === 9) {
    throw new Error("Select a configured OpenClaw agent profile before creating a conversation.");
  }
  return provider.slice(9);
}

/** Configured execution profiles, never one config agent per conversation. */
export class OpenClawModels {
  private profiles: OpenClawProfile[] = [];
  constructor(private readonly transport: OpenClawTransport) {}

  getProfiles(): readonly OpenClawProfile[] { return this.profiles; }

  async fetchProfiles(): Promise<readonly OpenClawProfile[]> {
    const result = asRecord(await this.transport.request("agents.list", {}));
    if (!Array.isArray(result.agents)) throw new OpenClawRpcError("PROTOCOL_ERROR", "agents.list did not return an agent roster.");
    this.profiles = result.agents.filter(isRecord).flatMap((row) => {
      const id = asString(row.id);
      if (!id) return [];
      return [{ id, name: asString(row.name) ?? asString(asRecord(row.identity).name) ?? id,
        workspace: asString(row.workspace), model: qualifiedModel(asRecord(row.model).primary),
        degraded: row.status === "degraded" }];
    });
    return this.profiles;
  }

  async snapshot(scope?: { agentId: string; sessionKey?: string }): Promise<BackendProvidersSnapshot> {
    const roster = await this.fetchProfiles();
    // cwd resolves to an execution profile. Empty projects must choose that
    // owner rather than the last profile used elsewhere on the gateway.
    const profiles = scope ? roster.filter((profile) => profile.id === scope.agentId) : roster;
    if (scope && !profiles.length) throw new Error(`OpenClaw profile ${scope.agentId} is no longer configured.`);
    const entries = await Promise.all(profiles.map(async (profile) => {
      const provider = profileProvider(profile.id);
      try {
        // Agent-scoped model discovery is supported by v2026.9.2 as well as
        // newer gateways; sessionKey is a newer, incompatible optional field.
        const result = asRecord(await this.transport.request("models.list", {
          agentId: profile.id,
        }));
        if (!Array.isArray(result.models)) throw new OpenClawRpcError("PROTOCOL_ERROR", "models.list did not return a model catalog.");
        const seen = new Set<string>();
        const models: AgentModelDefinition[] = result.models.filter(isRecord).flatMap((row) => {
          if (row.available === false || row.manualSelectionAllowed === false) return [];
          const id = qualifiedModel(row.id, row.provider);
          if (!id || seen.has(id)) return [];
          seen.add(id);
          return [{ id, label: asString(row.name) ?? id, provider, isDefault: id === profile.model }];
        });
        const loading = Array.isArray(result.pendingProviders) && result.pendingProviders.length > 0;
        return { provider, label: profile.name, status: profile.degraded ? "unavailable" as const : loading ? "loading" as const : "ready" as const,
          enabled: !profile.degraded, models };
      } catch (error) {
        return { provider, label: profile.name, status: "error" as const, enabled: false, models: [],
          error: error instanceof Error ? error.message : "OpenClaw model discovery failed." };
      }
    }));
    return { entries };
  }
}
