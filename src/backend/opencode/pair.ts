import { asRecord, asString, bodyError, OpenCodeRequestError } from "./wire";

export interface OpenCodePairResult {
  /** Server origin without `/auth/connect/...`. */
  endpoint: string;
  /** Long-lived session token, used as the Basic-auth password. */
  password: string;
}

export interface OpenCodePairTarget {
  connectUrl: string;
  endpoint: string;
}

/** Validate a pair link before spending its single use. */
export function parseOpenCodePairLink(link: string): OpenCodePairTarget {
  const trimmed = link.trim();
  if (!trimmed) throw new Error("Paste an OpenCode pair link first.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Paste a valid OpenCode pair link, such as https://host/auth/connect/…");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OpenCode pair links must start with http:// or https://.");
  }
  if (!/^\/auth\/connect\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error("This is not an OpenCode pair link. It should contain /auth/connect/<code>.");
  }
  if (url.search || url.hash) {
    throw new Error("OpenCode pair links must not contain query parameters or fragments.");
  }
  return { connectUrl: url.toString(), endpoint: `${url.protocol}//${url.host}` };
}

/**
 * Redeem a one-time pair link for the session token that the server accepts as
 * the Basic-auth password. The link itself is never persisted.
 */
export async function redeemOpenCodePairLink(link: string, timeoutMs = 20_000): Promise<OpenCodePairResult> {
  const target = parseOpenCodePairLink(link);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(target.connectUrl, {
      headers: { Accept: "application/json" },
      ...(controller ? { signal: controller.signal } : {}),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (!response.ok) {
      if (response.status === 401) {
        throw new OpenCodeRequestError(
          "HTTP_ERROR",
          "This OpenCode pair link expired or was already used. Generate a new pair link and try again.",
          401,
        );
      }
      throw new OpenCodeRequestError("HTTP_ERROR", bodyError(body, response.status), response.status);
    }
    const token = asString(asRecord(body).token);
    if (!token) {
      throw new OpenCodeRequestError("PROTOCOL_ERROR", "OpenCode did not return a session token for this pair link.");
    }
    return { endpoint: target.endpoint, password: token };
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new OpenCodeRequestError("TIMEOUT", "OpenCode did not answer the pair link in time.");
    }
    if (error instanceof OpenCodeRequestError) throw error;
    const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
    throw new OpenCodeRequestError(
      "NOT_CONNECTED",
      `Could not reach ${target.endpoint} to redeem the pair link.${detail}`,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
