import { readFile } from "node:fs/promises";

const [openingStore, writerShell, connectScreen, sessionStore, backendCatalog] = await Promise.all([
  readFile(new URL("../src/stores/writer-opening-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/writer/session.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/index.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/stores/session-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/stores/backend-catalog-store.ts", import.meta.url), "utf8"),
]);

const requirements = [
  ["the shared opener exposes progress, error, target, open, and retry", /interface WriterOpeningStore\s*\{\s*opening:\s*boolean;\s*error:\s*string \| null;\s*target:\s*WriterOpenTarget \| null;\s*open:\s*\(target\?: WriterOpenTarget\) => Promise<boolean>;\s*retry:\s*\(\) => Promise<boolean>;/, openingStore],
  ["opening publishes its target before connection activation can reset the session", /set\(\{ opening: true, error: null, target \}\)[\s\S]*activateConnection\(target\.connectionId\)/, openingStore],
  ["identical pending targets reuse the same opening promise", /if \(pending\?\.key === key\) return pending\.promise;/, openingStore],
  ["different opening requests serialize connection activation", /const operation = queue\.then\(async \(\) =>[\s\S]*queue = operation;/, openingStore],
  ["default startup restores remembered metadata before catalog and provider discovery", /if \(!target\.cwd && cwd && await measureStartupTrace\([\s\S]*session\.restoreAgent\(workspaceKey\)[\s\S]*return finish\(\);[\s\S]*useBackendCatalogStore\.getState\(\)\.refresh[\s\S]*loadProviders\(/, openingStore],
  ["superseded openings cannot publish errors or clear newer progress", /generation !== requestGeneration[\s\S]*isSessionRestoreSuperseded\(error\)\) return false;[\s\S]*if \(generation === requestGeneration\) set\(\{ opening: false \}\)/, openingStore],
  ["opening checks the active connection and client before committing", /connection\.activeConnectionId !== target\.connectionId \|\| connection\.client !== activeClient[\s\S]*const finish = \(\) => \{\s*checkCurrent\(\);/, openingStore],
  ["restoring an agent returns after metadata and hydrates history in the background", /set\(installAgentSubscriptions[\s\S]*void hydrateAgentTimeline[\s\S]*return true;/, sessionStore],
  ["restore capture is installed before the timeline snapshot request starts", /installTimelineCapture[\s\S]*client\.fetchAgentTimeline/, sessionStore],
  ["session restore generations reject superseded async responses", /_restoreRequestGeneration[\s\S]*_restoreGeneration[\s\S]*_timelineGeneration[\s\S]*isCurrentHydration/, sessionStore],
  ["connect and auto-reconnect navigate directly into the writer shell", /await connect\(\);[\s\S]*router\.replace\("\/writer\/session"\)[\s\S]*restoreConnections\(\)[\s\S]*router\.replace\("\/writer\/session"\)/, connectScreen],
  ["writer startup waits for opening, connection switching, hydration, and a connected transport", /if \(isSwitchingConnection \|\| opening\) return;[\s\S]*!preferencesHydrated \|\| connectionStatus !== "connected"\) return;[\s\S]*useWriterOpeningStore\.getState\(\)\.open\(\)/, writerShell],
  ["a failed startup waits for explicit retry rather than auto-opening again", /if \(openingError && openingTarget\?\.connectionId === activeConnectionId\) return;\s*void useWriterOpeningStore\.getState\(\)\.open\(\)/, writerShell],
  ["a reconnected writer catches up events missed while the transport was offline", /previousConnectionStatus[\s\S]*catchUpAgent/, writerShell],
  ["shared catalog discovery deduplicates per-client requests", /currentRequest\?\.client === connection\.client[\s\S]*return currentRequest\.promise/, backendCatalog],
];

const failures = requirements
  .filter(([, pattern, source]) => !pattern.test(source))
  .map(([description]) => description);

if (failures.length) {
  console.error("Startup fast-path contract failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Startup fast-path contract passed.");
