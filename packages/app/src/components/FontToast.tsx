/**
 * The one-off note that explains the reflow after the fact — applied, or could not be had.
 *
 * `role="status"` so a screen reader hears it. It has no dismiss, because it is not a control:
 * the hook that raises it clears it (`lib/useCarriedFont.ts`).
 */
export default function FontToast({ note }: { note: string | null }) {
  if (note === null) return null;
  return (
    <div className="font-toast" role="status">
      {note}
    </div>
  );
}
