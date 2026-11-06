/** Browser/native-safe OpenClaw protocol envelopes. RPC payloads stay untrusted. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export type GatewayEvent = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: unknown;
};

export type GatewayRequest = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

export type GatewayResponse = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown; retryAfterMs?: number; retryable?: boolean };
};

export type GatewayFrame = GatewayEvent | GatewayRequest | GatewayResponse;

export type GatewayFeatures = {
  methods: string[];
  events: string[];
  capabilities?: string[];
};

/** Contains negotiated metadata, with issued bearer tokens removed. */
export type GatewayHello = Record<string, unknown> & {
  type: "hello-ok";
  protocol: number;
  server: { version: string; connId?: string };
  features: GatewayFeatures;
  auth: { role: string; scopes: string[] };
  policy: { tickIntervalMs: number; maxPayload?: number; maxBufferedBytes?: number };
};

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseGatewayFrame(raw: string): GatewayFrame {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new OpenClawRpcError("PROTOCOL_ERROR", "OpenClaw sent invalid JSON.");
  }
  if (!isRecord(value)) throw new OpenClawRpcError("PROTOCOL_ERROR", "OpenClaw sent an invalid frame.");
  if (value.type === "event" && nonEmpty(value.event)) {
    if (value.seq !== undefined && !nonnegativeInteger(value.seq)) {
      throw new OpenClawRpcError("PROTOCOL_ERROR", "OpenClaw sent an invalid event sequence.");
    }
    return {
      type: "event", event: value.event, payload: value.payload,
      ...(value.seq !== undefined ? { seq: value.seq as number } : {}),
      ...(value.stateVersion !== undefined ? { stateVersion: value.stateVersion } : {}),
    };
  }
  if (value.type === "req" && nonEmpty(value.id) && nonEmpty(value.method)) {
    return { type: "req", id: value.id, method: value.method, params: value.params };
  }
  if (value.type === "res" && nonEmpty(value.id) && typeof value.ok === "boolean") {
    if (value.ok) return { type: "res", id: value.id, ok: true, payload: value.payload };
    const error = asRecord(value.error);
    if (!nonEmpty(error.code) || !nonEmpty(error.message)) {
      throw new OpenClawRpcError("PROTOCOL_ERROR", "OpenClaw sent an invalid error response.");
    }
    const retryAfterMs = asNumber(error.retryAfterMs);
    return {
      type: "res", id: value.id, ok: false,
      error: {
        code: error.code, message: error.message, details: error.details,
        ...(retryAfterMs !== undefined && retryAfterMs >= 0 ? { retryAfterMs } : {}),
        ...(typeof error.retryable === "boolean" ? { retryable: error.retryable } : {}),
      },
    };
  }
  throw new OpenClawRpcError("PROTOCOL_ERROR", "OpenClaw sent an unsupported frame.");
}

export function readGatewayChallenge(payload: unknown): { nonce: string; ts: number } {
  if (!isRecord(payload) || !nonEmpty(payload.nonce) || !nonnegativeInteger(payload.ts)) {
    throw new OpenClawRpcError("INVALID_CHALLENGE", "OpenClaw connect challenge requires a nonce and a nonnegative integer server timestamp.");
  }
  return { nonce: payload.nonce.trim(), ts: payload.ts };
}

/** Validate the handshake fields used for policy; preserve additive server metadata. */
export function readGatewayHello(payload: unknown): GatewayHello {
  const value = asRecord(payload);
  const server = asRecord(value.server);
  const features = asRecord(value.features);
  const policy = asRecord(value.policy);
  const auth = asRecord(value.auth);
  const stringList = (entries: unknown): entries is string[] =>
    Array.isArray(entries) && entries.every(nonEmpty);
  if (value.type !== "hello-ok" || !nonnegativeInteger(value.protocol) ||
      value.protocol < 3 || value.protocol > 4) {
    throw new OpenClawRpcError("PROTOCOL_MISMATCH", "OpenClaw must negotiate protocol version 3 or 4.");
  }
  if (!nonEmpty(server.version) || !stringList(features.methods) || !stringList(features.events) ||
      !nonnegativeInteger(policy.tickIntervalMs) || policy.tickIntervalMs < 1 ||
      !nonEmpty(auth.role) || !stringList(auth.scopes) ||
      (features.capabilities !== undefined && !stringList(features.capabilities))) {
    throw new OpenClawRpcError("PROTOCOL_ERROR", "OpenClaw sent an invalid hello response.");
  }
  // Never expose an issued credential via metadata accessors.
  const { deviceToken: _token, deviceTokens: _tokens, ...safeAuth } = auth;
  return {
    ...value, type: "hello-ok", protocol: value.protocol,
    server: { ...server, version: server.version },
    features: { methods: [...features.methods], events: [...features.events],
      ...(features.capabilities ? { capabilities: [...features.capabilities] } : {}) },
    auth: { ...safeAuth, role: auth.role, scopes: [...auth.scopes] },
    policy: { ...policy, tickIntervalMs: policy.tickIntervalMs },
  };
}

export class OpenClawRpcError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly retryAfterMs?: number;
  readonly retryable?: boolean;

  constructor(code: string, message: string, details?: unknown, retryAfterMs?: number, retryable?: boolean) {
    super(message);
    this.name = "OpenClawRpcError";
    this.code = code;
    this.details = details;
    this.retryAfterMs = retryAfterMs;
    this.retryable = retryable;
  }
}

export function gatewayResponseError(response: GatewayResponse, method: string): OpenClawRpcError {
  const error = response.error;
  const code = error?.code ?? "RPC_ERROR";
  const details = error?.details;
  const detailCode = asString(asRecord(details).code) ?? code;
  let message = error?.message ?? `OpenClaw request ${method} failed.`;
  if (detailCode === "PAIRING_REQUIRED" || /pairing required/i.test(message)) {
    const requestId = asString(asRecord(details).requestId);
    const command = requestId && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)
      ? ` Run openclaw devices approve ${requestId} on the gateway host, then reconnect.`
      : " Run openclaw devices list on the gateway host and approve this device, then reconnect.";
    message = `OpenClaw device pairing requires operator approval.${command}`;
  } else if (/^(METHOD_NOT_FOUND|UNKNOWN_METHOD|NOT_IMPLEMENTED)$/.test(code) || /unknown method|method not found/i.test(message)) {
    message = `OpenClaw does not support ${method}. ${message}`;
  } else if (/DENIED|FORBIDDEN|SCOPE|UNAUTHORIZED/.test(detailCode) || /missing scope|permission denied|not authorized/i.test(message)) {
    message = `OpenClaw denied ${method}. Check this device's approved operator scopes. ${message}`;
  }
  return new OpenClawRpcError(code, message, details, error?.retryAfterMs, error?.retryable);
}
