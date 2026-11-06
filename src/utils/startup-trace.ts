type TraceState = {
  id: number;
  origin: string;
  startedAt: number;
};

let nextTraceId = 1;
let activeTrace: TraceState | null = null;

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function formatMs(value: number): string {
  return `${Math.round(value)}ms`;
}

function log(message: string, meta?: Record<string, unknown> | string | null) {
  if (meta == null) {
    console.info(message);
    return;
  }
  console.info(message, meta);
}

function ensureTrace(origin: string): TraceState {
  if (!activeTrace) {
    activeTrace = {
      id: nextTraceId++,
      origin,
      startedAt: nowMs(),
    };
    log(`[startup#${activeTrace.id}] begin`, { origin: activeTrace.origin });
  }
  return activeTrace;
}

export function beginStartupTrace(origin: string) {
  activeTrace = {
    id: nextTraceId++,
    origin,
    startedAt: nowMs(),
  };
  log(`[startup#${activeTrace.id}] begin`, { origin });
}

export function noteStartupTrace(label: string, meta?: Record<string, unknown> | string | null) {
  const trace = ensureTrace("implicit");
  const elapsed = nowMs() - trace.startedAt;
  log(`[startup#${trace.id} +${formatMs(elapsed)}] ${label}`, meta);
}

export async function measureStartupTrace<T>(
  label: string,
  work: () => Promise<T>,
  meta?: Record<string, unknown> | string | null,
): Promise<T> {
  const trace = ensureTrace("implicit");
  const startedAt = nowMs();
  log(`[startup#${trace.id}] ${label}:start`, meta);
  try {
    const result = await work();
    const elapsed = nowMs() - startedAt;
    log(`[startup#${trace.id}] ${label}:done (${formatMs(elapsed)})`);
    return result;
  } catch (error) {
    const elapsed = nowMs() - startedAt;
    log(`[startup#${trace.id}] ${label}:fail (${formatMs(elapsed)})`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
