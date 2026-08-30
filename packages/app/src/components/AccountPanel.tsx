import { Trans, useLingui } from "@lingui/react/macro";
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
import { getSyncState, scheduleSync, subscribeSync, syncNow, type SyncState } from "../lib/sync";

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
            <Trans comment="Heading of the paid half of the price list.">Paid</Trans>
          </dt>
          <dd>
            <Trans comment="What the paid half covers. Both are things that need a server, which is the whole reason they cost anything.">
              Syncing between devices, and letting an agent read your books.
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

/**
 * The bill.
 *
 * **The number is a placeholder.** Pricing is not decided and no payment goes through in this
 * round, so this says what it costs to be told, not a button that pretends to charge.
 */
function Billing() {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <Trans comment="Heading of the billing section in the account pane.">Billing</Trans>
      </h3>
      <dl className="price-lines">
        <dt>
          <Trans comment="What the monthly price is for: the two things that need a server.">
            Sync and agents
          </Trans>
        </dt>
        <dd>
          <Trans comment="The monthly price. The figure is a placeholder and nothing charges yet, which the note below says outright.">
            US$3 a month (provisional)
          </Trans>
        </dd>
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
      <p className="settings-note">
        <Trans comment="Note under the billing section. It says outright that the section describes an intention, not a working checkout.">
          You cannot subscribe yet, and the price is not settled.
        </Trans>
      </p>
      <p className="settings-note">
        <Trans comment="Note under the billing section, pointing at the way out of paying: the syncing half is open source and can be run by the reader.">
          Would rather not pay, but want two devices? The syncing half can be self-hosted.
        </Trans>
      </p>
    </section>
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
