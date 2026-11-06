import { readFile } from "node:fs/promises";

const [agentPanel, modelSwitcher, settingsPane] = await Promise.all([
  readFile(new URL("../src/agent/AgentChatPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/agent/ModelSwitcher.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/settings/SettingsPane.tsx", import.meta.url), "utf8"),
]);

const requirements = [
  [
    "desktop agent sidebar keeps the model switcher in its header",
    /styles\.header[\s\S]*<ModelSwitcher\s*\/>/,
    agentPanel,
  ],
  [
    "mobile session picker contains the model switcher",
    /style=\{styles\.switcherPanel\}[\s\S]*style=\{styles\.switcherModelRow\}[\s\S]*<ModelSwitcher\s*\/>/,
    agentPanel,
  ],
  [
    "mobile agent drawer has no permanent model bar",
    /^(?![\s\S]*mobileModelBar)[\s\S]*$/,
    agentPanel,
  ],
  [
    "settings no longer duplicates the model switcher",
    /^(?![\s\S]*ModelSwitcher)[\s\S]*$/,
    settingsPane,
  ],
  [
    "existing sessions cannot switch provider",
    /^(?![\s\S]*switchProvider)[\s\S]*allowProviderChange=\{false\}/,
    modelSwitcher,
  ],
  [
    "existing-session model selection waits for explicit confirmation",
    /<ProviderModelPickerModal[\s\S]*onConfirm=\{applySelection\}/,
    modelSwitcher,
  ],
  [
    "mobile session picker contains the new-session action",
    /style=\{styles\.switcherPanel\}[\s\S]*accessibilityLabel="New session"[\s\S]*setNewSessionPickerOpen\(true\)[\s\S]*style=\{styles\.switcherModelRow\}/,
    agentPanel,
  ],
  [
    "mobile agent header has no close action",
    /^(?![\s\S]*accessibilityLabel="Close")[\s\S]*$/,
    agentPanel,
  ],
  [
    "new-session picker allows provider selection",
    /<ProviderModelPickerModal[\s\S]*allowProviderChange[\s\S]*onConfirm=\{startNewSession\}/,
    agentPanel,
  ],
  [
    "new sessions use the explicitly confirmed provider and model",
    /createAgent\(selection\.provider, cwd, "", \{[\s\S]*model: selection\.model \?\? undefined/,
    agentPanel,
  ],
];

const failures = requirements
  .filter(([, pattern, source]) => !pattern.test(source))
  .map(([description]) => description);

if (failures.length) {
  console.error(`Agent sidebar model contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Agent sidebar model contract passed.");
