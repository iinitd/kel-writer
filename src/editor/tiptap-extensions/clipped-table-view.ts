import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView, NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { TableView } from "@tiptap/extension-table";

// TipTap's TableView makes its own `.tableWrapper` and writes runtime width /
// min-width styles onto the inner <table>. That local scroller is fine, but in
// our layout the wrapper can still participate in ancestor width calculation
// and reintroduce a page-level horizontal scrollbar. Wrap the library node view
// in one extra clipping shell so only the inner `.tableWrapper` can scroll.
export class ClippedTableView implements NodeView {
  node: ProseMirrorNode;
  cellMinWidth: number;
  dom: HTMLDivElement;
  contentDOM: HTMLElement | null;
  private inner: TableView;

  constructor(
    node: ProseMirrorNode,
    cellMinWidth: number,
    view?: EditorView,
    HTMLAttributes: Record<string, any> = {},
  ) {
    this.node = node;
    this.cellMinWidth = cellMinWidth;
    this.dom = document.createElement("div");
    this.dom.className = "kel-table-clip";
    this.inner = new TableView(node, cellMinWidth, view, HTMLAttributes);
    this.dom.appendChild(this.inner.dom);
    this.contentDOM = this.inner.contentDOM;
  }

  update(node: ProseMirrorNode) {
    this.node = node;
    return this.inner.update(node);
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    if (mutation.target === this.dom) return true;
    return this.inner.ignoreMutation(mutation);
  }
}
