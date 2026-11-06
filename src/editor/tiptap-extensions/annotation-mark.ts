import { Mark } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    annotation: {
      setAnnotation: (attrs: { annotationId: string }) => ReturnType;
      unsetAnnotation: (attrs: { annotationId: string }) => ReturnType;
    };
  }
}

export const AnnotationMark = Mark.create({
  name: "annotation",

  inclusive: false,

  addAttributes() {
    return {
      annotationId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-annotation-id"),
        renderHTML: (attributes: Record<string, string>) => {
          if (!attributes.annotationId) return {};
          return { "data-annotation-id": attributes.annotationId };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark[data-annotation-id]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, string> }) {
    return ["mark", { ...HTMLAttributes, class: "annotation-highlight" }, 0];
  },

  addCommands() {
    return {
      setAnnotation:
        (attrs) =>
        ({ commands }) => {
          return commands.setMark(this.name, attrs);
        },
      unsetAnnotation:
        (attrs) =>
        ({ commands }) => {
          return commands.unsetMark(this.name, { extendEmptyMarkRange: true });
        },
    };
  },
});
