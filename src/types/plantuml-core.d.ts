declare module "@plantuml/core" {
  export function renderToString(
    lines: string[],
    onSuccess: (svg: string) => void,
    onError: (error: unknown) => void,
    options?: {
      dark?: boolean;
      maxSvgSize?: number;
    },
  ): void;
}

declare module "@plantuml/core/viz-global.js";
