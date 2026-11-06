import { renderToString } from "@plantuml/core";
import {
  escapeAttr,
  escapeHtml,
  extractPlantUmlPlaceholders,
  type PlantUmlPlaceholder,
} from "./plantuml-placeholder";

export type { PlantUmlPlaceholder };
export { extractPlantUmlPlaceholders };

let plantUmlRuntimePromise: Promise<void> | null = null;

function normalizeSvg(svg: string): string {
  return svg
    .replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, "")
    .replace(/^\s*<!DOCTYPE[\s\S]*?>\s*/i, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .trim();
}

async function ensurePlantUmlRuntime(): Promise<void> {
  if (!plantUmlRuntimePromise) {
    plantUmlRuntimePromise = (async () => {
      await import("@plantuml/core/viz-global.js");
      const runtime = globalThis as typeof globalThis & {
        Viz?: unknown;
        PLANTUML_VIZ?: unknown;
      };
      if (!runtime.PLANTUML_VIZ && runtime.Viz) {
        runtime.PLANTUML_VIZ = runtime.Viz;
      }
    })();
  }
  return plantUmlRuntimePromise;
}

export async function renderPlantUmlToSvg(source: string): Promise<string> {
  if (/^\s*!include(?:once|many)?\b/im.test(source)) {
    throw new Error("PlantUML preview does not support !include in Markdown preview.");
  }

  await ensurePlantUmlRuntime();

  return new Promise((resolve, reject) => {
    let settled = false;
    renderToString(
      source.split(/\r?\n/),
      (svg: string) => {
        if (settled) return;
        settled = true;
        resolve(normalizeSvg(svg));
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      },
      { dark: false },
    );
  });
}

export async function renderPlantUmlPlaceholderHtml(
  placeholder: PlantUmlPlaceholder,
): Promise<string> {
  try {
    const svg = await renderPlantUmlToSvg(placeholder.source);
    return `<div class="kel-plantuml kel-plantuml-rendered" data-kel-plantuml-id="${escapeAttr(placeholder.id)}">${svg}</div>`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `<div class="kel-plantuml kel-plantuml-error" data-kel-plantuml-id="${escapeAttr(placeholder.id)}">${escapeHtml(message)}</div>`;
  }
}
