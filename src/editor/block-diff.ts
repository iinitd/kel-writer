// EXPERIMENTAL — paragraph-level "what did the AI change" highlighting.
//
// When the agent revises the open file, we diff the pre-revise document against
// the reloaded one at the *block* level (paragraphs, headings, list items,
// tables, …) and mark which blocks in the new document are new-or-changed. The
// editor then tints those blocks so the user can see, at a glance, where the
// revision landed — without any diff view, review bar, or per-change confirm.
//
// This whole file (plus the `.kel-changed` CSS and the store's changedBlockSigs
// field) is deliberately isolated so the feature can be removed cleanly if it
// doesn't prove useful.
//
// We identify blocks by a *signature* (leading tag + whitespace-stripped text)
// rather than by index. That's deliberate: the diff runs on the HTML produced
// by `marked`, but the highlight has to land on the editor's re-rendered DOM
// children — and those don't line up by index (TipTap wraps <li> content in
// <p>, may drop unsupported nodes, etc.). Matching by signature makes the tint
// survive that re-rendering: whatever the DOM child looks like, if its
// signature is in the changed set, it lights up.

const VOID_TAGS = new Set(["hr", "br", "img"]);

// Find the index just past the matching close tag for `tag`, starting at
// `from`, accounting for nested elements of the same tag.
function findMatchingClose(html: string, from: number, tag: string): number {
  const openRe = new RegExp(`<${tag}\\b`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
  let depth = 1;
  let pos = from;
  while (pos < html.length) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const o = openRe.exec(html);
    const c = closeRe.exec(html);
    if (!c) return -1;
    if (o && o.index < c.index) {
      depth++;
      pos = o.index + o[0].length;
    } else {
      depth--;
      pos = c.index + c[0].length;
      if (depth === 0) return pos;
    }
  }
  return -1;
}

// Split an HTML string into its top-level blocks (raw HTML per block). The
// ordering matches the rendered DOM's top-level children.
function splitTopLevelBlocks(html: string): string[] {
  const blocks: string[] = [];
  let i = 0;
  const len = html.length;
  while (i < len) {
    while (i < len && /\s/.test(html[i]!)) i++;
    if (i >= len) break;

    if (html[i] !== "<") {
      // Stray top-level text — capture up to the next tag.
      let j = html.indexOf("<", i);
      if (j === -1) j = len;
      const text = html.slice(i, j);
      if (text.trim()) blocks.push(text);
      i = j;
      continue;
    }

    const m = /^<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/.exec(html.slice(i));
    if (!m) {
      i++;
      continue;
    }
    const tag = m[1]!.toLowerCase();
    const openLen = m[0]!.length;
    const selfClose = m[2] === "/" || VOID_TAGS.has(tag);

    if (selfClose) {
      blocks.push(html.slice(i, i + openLen));
      i += openLen;
      continue;
    }

    const end = findMatchingClose(html, i + openLen, tag);
    if (end === -1) {
      blocks.push(html.slice(i));
      break;
    }
    blocks.push(html.slice(i, end));
    i = end;
  }
  return blocks;
}

/**
 * A comparable signature for a block: its leading tag name + its text with ALL
 * whitespace and markup removed. Two things matter here:
 *
 *  - Including the tag means a paragraph becoming a heading counts as a change.
 *  - Stripping *all* whitespace (not just collapsing it) is what lets a
 *    signature computed from `marked` output match one computed from the
 *    editor's DOM: marked writes `<li>a</li>\n<li>b</li>` (a newline between
 *    items) while ProseMirror serializes `<li><p>a</p></li><li><p>b</p></li>`
 *    (no gap). Collapsing to a single space would leave "a b" vs "ab"; removing
 *    whitespace entirely yields "ab" on both sides.
 *
 * Exported so the editors can compute the same signature from a rendered DOM
 * element's outerHTML and match it against the changed set.
 */
export function blockSignature(blockHtml: string): string {
  const tagMatch = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(blockHtml);
  const tag = tagMatch ? tagMatch[1]!.toLowerCase() : "text";
  const text = blockHtml
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, "")
    .toLowerCase();
  return `${tag}\u0000${text}`;
}

/**
 * Diff two rendered-HTML documents at the block level and return the signatures
 * (of the NEW document's top-level blocks) that are new or modified relative to
 * the old document. Unchanged blocks — matched by an LCS so pure insertions or
 * deletions don't shift everything after them — are omitted.
 *
 * Deletions produce no signature (there's no block to highlight), which is
 * fine: the feature only marks what's present-and-changed. The returned list is
 * de-duplicated; if the new document happens to contain two identical changed
 * blocks, both DOM matches will be tinted (acceptable for an experiment).
 */
export function diffChangedBlockSignatures(oldHtml: string, newHtml: string): string[] {
  const oldSigs = splitTopLevelBlocks(oldHtml).map(blockSignature);
  const newSigs = splitTopLevelBlocks(newHtml).map(blockSignature);
  const n = oldSigs.length;
  const m = newSigs.length;

  if (m === 0) return [];
  // No baseline to compare against — treat nothing as "changed" rather than
  // lighting up the whole document.
  if (n === 0) return [];

  // LCS length table (row-major, n+1 × m+1).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let a = n - 1; a >= 0; a--) {
    for (let b = m - 1; b >= 0; b--) {
      dp[a]![b] =
        oldSigs[a] === newSigs[b]
          ? dp[a + 1]![b + 1]! + 1
          : Math.max(dp[a + 1]![b]!, dp[a]![b + 1]!);
    }
  }

  // Walk the table to find which NEW blocks are part of the common subsequence.
  const matched = new Set<number>();
  let a = 0;
  let b = 0;
  while (a < n && b < m) {
    if (oldSigs[a] === newSigs[b]) {
      matched.add(b);
      a++;
      b++;
    } else if (dp[a + 1]![b]! >= dp[a]![b + 1]!) {
      a++;
    } else {
      b++;
    }
  }

  const changed = new Set<string>();
  for (let b2 = 0; b2 < m; b2++) {
    if (!matched.has(b2)) changed.add(newSigs[b2]!);
  }
  return Array.from(changed);
}
