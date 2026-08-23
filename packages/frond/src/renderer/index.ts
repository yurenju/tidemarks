/**
 * The public face of the `Renderer` layer — the upper half of ADR-0005's two-layer
 * split: it needs the DOM.
 *
 * Consumers only need what is in this file: mounting a book on a container, turning
 * pages, jumping to a position, changing reader settings, receiving events.
 * `section-view.ts` / `document-source.ts` / `cfi-dom.ts` / `layout.ts` are
 * implementation and are not on the public face.
 *
 * `MemoryBook` is here, and deliberately so: ADR-0002 explicitly requires frond to
 * **provide its own fake / in-memory implementation and treat it as part of the public
 * API** — a layer above testing a pure decision module such as a Navigator should not
 * be forced to build its own doubles.
 *
 * The intervention list (`INTERVENTIONS`) is on the public face too. Which parts of a
 * book frond touched is a fact the consumer has a right to know, not an implementation
 * detail (ADR-0003).
 */

export { Renderer } from "./renderer.ts";
export type {
  PageOffset,
  RendererListeners,
  RendererOptions,
  RendererStart,
  SectionAnchor,
  SectionAt,
  TurnDirection,
  TurnInProgress,
} from "./renderer.ts";

// The rectangles `rectsFor` answers with. `section-view.ts` is implementation, but the shape
// of what it hands back is not — a consumer drawing marks needs the names.
export type { MarkedRect, RectRole } from "./section-view.ts";

export { MemoryBook } from "./book.ts";
export type {
  MemoryBookSpec,
  MemoryResourceSpec,
  MemorySectionSpec,
  RenderableBook,
  RenderableLocation,
  RenderableResource,
  RenderableSection,
} from "./book.ts";

export type {
  IndexedEvent,
  LayoutEvent,
  LinkActivateEvent,
  Listener,
  RenderLocation,
  RendererErrorEvent,
  RendererEvents,
  RendererFailure,
  RendererKeyEvent,
  RendererPointerDownEvent,
  RendererPointerEvent,
  SectionLoadEvent,
  SelectionEvent,
  Unsubscribe,
} from "./events.ts";

export { DEFAULT_SETTINGS, withSettings } from "./settings.ts";
export type {
  FontFace,
  GenericFamilies,
  LayoutFacts,
  LayoutSettings,
  ReaderSettings,
  ResolveLayout,
  Theme,
} from "./settings.ts";

// `COLUMN_GAP` is here because doing frond's column arithmetic **backwards** — how much of
// the container may the text have, for lines of at most N ems — cannot be written without
// it (`geometry.ts`).
export { COLUMN_GAP } from "./geometry.ts";
export type {
  ColumnChoice,
  Insets,
  Margin,
  PageBox,
  TurnEdge,
  Viewport,
  WritingMode,
} from "./geometry.ts";

// Which of the three frames in the container is the page the reader is reading. A consumer's
// own browser tests have to be able to say so, and "the iframe" stopped being an answer the
// day there were three of them (frond ADR-0013).
export { CURRENT_FRAME_ATTRIBUTE, PEEK_FRAME_ATTRIBUTE } from "./section-view.ts";

export { INTERVENTIONS } from "./interventions.ts";
export type { Intervention, InterventionReason } from "./interventions.ts";

export { SectionParseError } from "./document-source.ts";
export { WritingModeUnreadableError } from "./section-view.ts";
