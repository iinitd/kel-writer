declare module "*.css" {
  const content: string;
  export default content;
}

// Metro/webpack require.context for Expo Router
interface RequireContext {
  keys(): string[];
  (id: string): string;
  <T>(id: string): T;
  resolve(id: string): string;
  id: string;
}

interface NodeRequire {
  context(
    directory: string,
    useSubdirectories?: boolean,
    regExp?: RegExp,
    mode?: "sync" | "eager" | "lazy" | "lazy-once",
  ): RequireContext;
}
