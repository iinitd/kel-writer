import { Image } from "@tiptap/extension-image";

// Image node that survives the badge wrapper on web. The stock TipTap Image
// keeps only src/alt/title/width/height and renders a bare <img>, so the
// `<span class="kel-media" data-format=…>` wrapper (and the corner badge it
// draws) that resolve-doc-images.ts emits would be stripped on the web editor.
// Here we (a) read data-kind/data-format off the parsed <img>, and (b) render
// the wrapper span back so the CSS badge shows. Native uses the raw HTML
// directly and needs no node — this is web-only.
export const BadgedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-kind"),
        renderHTML: (attrs: { kind?: string | null }) =>
          attrs.kind ? { "data-kind": attrs.kind } : {},
      },
      format: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-format"),
        renderHTML: (attrs: { format?: string | null }) =>
          attrs.format ? { "data-format": attrs.format } : {},
      },
      // The document-declared workspace path for this asset. The rendered src
      // is an opaque data: URI, so we keep the real path here so the image can
      // be picked as an AI-comment reference (see editor-web selection logic).
      kelSrc: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-kel-src"),
        renderHTML: (attrs: { kelSrc?: string | null }) =>
          attrs.kelSrc ? { "data-kel-src": attrs.kelSrc } : {},
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    // addAttributes serialises kind/format as data-kind/data-format, so read
    // those keys (not `kind`/`format`) and strip them off the <img>.
    const attrs = { ...(HTMLAttributes as Record<string, unknown>) };
    const kind = attrs["data-kind"];
    const format = attrs["data-format"];
    const kelSrc = attrs["data-kel-src"];
    delete attrs["data-kind"];
    delete attrs["data-format"];
    // No badge metadata → plain image (e.g. a pasted/authored img).
    if (!format) return ["img", attrs];
    const wrapper: Record<string, unknown> = { class: "kel-media", "data-format": format };
    if (kind) wrapper["data-kind"] = kind;
    if (kelSrc) wrapper["data-kel-src"] = kelSrc;
    return ["span", wrapper, ["img", attrs]];
  },
});
