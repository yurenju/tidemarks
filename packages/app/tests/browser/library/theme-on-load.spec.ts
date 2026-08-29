// The theme has to be settled before the first paint, not one effect later. A PWA window's
// frame is painted from whatever theme-color the document announces while it loads, so a page
// that starts light and corrects itself afterwards leaves an installed app wearing a white
// border until something else writes the tag — which on the shelf is nothing, until the reader
// opens a book. `index.html` resolves the theme inline for exactly this; these two tests are
// what fails if that script is ever removed.
//
// Only a browser can answer this: the failure is a matter of *when* the attribute is set, and
// every seam below one is past the moment in question.
import { expect, test } from "../support/fixtures.js";

test.describe("dark", () => {
  test.use({ colorScheme: "dark" });

  test("the page is already dark when it is first parsed", async ({ page }) => {
    // Read at `interactive`, which is before any module script has run — so what is captured is
    // what the document announced on its own, not what React later corrected it to.
    await page.addInitScript(() => {
      (window as unknown as { first?: unknown }).first = null;
      document.addEventListener("readystatechange", () => {
        const w = window as unknown as { first: unknown };
        if (w.first === null && document.readyState === "interactive") {
          w.first = {
            theme: document.documentElement.dataset.theme ?? null,
            color: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
          };
        }
      });
    });

    await page.goto("/");

    const first = await page.evaluate(() => (window as unknown as { first: unknown }).first);
    // The dark theme's `--surface-page`. Restated here rather than read out of the cascade,
    // because the point of the test is the moment before the cascade has arrived.
    expect(first).toEqual({ theme: "dark", color: "#16202b" });
  });
});

test.describe("light", () => {
  test.use({ colorScheme: "light" });

  test("a light machine still gets the light theme", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f4eee2");
  });
});
