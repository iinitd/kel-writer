import {
  escapeAttr,
  escapeHtml,
  extractPlantUmlPlaceholders,
  type PlantUmlPlaceholder,
} from "./plantuml-placeholder";

export type { PlantUmlPlaceholder };
export { extractPlantUmlPlaceholders };

// PlantUML rendering depends on @plantuml/core, whose Graphviz runtime needs
// WebAssembly. Hermes does not provide a WebAssembly implementation, so the
// renderer cannot run on iOS or Android. Importing it here also breaks Metro
// resolution because the Viz.js bundle requires the Node "url" module.
const UNSUPPORTED_MESSAGE =
  "PlantUML preview requires WebAssembly. Open this document in the web app to see the diagram.";

export async function renderPlantUmlToSvg(): Promise<string> {
  throw new Error(UNSUPPORTED_MESSAGE);
}

export async function renderPlantUmlPlaceholderHtml(
  placeholder: PlantUmlPlaceholder,
): Promise<string> {
  return `<div class="kel-plantuml kel-plantuml-error" data-kel-plantuml-id="${escapeAttr(placeholder.id)}">${escapeHtml(UNSUPPORTED_MESSAGE)}</div>`;
}
