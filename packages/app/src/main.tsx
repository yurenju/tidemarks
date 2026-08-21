import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import "./index.css";
import App from "./App.tsx";
import { activateLocale, i18n } from "./lib/i18n.ts";
import { browserPreferences, loadLocale } from "./lib/locale.ts";

// Before the first render rather than inside an effect: every string below this line asks the
// catalog what it says, and a catalog activated one paint later would show the whole interface
// in English and then replace it. The catalogs are bundled (`lib/i18n.ts`), so there is nothing
// to wait for.
activateLocale(loadLocale(browserPreferences()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <App />
    </I18nProvider>
  </StrictMode>,
);
