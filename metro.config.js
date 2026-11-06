const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Custom resolver to handle @getpaseo/* subpath exports that Metro can't resolve.
// The published packages use "exports" maps with subpath patterns like
// "@getpaseo/relay/e2ee" that Metro's default resolver doesn't support.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Map subpath imports to their dist/ files
  const subpathMappings = {
    "@getpaseo/relay/e2ee": "@getpaseo/relay/dist/e2ee.js",
    "@getpaseo/relay/cloudflare": "@getpaseo/relay/dist/cloudflare-adapter.js",
    "@getpaseo/client/internal/daemon-client": "@getpaseo/client/dist/daemon-client.js",
    "@getpaseo/client/internal/daemon-client-transport-types":
      "@getpaseo/client/dist/daemon-client-transport-types.js",
  };

  const mapped = subpathMappings[moduleName];
  if (mapped) {
    return context.resolveRequest(context, mapped, platform);
  }

  // Fall back to the default resolver
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
