import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";

/**
 * The box a note is written in, and [[Done]] under it — on a desk's card in [[Notes]], and on a
 * phone's one-note page (`NotePage`). Mounted while the note is open for writing and not otherwise,
 * so its going away is the note being closed.
 *
 * **The box is the first thing in whatever holds it, and that is the whole of ADR-0044.** A
 * virtual keyboard takes the bottom of the screen and tells the layout nothing about it — no
 * viewport unit moves — and then scrolls the whole page to bring a covered caret into view, which
 * is what threw the panel off the top of an iPhone. Nothing here asks how tall the keyboard is.
 * The caret starts where a keyboard cannot reach, so there is nothing for the scroll to do.
 *
 * Being near the top of its holder is only half of it — the panel is scrolled to the holder as
 * well, in the effect below. Neither half is enough alone: the box at the top of a card with the
 * list left where it was puts it thirty rows down, and a scrolled list with the box under the
 * quote puts it back under the keyboard.
 */
export default function NoteEditor({
  note,
  onPersist,
  onSave,
}: {
  /** The note as it is stored. */
  note: string;
  /** Write the words down without closing anything. Called on every way out of the box. */
  onPersist: (note: string) => void;
  /** [[Done]]: the words, and then the box closes. */
  onSave: (note: string) => void;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(note);
  useEffect(() => setDraft(note), [note]);

  /**
   * **The words are written down when the box goes away, by whatever took it.** A tap on the
   * page, a page turn, the panel closing, the reader pressing [[Done]] — all of them end up here,
   * because all of them unmount the box and this runs on the way out.
   *
   * `blur` is not what listens, and could not be: removing a focused element does not fire it in
   * every engine, so the one route that matters most on a phone — the system taking the panel
   * away — would be the one that lost the words. Cleanup runs whatever happened.
   *
   * The refs are so this effect runs once per box. Watching the callback or the stored note would
   * tear the effect down and put it back on every save, and the teardown *is* the write, so it
   * would write again with what it had just written.
   */
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const committedRef = useRef(note);
  committedRef.current = note;
  const persistRef = useRef(onPersist);
  persistRef.current = onPersist;
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    // ponytail: puts `window.scrollY` back by hand rather than proving nobody moved it.
    // WebKit scrolls the page to reveal a focused element and there is no first-party answer to
    // whether it scrolls back when the keyboard goes — an iPhone was seen leaving ~152pt of blank
    // below the panel afterwards, which matches the overflow to within 6pt but was never
    // confirmed (ADR-0044, on what it costs). Read before the focus below, not after, or it records the
    // number the focus already moved.
    const scrollWas = window.scrollY;

    const box = boxRef.current;
    if (box !== null) {
      // **Brings the holder to the top of the panel, then focuses.** "First in the card" is not
      // "first on screen": the desk's list carries every mark in the book, so the 31st one being
      // edited sits thirty cards down a scroll container. Scrolling the container is what makes
      // ADR-0044's rule true; `preventScroll` below then stops the *window* being scrolled as
      // well, which is the half iOS does uninvited.
      const list = box.closest<HTMLElement>(".panel-body");
      const holder = box.closest<HTMLElement>(".annotation-item, .note-page");
      if (list !== null && holder !== null) {
        list.scrollTop += holder.getBoundingClientRect().top - list.getBoundingClientRect().top;
      }
      // `autoFocus` cannot carry `preventScroll`, which is the whole reason this is a ref and an
      // effect rather than an attribute. WebKit reveals a focused element by moving the enclosing
      // scroll view — `window.scrollY` on this side — and skips that entirely when the flag is
      // set (`WKContentViewInteraction.mm`).
      //
      // ⚠️ Here rather than in the ref callback: an inline callback is a new function every
      // render, so React detaches and reattaches it each time — and the box would steal the focus
      // back on any render at all, deleting a *different* note being enough to do it. On a phone
      // that is the keyboard coming back up over a reader who just dismissed it.
      box.focus({ preventScroll: true });
    }

    return () => {
      const unsaved = draftRef.current !== committedRef.current;
      if (unsaved) persistRef.current(draftRef.current);
      if (window.scrollY !== scrollWas) window.scrollTo({ top: scrollWas });
    };
  }, []);

  return (
    <div className="note-editor">
      <textarea
        ref={boxRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        // **Two ways for the words to reach the database, and they cover different exits.**
        // This one is the ordinary case: the reader moves the focus somewhere else while the
        // panel stays open — pressing this note's own quote on a desk does exactly that, and
        // the editor is still standing afterwards, so the cleanup has not run and would not
        // run before a reload. The cleanup covers what this cannot: removing a focused
        // element does not fire `blur` in every engine, so the panel being taken away — the
        // route that matters most on a phone — arrives only there.
        onBlur={() => {
          if (draft === committedRef.current) return;
          committedRef.current = draft;
          onPersist(draft);
        }}
        placeholder={t({
          message: "Note…",
          comment:
            "Placeholder in the empty note box under a marked passage. The ellipsis is one character.",
        })}
      />
      <button
        onClick={() => {
          // Claimed before the write is asked for, so the cleanup above sees the words as
          // already down and does not send them a second time.
          committedRef.current = draft;
          onSave(draft);
        }}
      >
        <Trans comment="Button that closes the note box under a marked passage. The words are already written down by the time it is pressed — this only puts the box away — so it says the writing is finished rather than naming a save.">
          Done
        </Trans>
      </button>
    </div>
  );
}
