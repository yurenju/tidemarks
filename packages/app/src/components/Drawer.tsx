import { useLingui } from "@lingui/react/macro";
import type { SegmentLabel } from "./Segmented";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import type { ReactNode } from "react";

/**
 * The shell every drawer wears: a panel stacked on the screen the reader was already on.
 *
 * Open and closed is not this component's to decide — the hash says which drawer is up, so a
 * drawer survives a refresh and Android's back button closes it rather than the app. All this
 * does is report a dismissal upwards.
 */
export default function Drawer({
  open,
  onClose,
  title,
  testId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: SegmentLabel;
  /** `data-testid` for the popup, so tests stop naming the layout. */
  testId: string;
  children: ReactNode;
}) {
  const { t, i18n } = useLingui();
  return (
    <BaseDrawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      /* Never `modal={true}`. That renders a `position: fixed; inset: 0` interception element
         and, on desktop, writes `height: 100dvh; overflow: hidden` onto `<body>` — and both of
         those fight the page-turn gesture and frond's `pointerup` in the reader underneath.
         `'trap-focus'` keeps the keyboard inside the drawer without either. */
      modal="trap-focus"
      swipeDirection="right"
    >
      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop className="drawer-backdrop" />
        <BaseDrawer.Viewport className="drawer-viewport">
          <BaseDrawer.Popup className="drawer-popup" data-testid={testId}>
            <header className="drawer-header">
              <BaseDrawer.Title className="drawer-title">
                {typeof title === "string" ? title : i18n._(title)}
              </BaseDrawer.Title>
              <BaseDrawer.Close
                className="ghost drawer-close"
                aria-label={t({
                  message: "Close",
                  comment:
                    "Screen-reader name for the ✕ that dismisses a drawer or a panel. A verb: it is the action, not a label for the thing being shut.",
                })}
              >
                ✕
              </BaseDrawer.Close>
            </header>
            <div className="drawer-body">{children}</div>
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  );
}
