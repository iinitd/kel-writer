export interface PlantUmlPlaceholder {
  id: string;
  source: string;
}

const PLACEHOLDER_RE = /<div class="kel-plantuml kel-media-loading" data-kel-plantuml-id="([^"]+)" data-kel-plantuml-source="([^"]+)" data-kel-plantuml-state="loading">[\s\S]*?<\/div>/gi;

export function extractPlantUmlPlaceholders(html: string): PlantUmlPlaceholder[] {
  const placeholders: PlantUmlPlaceholder[] = [];
  let match: RegExpExecArray | null;

  while ((match = PLACEHOLDER_RE.exec(html)) !== null) {
    placeholders.push({
      id: match[1] ?? "",
      source: decodeURIComponent(match[2] ?? ""),
    });
  }

  return placeholders;
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
