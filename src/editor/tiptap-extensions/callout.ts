import { Node, mergeAttributes } from "@tiptap/core";

// A Lark callout rendered as a highlight block. StarterKit has no node for a
// generic `<div class="kel-callout">`, so TipTap would otherwise drop the
// wrapper and keep only its inner paragraphs — losing the tint, accent border,
// and leading emoji. This node parses that div (carrying its inline style and
// data-emoji through), lets block content live inside it, and renders the same
// wrapper back so the shared CSS (see editor-doc-css.ts) styles it identically
// to the native WebView path.
export const Callout = Node.create({
  name: "callout",
  group: "block",
  // Any block content (paragraphs, lists, headings, tables…) can nest inside.
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-emoji"),
        renderHTML: (attrs: { emoji?: string | null }) =>
          attrs.emoji ? { "data-emoji": attrs.emoji } : {},
      },
      // Preserve the document-declared tint/accent (as an inline style string)
      // so the callout keeps its own colors rather than a hardcoded default.
      style: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("style"),
        renderHTML: (attrs: { style?: string | null }) =>
          attrs.style ? { style: attrs.style } : {},
      },
      larkBlockId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-lark-block-id"),
        renderHTML: (attrs: { larkBlockId?: string | null }) =>
          attrs.larkBlockId ? { "data-lark-block-id": attrs.larkBlockId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "div.kel-callout" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "kel-callout" }),
      0,
    ];
  },
});
