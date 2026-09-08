import { msg } from "@lingui/core/macro";
import Segmented from "./Segmented";
import { themeDark, themeLight, themeSystem } from "./setting-art";
import { THEME_CHOICES, type Theme } from "../lib/settings";

/**
 * Light or dark, as one row — and the only setting that appears on both floors.
 *
 * The other five say how a *book* is set, so they live where a book is: [[Settings]] used to show
 * them beside the shelf, where a reader could move every one of them and see nothing change
 * (ADR-0050). This one is different in the way that matters — pressing Dark repaints whatever
 * screen it was pressed on — which is why it stayed behind when they left.
 *
 * A row of its own rather than a copy in each place, because the two callers are a panel and a
 * floor, and two identical-looking controls that drift apart is the failure ADR-0005 already
 * paid for once.
 */
export default function ThemeField({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}) {
  return (
    <Segmented
      label={msg({
        message: "Theme",
        comment:
          "Label of the light/dark control. It is shown in two places — the reader's typography panel and [[Settings]]'s interface tab — and is one setting in both.",
      })}
      testId="setting-theme"
      shape="tiles"
      options={THEME_ART}
      value={theme}
      onChange={onChange}
    />
  );
}

const THEME_ART = THEME_CHOICES.map((choice) => ({
  ...choice,
  art: choice.value === "system" ? themeSystem : choice.value === "light" ? themeLight : themeDark,
}));
