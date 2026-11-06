interface VisibilityPollerOptions {
  runImmediately?: boolean;
  runOnVisible?: boolean;
}

function pageIsVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * Run a background refresh without stacking requests, and stop waking the app
 * while its browser tab is hidden. A recursive timeout is intentional: the
 * next interval starts after the previous request settles, so a slow daemon
 * can never build up an overlapping request queue.
 */
export function startVisibilityAwarePoller(
  task: () => void | Promise<void>,
  intervalMs: number,
  options: VisibilityPollerOptions = {},
): () => void {
  let stopped = false;
  let running = false;
  let runAgain = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (delay = intervalMs) => {
    clearTimer();
    if (stopped || !pageIsVisible()) return;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  };

  const run = async () => {
    if (stopped || !pageIsVisible()) return;
    if (running) {
      runAgain = true;
      return;
    }

    running = true;
    try {
      await task();
    } catch {
      // Polling is best-effort. Individual tasks may surface a useful error in
      // their own store/UI; an exception must not stop all future refreshes.
    } finally {
      running = false;
      if (stopped) return;
      if (runAgain) {
        runAgain = false;
        schedule(0);
      } else {
        schedule();
      }
    }
  };

  const onVisibilityChange = () => {
    if (!pageIsVisible()) {
      clearTimer();
      return;
    }
    if (options.runOnVisible === false) schedule();
    else if (running) runAgain = true;
    else schedule(0);
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  if (options.runImmediately) void run();
  else schedule();

  return () => {
    stopped = true;
    clearTimer();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}
