import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";
import {
  addPasskey,
  cancelPasskeyPrompt,
  loginWithPasskey,
  logout,
  me,
  passkeyAutofillAvailable,
  requestMagicCode,
  verifyMagicCode,
} from "../lib/auth";
import { authorizeReturnTarget } from "../lib/authorize-return";
import { db } from "../lib/db";
import { downloadBlob } from "../lib/download";
import { parseImport, serializeExport } from "../lib/export";
import { siteUrl } from "../lib/site";
import {
  getSyncState,
  refreshQuota,
  scheduleSync,
  subscribeSync,
  syncNow,
  type SyncState,
} from "../lib/sync";
import { onlyOnThisDevice } from "../lib/sync-payload";

const STATUS_LABEL: Record<SyncState["status"], MessageDescriptor | null> = {
  // Nothing to report, so nothing said — the row simply has no second half.
  idle: null,
  syncing: msg({
    message: "Syncing…",
    comment: "Sync status beside the 'Sync' button. The ellipsis is one character.",
  }),
  synced: msg({
    message: "Synced",
    comment: "Sync status beside the 'Sync' button: this device and the server agree.",
  }),
  offline: msg({
    message: "Offline",
    comment:
      "Sync status beside the 'Sync' button: there is no network, which is not an error — reading carries on.",
  }),
  unauthenticated: msg({
    message: "Not signed in",
    comment: "Sync status beside the 'Sync' button: there is no account to sync with.",
  }),
  error: msg({
    message: "Sync failed",
    comment:
      "Sync status beside the 'Sync' button: the attempt reached the server and did not work.",
  }),
};

/**
 * [[Account]]: the half of Tidemarks that runs on someone else's machine, and whether the reader
 * wants it.
 *
 * The line it draws is the product's: **a book runs in the browser, so reading costs nothing;
 * syncing and MCP burn a server, so that half is paid.** The invitation to pay lives here and
 * nowhere else — a login box on the shelf would ask every reader to answer a question most of
 * them never need to.
 *
 * It is a **pane of [[Settings]]**, not a surface of its own: it brings no shell, no title and no
 * close button, because the screen around it already has all three.
 */
export default function AccountPanel({ onImported }: { onImported: () => void }) {
  return (
    <>
      <section className="settings-section">
        <p className="settings-lede">
          <Trans comment="Opening line of the account pane, before any mention of signing in. It is the product's own line: reading needs no account at all.">
            No account needed to read. Your books, notes and reading positions never leave this
            device.
          </Trans>
        </p>
        <dl className="price-lines">
          <dt>
            <Trans comment="Heading of the free half of the price list.">Always free</Trans>
          </dt>
          <dd>
            <Trans comment="What the free half covers. A list of the app's verbs, ending with where they run.">
              Importing, reading, marking, note-taking, typesetting and exporting all run in your
              browser.
            </Trans>
          </dd>
          <dt>
            <Trans comment="Heading of the middle tier of the price list: an account that pays nothing. It syncs three books (ADR-0011).">
              Free account
            </Trans>
          </dt>
          <dd>
            <Trans comment="What a free account gets. 'Three' is the free quota and 'those three' the same books: an agent connected to the account can read only what is synced.">
              Three books sync between your devices, and an agent can read those three.
            </Trans>
          </dd>
          <dt>
            <Trans comment="Heading of the paid tier of the price list.">Paid</Trans>
          </dt>
          <dd>
            <Trans comment="What paying gets, in the price list at the top of the account pane. One price everywhere, in US dollars; Paddle's checkout window is what converts it for the reader.">
              Every book, US$20 a year.
            </Trans>
          </dd>
        </dl>
      </section>

      <Billing />
      <SignIn />
      {/* The connected agents go here, between the keys and the backup: it is a thing you revoke,
          which is the same kind of act as logging a device out. It needs a Worker endpoint and
          a D1 query that do not exist yet (#130). */}
      <Backup onImported={onImported} />
    </>
  );
}

