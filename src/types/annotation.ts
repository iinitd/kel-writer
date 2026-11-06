export interface Annotation {
  id: string;
  from: number;
  to: number;
  highlightedText: string;
  blockIds?: string[];
  comment: string;
  status: "pending" | "submitted" | "resolved";
}

// A pending text selection surfaced by the editor when the user highlights
// something. Drives the floating selection toolbar.
export interface ActiveSelection {
  from: number;
  to: number;
  text: string;
  blockIds?: string[];
}
