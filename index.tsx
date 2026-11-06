import { registerRootComponent } from "expo";
import { ExpoRoot } from "expo-router";

// Install a global `crypto` shim (randomUUID + getRandomValues) for platforms
// where it is missing (Expo Go / React Native) or incomplete (insecure-context
// web served over a plain-HTTP LAN address). Must run before any Paseo client
// code.
import "./src/polyfills/crypto";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ctx = require.context("./app");
function Root() {
  return <ExpoRoot context={ctx} />;
}
registerRootComponent(Root);
