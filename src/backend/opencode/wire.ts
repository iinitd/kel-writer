/** Small, dependency-free helpers for the OpenCode HTTP API. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export class OpenCodeRequestError extends Error {
  constructor(
    readonly code: "NOT_CONNECTED" | "HTTP_ERROR" | "PROTOCOL_ERROR" | "DISPOSED" | "TIMEOUT" | "UNSUPPORTED",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OpenCodeRequestError";
  }
}

export function isoTime(value: unknown, fallback = Date.now()): string {
  const ms = asNumber(value);
  return new Date(ms ?? fallback).toISOString();
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  const record = asRecord(error);
  return asString(record.message) ?? fallback;
}

/** Extract the server's structured error message from a decoded JSON body. */
export function bodyError(body: unknown, status: number): string {
  const record = asRecord(body);
  const message = asString(record.message)
    ?? asString(asRecord(record.error).message)
    ?? asString(record._tag);
  return message ?? `OpenCode request failed (HTTP ${status}).`;
}