/** Where the reader is in a checkout they started, kept across the trip out to Paddle. */
const CHECKOUT_MARK = "tidemarks_checkout_started";

/**
 * When the checkout was started, or null if none was.
 *
 * Every access is wrapped: a browser told to block site data throws on the accessor itself, and
 * an exception in a render would take the whole account pane down with it. Same shape as
 * `lib/shelf-order.ts`.
 *
 * **The time rather than a flag**, so the minute below is counted from the checkout, not from
 * this component mounting. A reader who opens the drawer, closes it and opens it again would
 * otherwise start the wait over each time.
 */
function checkoutStartedAt(): number | null {
  try {
    const stored = Number(sessionStorage.getItem(CHECKOUT_MARK));
    return stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

function markCheckout(at: number | null): void {
  try {
    if (at === null) sessionStorage.removeItem(CHECKOUT_MARK);
    else sessionStorage.setItem(CHECKOUT_MARK, String(at));
  } catch {
    // A browser that will not keep this simply shows the upgrade button again on return. The
    // subscription itself is Paddle's business and is unaffected.
  }
}

/** How long to keep asking whether Paddle's webhook has landed, and how often. */
const CONFIRM_FOR_MS = 60_000;
const CONFIRM_EVERY_MS = 3000;

/**
 * The bill: what paying gets, the way in, and the way out.
 *
 * **The quota is the whole state machine.** No limit means subscribed, three means not, and the
 * server is the only one who says which (`/auth/me`) — a subscription is Paddle's fact, mirrored
 * into D1 by a webhook, and nothing on the device is allowed a second opinion.
 *
 * That mirror runs a few seconds behind, which is the reason for the wait below. The reader comes
 * back from Paddle before the webhook does, so a page that trusted the redirect would say
 * "subscribed" and then be contradicted by the next sync. Instead the return is treated as a
 * question — was it really paid? — and the server answers it (ADR-0049).
 */
function Billing() {
  const { t } = useLingui();
  const [quota, setQuota] = useState(() => getSyncState().quota);
  useEffect(() => subscribeSync((s) => setQuota(s.quota)), []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only ever read on the way back from Paddle, and cleared the moment it is answered.
  const [startedAt, setStartedAt] = useState(checkoutStartedAt);
  const confirming = startedAt !== null;
  const [gaveUp, setGaveUp] = useState(false);

  const subscribed = quota !== null && quota.limit === null;
  const free = quota !== null && quota.limit !== null;

  // **"No word from Paddle" has to go the moment there is word from Paddle.** The webhook can
  // land after the minute is up — Paddle retries, and a slow one is exactly the case that made
  // the message appear — and a reader who is now subscribed should not still be reading that
  // their payment has not arrived. Seen for real: the shelf said "every book syncs" with the
  // apology still above it.
  useEffect(() => {
    if (subscribed) setGaveUp(false);
  }, [subscribed]);

  // The wait for the webhook. It stops for whichever comes first: the limit lifting, or a minute
  // going by — and a minute of nothing is a sentence on screen rather than a spinner that never
  // ends, because the reader's real question is whether their card was charged.
  useEffect(() => {
    if (startedAt === null) return;
    if (subscribed) {
      markCheckout(null);
      setStartedAt(null);
      return;
    }

    const stop = () => {
      markCheckout(null);
      setStartedAt(null);
      setGaveUp(true);
    };
    if (Date.now() - startedAt > CONFIRM_FOR_MS) {
      stop();
      return;
    }
    const timer = setInterval(() => {
      if (Date.now() - startedAt > CONFIRM_FOR_MS) return stop();
      void refreshQuota().catch(() => {});
    }, CONFIRM_EVERY_MS);
    return () => clearInterval(timer);
  }, [startedAt, subscribed]);

  async function upgrade() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/billing/checkout", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const { url } = (await res.json()) as { url: string };
      // Written before leaving, not after coming back: the return is a plain navigation with
      // nothing on it to say where the reader has been.
      markCheckout(Date.now());
      window.location.assign(url);
    } catch {
      setBusy(false);
      setError(
        t({
          message: "The checkout could not be opened. Nothing has been charged.",
          comment:
            "Shown when pressing upgrade failed before the reader ever reached Paddle. The second sentence is the one that matters: the reader's first thought is whether they have been charged for nothing.",
        }),
      );
    }
  }

  return (
    <section className="settings-section" data-testid="billing">
      <h3 className="settings-section-title">
        <Trans comment="Heading of the billing section in the account pane.">Billing</Trans>
      </h3>
      <dl className="price-lines">
        <dt>
          <Trans comment="Heading of the line explaining what happens if the reader stops paying.">
            If you stop
          </Trans>
        </dt>
        <dd>
          <Trans comment="What happens if the reader stops paying. The point of the second sentence is that nothing on the device is held hostage (ADR-0013).">
            The server's copy is kept for 24 months. The books, notes and positions on this device
            are untouched.
          </Trans>
        </dd>
      </dl>

      {confirming && (
        <p className="settings-note" data-testid="billing-confirming">
          <Trans comment="Shown after the reader comes back from paying, while the page waits for the payment provider to tell the server. It is deliberately not 'thank you' — nothing is confirmed yet.">
            Confirming your payment…
          </Trans>
        </p>
      )}
      {gaveUp && (
        <p className="settings-note" data-testid="billing-slow">
          <Trans comment="Shown when a minute has gone by since the reader came back from paying and the payment provider still has not told the server. It says to come back rather than to try again, because paying twice is the wrong thing to do here.">
            No word from Paddle yet. Your payment is not lost — check back in a few minutes.
          </Trans>
        </p>
      )}

      {free && !confirming && (
        <>
          <div className="settings-actions">
            <button
              className={busy ? "primary busy-edge" : "primary"}
              onClick={() => void upgrade()}
              disabled={busy}
              data-testid="upgrade"
            >
              {/* One price everywhere, written out rather than fetched: Paddle holds a single
                  amount in US dollars (ADR-0011), so asking it what this reader would pay only
                  ever gets the same twenty back. Paddle's own checkout window still shows the
                  reader their currency. */}
              <Trans comment="The button that starts a subscription. The price is the same everywhere and is written into the sentence; Paddle's checkout window converts it for the reader afterwards. Keep the currency as US dollars.">
                Subscribe for US$20 a year
              </Trans>
            </button>
          </div>
          <p className="settings-note">
            <Trans comment="Under the upgrade button. Paddle is the merchant of record — it takes the payment and issues the invoice — and the refund window is 14 days, unconditional.">
              Paddle handles the payment and the invoice. Full refund within 14 days, no questions
              asked.
            </Trans>
          </p>
        </>
      )}

      {subscribed && (
        <p className="settings-note">
          {/* A plain link rather than a button: it leaves for Paddle's own pages, where the card,
              the invoices and cancelling all live. Nothing about them is ours to show. Styled by
              the bare `a` rule in controls.css, along with the legal links below it — one look
              for every link on this pane. */}
          <a href="/billing/portal" data-testid="manage-subscription">
            <Trans comment="Link out to the payment provider's own pages, where the reader can cancel, change their card and download invoices.">
              Manage your subscription
            </Trans>
          </a>
        </p>
      )}

      {error && <p className="error">{error}</p>}
      <p className="settings-note">
        <Trans comment="Note under the billing section, pointing at the way out of paying: the syncing half is open source and can be run by the reader.">
          Would rather not pay, but want two devices? The syncing half can be self-hosted.
        </Trans>
      </p>
      <LegalDocuments />
    </section>
  );
}

/**
 * The three documents a reader is entitled to read before paying, on the public site.
 *
 * **Nothing at all when this deployment has no site** (`lib/site.ts`): these are one seller's
 * documents, and a self-hosted Tidemarks has a different seller. The whole row goes rather than
 * individual links, because two of the three present without the third reads as a bug.
 *
 * They open in a new tab: this is a different origin, and a reader who followed a link out of the
 * account pane and came back would find the pane closed.
 */
function LegalDocuments() {
  const terms = siteUrl("/legal/terms");
  const refunds = siteUrl("/legal/refunds");
  const privacy = siteUrl("/legal/privacy");
  if (terms === null || refunds === null || privacy === null) return null;

  return (
    <p className="settings-note">
      <a href={terms} target="_blank" rel="noreferrer">
        <Trans comment="Link in the billing section to the terms of service, on the public site. A document title, so it is capitalised as one.">
          Terms of service
        </Trans>
      </a>
      {" · "}
      <a href={refunds} target="_blank" rel="noreferrer">
        <Trans comment="Link in the billing section to the refund policy, on the public site. A document title, so it is capitalised as one.">
          Refund policy
        </Trans>
      </a>
      {" · "}
      <a href={privacy} target="_blank" rel="noreferrer">
        <Trans comment="Link in the billing section to the privacy policy, on the public site. A document title, so it is capitalised as one.">
          Privacy policy
        </Trans>
      </a>
    </p>
  );
}

/**
 * "3 of 3 books sync. 2 are only on this device." — one entry, so each language joins the two
 * halves with its own punctuation. Named rather than read inline so the catalog says `held` and
 * `limit` instead of `{0}` and `{1}`.
 */
function QuotaLine({ held, limit, onDevice }: { held: number; limit: number; onDevice: number }) {
  return (
    <Trans comment="Under the sync status, for a free account. `held` is how many books the server holds, `limit` the account's quota, `onDevice` how many books this device has that the server refused — zero when the account is not full, and then the second half says nothing.">
      {held} of {limit} books sync.{" "}
      <Plural
        value={onDevice}
        _0=""
        one="# is only on this device."
        other="# are only on this device."
      />
    </Trans>
  );
}

/** Export and restore — one file, both directions. */
function Backup({ onImported }: { onImported: () => void }) {
  const { t } = useLingui();
  // Which direction is running, not merely whether one is: both buttons are disabled
  // while either works, but only the one actually doing something wears the busy line.
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  async function exportAll() {
    setBusy("export");
    try {
      const [books, progress, annotations, sessions] = await Promise.all([
        db.books.toArray(),
        db.progress.toArray(),
        db.annotations.toArray(),
        db.readingSessions.toArray(),
      ]);
      const json = await serializeExport({ books, progress, annotations, sessions });
      downloadBlob(new Blob([json], { type: "application/json" }), "tidemarks-export.json");
    } finally {
      setBusy(null);
    }
  }

  async function importAll(file: File) {
    setError(null);
    setBusy("import");
    try {
      const bundle = await parseImport(await file.text());
      await db.transaction(
        "rw",
        [db.books, db.progress, db.annotations, db.readingSessions],
        async () => {
          await db.books.bulkPut(bundle.books);
          await db.progress.bulkPut(bundle.progress);
          await db.annotations.bulkPut(bundle.annotations);
          await db.readingSessions.bulkPut(bundle.sessions);
        },
      );
      onImported();
      scheduleSync();
    } catch (e) {
      const reason =
        e instanceof Error
          ? e.message
          : t({
              message: "the file is not in the right format",
              comment:
                "Slotted into the restore failure message below when the failure carried no reason of its own. Lower case, mid-sentence.",
            });
      setError(
        t({
          message: `Restore failed: ${{ reason }}`,
          comment:
            "Shown when a backup file could not be read back in. The value is why, and may be a message from deeper in the parser.",
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <Trans comment="Heading of the backup section in the account pane: one file out, the same file back in.">
          Backup
        </Trans>
      </h3>
      <div className="settings-actions">
        {/* Deliberately not "take my shelf with me": what comes out is a bundle only Tidemarks
            can read (ADR-0013), and a backup is what that actually is. */}
        <button
          className={busy === "export" ? "busy-edge" : undefined}
          onClick={() => void exportAll()}
          disabled={busy !== null}
          data-testid="export-backup"
        >
          <Trans comment="Button that writes every book, note and position on this device out to one file.">
            Export backup
          </Trans>
        </button>
        <button
          className={busy === "import" ? "busy-edge" : undefined}
          onClick={() => importInput.current?.click()}
          disabled={busy !== null}
        >
          <Trans comment="Button that reads a backup file back into this device. Deliberately not 'import' — that word belongs to adding an epub on the shelf.">
            Restore from backup
          </Trans>
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <input
        ref={importInput}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) void importAll(e.target.files[0]);
          e.target.value = "";
        }}
      />
    </section>
  );
}

/** The two keys: a passkey, and a code in the inbox. */
function SignIn() {
  const { t, i18n } = useLingui();
  const [userId, setUserId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // 'email' asks for the address, 'code' waits for what arrived in the inbox.
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  // Browsers without conditional mediation get a button instead; until the check comes back,
  // neither is shown, because a button that appears and then vanishes is worse than a late one.
  const [passkeyButton, setPasskeyButton] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncState>(getSyncState);
  // An agent's OAuth flow parked us here. Read once: the redirect below leaves the page, so
  // there is no later render where this could have changed.
  const [pendingAuthorize] = useState(() => authorizeReturnTarget(window.location.search) !== null);

  useEffect(() => subscribeSync(setSync), []);
  // How many books this device holds that the server does not, for the line under the status.
  const [onDevice, setOnDevice] = useState(0);
  useEffect(() => {
    const quota = sync.quota;
    if (quota === null) return;
    let live = true;
    void db.books
      .filter((b) => onlyOnThisDevice(quota, b))
      .count()
      .then((n) => {
        if (live) setOnDevice(n);
      });
    return () => {
      live = false;
    };
  }, [sync.quota]);
  useEffect(() => {
    me().then((res) => {
      setUserId(res?.userId ?? null);
      setChecked(true);
    });
  }, []);

  // An agent's OAuth flow sends a session-less browser here to log in. There is now a session,
  // so hand it back to `/authorize` — the reader came to approve a connection, not to read.
  useEffect(() => {
    if (!userId) return;
    const target = authorizeReturnTarget(window.location.search);
    if (target) window.location.replace(target);
  }, [userId]);

  // Offer any passkey from inside the email field. This ceremony sits open for as long as the
  // field is on screen and resolves only if the reader picks a passkey; a reader who types an
  // address instead never touches it, and the cleanup below closes it.
  useEffect(() => {
    if (!checked || userId || step !== "email") return;
    let done = false;
    void (async () => {
      if (!(await passkeyAutofillAvailable())) {
        if (!done) setPasskeyButton(true);
        return;
      }
      try {
        await loginWithPasskey({ autofill: true });
      } catch {
        // Cancelled, or the reader dismissed it. Either way the email field is still there.
        return;
      }
      if (done) return;
      const res = await me();
      setUserId(res?.userId ?? null);
      void syncNow();
    })();
    return () => {
      done = true;
      cancelPasskeyPrompt();
    };
  }, [checked, userId, step]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function finishLogin() {
    const res = await me();
    setUserId(res?.userId ?? null);
    void syncNow();
  }

  if (!checked) return null;

  if (userId) {
    return (
      <section className="settings-section" data-testid="signed-in">
        <h3 className="settings-section-title">
          <Trans comment="Heading of the section shown once the reader is signed in. It holds the sync status and the buttons for keys and signing out.">
            Sync
          </Trans>
        </h3>
        <p className="settings-note">
          {STATUS_LABEL[sync.status] === null ? null : i18n._(STATUS_LABEL[sync.status]!)}
          {sync.status === "error" && sync.error
            ? t({
                message: `: ${{ reason: sync.error }}`,
                comment:
                  "Appended to the sync status when the failure carried a reason. The value is the server's or the network's own message and is not translated. Only the punctuation in front of it is: Chinese uses the full-width colon 「：」.",
              })
            : ""}
        </p>
        {sync.quota !== null && (
          <p className="settings-note" data-testid="sync-quota">
            {sync.quota.limit === null ? (
              <Trans comment="Under the sync status, for an account with no book limit: every book on the device is synced.">
                Every book syncs.
              </Trans>
            ) : (
              <QuotaLine
                held={sync.quota.synced.length}
                limit={sync.quota.limit}
                onDevice={onDevice}
              />
            )}
          </p>
        )}
        <div className="settings-actions">
          <button
            className={sync.status === "syncing" ? "busy-edge" : undefined}
            onClick={() => void syncNow()}
            disabled={sync.status === "syncing"}
          >
            <Trans comment="Button that runs a sync round now, rather than waiting for the next one. Same word as the section heading above it, and the same entry.">
              Sync
            </Trans>
          </button>
          <button onClick={() => run(addPasskey)}>
            <Trans comment="Button that registers another passkey on this account — one per device, so this is how a second machine gets a key. 'passkey' is the platform's own term; keep it as the platform spells it in this language.">
              Add a passkey
            </Trans>
          </button>
          <button
            onClick={() =>
              run(async () => {
                await logout();
                setUserId(null);
                setEmail("");
                setCode("");
                setStep("email");
              })
            }
          >
            <Trans comment="Button that ends the session on this device. Books already on the device stay; only the account link goes.">
              Sign out
            </Trans>
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="settings-section" data-testid="sign-in">
      <h3 className="settings-section-title">
        <Trans comment="Heading of the sign-in section, shown when there is no account on this device yet.">
          Sign in
        </Trans>
      </h3>
      {/* Without this the reader arrives at their bookshelf with no idea why, having asked an
          agent to connect and been handed a library instead. The redirect that brought them
          here is invisible, so the page has to say it. */}
      {pendingAuthorize && (
        <p className="auth-pending">
          <Trans comment="Shown when the reader arrived here from an agent's authorisation flow rather than by choosing to sign in. It explains why they are looking at a login box, and that they will be sent back afterwards.">
            An app wants to connect to your shelf. You will come back here to confirm after signing
            in.
          </Trans>
        </p>
      )}
      {step === "email" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // The passkey offer belongs to this field; the reader has chosen the other door.
            cancelPasskeyPrompt();
            run(async () => {
              await requestMagicCode(email);
              setCode("");
              setStep("code");
            });
          }}
        >
          <input
            type="email"
            // `webauthn` is what lets the browser put a passkey in this field's autofill.
            autoComplete="username webauthn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
          />
          <div className="settings-actions">
            <button
              className={busy ? "primary busy-edge" : "primary"}
              type="submit"
              disabled={!email || busy}
            >
              <Trans comment="Button that asks the server to email a one-time sign-in code. It is the first of the two doors in — the other is a passkey.">
                Email me a code
              </Trans>
            </button>
            {passkeyButton && (
              <button
                type="button"
                onClick={() =>
                  run(async () => {
                    await loginWithPasskey();
                    await finishLogin();
                  })
                }
              >
                <Trans comment="Button that signs in with a passkey already on this device. 'passkey' is the platform's own term; keep it as the platform spells it in this language.">
                  Sign in with a passkey
                </Trans>
              </button>
            )}
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await verifyMagicCode(email, code);
              await finishLogin();
            });
          }}
        >
          <p className="settings-note">
            <Trans comment="Shown after the code has been sent, above the box it goes in. The value is the address the reader typed. Ten minutes is what the Worker actually enforces, so the number is not a rounding.">
              A code is on its way to {email}. It is good for 10 minutes.
            </Trans>
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t({
              message: "Sign-in code",
              comment: "Placeholder in the box the six-digit code from the email goes into.",
            })}
          />
          <div className="settings-actions">
            <button
              className={busy ? "primary busy-edge" : "primary"}
              type="submit"
              disabled={!code || busy}
            >
              <Trans comment="Button that submits the code from the email and finishes signing in.">
                Sign in
              </Trans>
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("email");
              }}
            >
              <Trans comment="Button beside the code box that goes back a step, for a reader who typed the wrong address.">
                Change email
              </Trans>
            </button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
