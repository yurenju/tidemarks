/**
 * One section of a book, read as text and pointed back into — **without a browser**.
 *
 * This is what the tree layer is for. A consumer holding a book's bytes and nothing else can
 * now answer both directions of the question a reading position asks:
 *
 * - *what is the reader looking at* — a stored CFI comes in, a stretch of this section's text
 *   comes out
 * - *where is this passage* — a stretch of text goes in, a CFI comes out, and it addresses
 *   the same place the browser would have written
 *
 * The second direction is the one that was impossible before, and it is the one that matters
 * for writing anything back: a note has to be anchored, and an anchor is a CFI.
 *
 * ## Character offsets, not node offsets
 *
 * The unit on this interface is "the Nth character of this section's text", counted by the
 * same traversal the whole-book index uses (`text-nodes.ts`). That is deliberate: node
 * offsets are a property of one parser's tree, and this whole module exists because two
 * parsers produce trees that differ in small ways. Character offsets into the flattened text
 * are the thing both of them agree on, and they are also what a consumer can actually work
 * with — searching for a passage is `indexOf`, not a tree walk.
 *
 * ## What it does not do
 *
 * It does not paginate, measure, or lay anything out. A **page** is a product of layout, and
 * layout needs a browser (CONTEXT.md); nothing here can say which characters share a screen.
 * A consumer that needs that has to be told by whatever is rendering.
 */

import type { Cfi } from "./cfi.ts";
import { cfiForPositions, positionsForCfi, sectionIndexOf } from "./cfi-tree.ts";
import {
  bodyOf,
  charactersAt,
  countCharactersIn,
  positionAtCharacterIn,
  textNodesUnder,
} from "./text-nodes.ts";
import type { TreeNode } from "./tree.ts";
import { parseContentTree } from "./xml.ts";

/**
 * The elements that begin a paragraph of their own, as XHTML's default rendering sets them.
 *
 * **The markup's answer, not the stylesheet's.** A book can restyle a `<p>` inline or a `<span>`
 * as a block, and only a browser applying its CSS can say what it did — but this layer has no
 * browser (ADR-0012), and a paragraph is wanted by readers that have none either. What the tag
 * says is the answer every book's author wrote down; a book that overrode it gets its paragraph
 * cut where the markup cuts it.
 */
const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "caption",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

/** The block a text node is set in: the nearest ancestor that begins a paragraph. */
function blockOf(node: TreeNode): TreeNode | null {
  for (let at = node.parentNode; at !== null; at = at.parentNode) {
    if (BLOCK_ELEMENTS.has((at.localName ?? "").toLowerCase())) return at;
  }
  return null;
}

/**
 * The elements whose text is set beside the line rather than along it: a ruby annotation, and the
 * fallback parentheses a reader without ruby support shows around one.
 */
const RUBY_TEXT_ELEMENTS = new Set(["rt", "rp"]);

/** Whether a text node is ruby text — inside an `<rt>` or `<rp>`, at any depth. */
function isRubyText(node: TreeNode): boolean {
  for (let at = node.parentNode; at !== null; at = at.parentNode) {
    if (RUBY_TEXT_ELEMENTS.has((at.localName ?? "").toLowerCase())) return true;
  }
  return false;
}

/** A stretch of a section's text, as character offsets into `ContentDocument.text`. */
export interface TextRange {
  readonly start: number;
  /** Exclusive, so `text.slice(start, end)` is the passage. */
  readonly end: number;
}

export class ContentDocument {
  /** Which readingOrder item this is — every CFI written here begins with it. */
  readonly sectionIndex: number;
  /** This section's text, in document order, with the whole-book index's filter applied. */
  readonly text: string;

  private readonly root: TreeNode;
  private readonly nodes: readonly TreeNode[];

  private constructor(sectionIndex: number, root: TreeNode, nodes: readonly TreeNode[]) {
    this.sectionIndex = sectionIndex;
    this.root = root;
    this.nodes = nodes;
    this.text = nodes.map((node) => node.nodeValue ?? "").join("");
  }

  /**
   * Reads one content document.
   *
   * **Throws** `EpubOpenError` with reason `malformed-content-document` when the XHTML will
   * not parse, carrying the same detail (and line number) the packaging documents get. It
   * throws rather than returning `undefined` so that "this section is broken" and "this
   * section has nothing to read" stay distinguishable — a consumer catching it says *this
   * section cannot be read*, which is also what a browser does with the same bytes, and it
   * does not affect the rest of the book.
   *
   * A section with no `<body>`, or a body holding no text, parses successfully and has empty
   * `text`. An image-only section is a real and ordinary thing, not a failure.
   */
  static parse(xhtml: string, sectionIndex: number): ContentDocument {
    const root = parseContentTree(xhtml, {
      reason: "malformed-content-document",
      label: `the content document of section ${sectionIndex}`,
    });

    const body = bodyOf(root);
    const nodes = body === undefined ? [] : textNodesUnder(body);
    return new ContentDocument(sectionIndex, root, nodes);
  }

  /**
   * The CFI addressing characters `[start, end)` of `text`.
   *
   * With `end` omitted, or equal to `start`, this gives a **point** rather than a
   * zero-length range — the spec spells them differently, and a reading position is a point
   * while an annotation is a range.
   *
   * Offsets past the end of the text stop at the end rather than failing: a passage found in
   * one edition of a book and looked up in another is the ordinary case, and landing at the
   * nearest position beats refusing.
   *
   * Returns `undefined` only when this section has no text at all, because then there is no
   * position for a character offset to mean.
   */
  cfiForCharacters(start: number, end?: number): Cfi | undefined {
    const from = positionAtCharacterIn(this.nodes, start);
    if (from === undefined) return undefined;

    const to = end === undefined ? from : positionAtCharacterIn(this.nodes, end);
    if (to === undefined) return undefined;

    const collapsed = end === undefined || end <= start;
    return cfiForPositions(from, to, collapsed, this.sectionIndex);
  }

  /**
   * Which characters of `text` a CFI addresses.
   *
   * A point CFI gives a range whose `start` and `end` are equal — the caller keeps whatever
   * distinction it needs; this answers "where", not "what kind".
   *
   * Returns `undefined` in three cases, and each of them would otherwise be a confident wrong
   * answer rather than a visible failure:
   *
   * - the CFI belongs to **another section** — without the check, a CFI written for section 3
   *   resolves happily against section 5's tree and points at the wrong words
   * - it will not walk this document at all
   * - it walks, but **lands outside the text** — inside `<head>`, or on an `<img>`. There is
   *   no character offset for that position, and the obvious stand-in (0) is indistinguishable
   *   from the first character of the section
   */
  charactersForCfi(cfi: Cfi): TextRange | undefined {
    if (sectionIndexOf(cfi) !== this.sectionIndex) return undefined;

    const positions = positionsForCfi(this.root, cfi);
    if (positions === undefined) return undefined;

    const start = charactersAt(this.nodes, positions.start.node, positions.start.offset);
    const end = charactersAt(this.nodes, positions.end.node, positions.end.offset);
    if (start === undefined || end === undefined) return undefined;

    return { start, end };
  }

  /**
   * The paragraphs a stretch of `text` falls in, in document order: each one whole, as offsets
   * into `text`, from the first the stretch touches to the last.
   *
   * **The flattened text has no seams of its own** — the indentation between two blocks is not
   * counted (`text-nodes.ts`), so `text` runs the last word of one paragraph straight into the
   * first of the next. Where one paragraph ends is a fact about the tree, and this is the only
   * layer still holding it.
   *
   * A paragraph is the run of text set in one block (`BLOCK_ELEMENTS`), so a block holding
   * another — a `<blockquote>` around two `<p>`s, a `<div>` with loose text beside a `<p>` — is
   * cut where the inner block begins and ends, which is where its lines break.
   *
   * A point (`start === end`) answers with the one paragraph it stands in. Empty when nothing
   * of `text` is in reach: a section with no text, or a stretch past its end.
   */
  paragraphsAround(range: TextRange): readonly TextRange[] {
    const around: TextRange[] = [];
    for (const paragraph of this.paragraphs()) {
      const touches =
        range.start === range.end
          ? paragraph.start <= range.start && range.start < paragraph.end
          : paragraph.start < range.end && range.start < paragraph.end;
      if (touches) around.push(paragraph);
    }
    return around;
  }

  /**
   * The stretches of `text` within a range that are ruby annotations (`<rt>`, and the `<rp>`
   * parentheses around one), in document order.
   *
   * **They are in `text` because they are in the book**: a reading over a word is characters the
   * whole-book index counts and a CFI can point into. But they are read beside the line, not along
   * it, so a consumer setting a passage as one run of prose — where there is no beside — has to be
   * able to tell them from the words they stand over. `山路(やまみち)を` flattened is
   * `山路やまみちを`, and nothing in the string says which half is the reading.
   */
  rubyTextIn(range: TextRange): readonly TextRange[] {
    const found: TextRange[] = [];
    let at = 0;
    for (const node of this.nodes) {
      const start = at;
      at += node.nodeValue?.length ?? 0;
      if (at <= range.start || start >= range.end || !isRubyText(node)) continue;
      const from = Math.max(start, range.start);
      const to = Math.min(at, range.end);
      const last = found.at(-1);
      if (last !== undefined && last.end === from)
        found[found.length - 1] = { start: last.start, end: to };
      else found.push({ start: from, end: to });
    }
    return found;
  }

  private paragraphCache: readonly TextRange[] | undefined;

  /** Every paragraph of the section, worked out once and only when asked. */
  private paragraphs(): readonly TextRange[] {
    if (this.paragraphCache !== undefined) return this.paragraphCache;
    const found: TextRange[] = [];
    let start = 0;
    let at = 0;
    let block: TreeNode | null | undefined;
    for (const node of this.nodes) {
      const next = blockOf(node);
      if (block !== undefined && next !== block && at > start) {
        found.push({ start, end: at });
        start = at;
      }
      block = next;
      at += node.nodeValue?.length ?? 0;
    }
    if (at > start) found.push({ start, end: at });
    this.paragraphCache = found;
    return found;
  }

  /** How many characters this section holds. */
  get characters(): number {
    return countCharactersIn(this.nodes);
  }
}
