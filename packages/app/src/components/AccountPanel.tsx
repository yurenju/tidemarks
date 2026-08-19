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

const STATUS_LABEL: Record<SyncState["status"], string> = {
  idle: "",
  syncing: "同步中…",
  synced: "已同步",
  offline: "離線",
  unauthenticated: "未登入",
  error: "同步失敗",
};

/**
 * 〈帳號〉: the half of Folis that runs on someone else's machine, and whether the reader
 * wants it.
 *
 * The line it draws is the product's: **a book runs in the browser, so reading costs nothing;
 * syncing and MCP burn a server, so that half is paid.** The invitation to pay lives here and
 * nowhere else — a login box on the shelf would ask every reader to answer a question most of
 * them never need to.
 *
 * It is a **pane of 〈設定〉**, not a surface of its own: it brings no shell, no title and no
 * close button, because the screen around it already has all three.
 */
export default function AccountPanel({ onImported }: { onImported: () => void }) {
  return (
    <>
      <section className="settings-section">
        <p className="settings-lede">
          讀書不必註冊。書、筆記、閱讀位置，一個位元組都不離開這台裝置。
        </p>
        <dl className="price-lines">
          <dt>永遠免費</dt>
          <dd>匯入、閱讀、劃重點、寫筆記、排版、匯出，都在你的瀏覽器裡跑。</dd>
          <dt>要付錢</dt>
          <dd>兩台裝置之間同步、讓 agent 讀得到你的書。</dd>
        </dl>
      </section>

      <Billing />
      <SignIn />
      {/* 〈連上的 agent〉 goes here, between the keys and the backup: it is a thing you revoke,
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
      <h3 className="settings-section-title">帳單</h3>
      <dl className="price-lines">
        <dt>同步與 agent</dt>
        <dd>每月 US$3（暫定）</dd>
        <dt>停掉之後</dt>
        <dd>伺服器上那一份留 24 個月。這台裝置上的書、筆記、位置不受影響。</dd>
      </dl>
      <p className="settings-note">還不能訂閱，價格也還沒定。</p>
      <p className="settings-note">不想付、又想要兩台裝置？同步這半邊可以自己架。</p>
    </section>
  );
}

/** 匯出備份 and 從備份接回來 — one file, both directions. */
function Backup({ onImported }: { onImported: () => void }) {
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
      downloadBlob(new Blob([json], { type: "application/json" }), "folis-export.json");
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
      setError(`匯入失敗：${e instanceof Error ? e.message : "格式錯誤"}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">備份</h3>
      <div className="settings-actions">
        {/* Deliberately not 帶走我的書櫃: what comes out is a bundle only Folis can read
            (ADR-0013), and 備份 is what that actually is. */}
        <button
          className={busy === "export" ? "busy-edge" : undefined}
          onClick={() => void exportAll()}
          disabled={busy !== null}
          data-testid="export-backup"
        >
          匯出備份
        </button>
        <button
          className={busy === "import" ? "busy-edge" : undefined}
          onClick={() => importInput.current?.click()}
          disabled={busy !== null}
        >
          從備份接回來
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
        <h3 className="settings-section-title">同步</h3>
        <p className="settings-note">
          {STATUS_LABEL[sync.status]}
          {sync.status === "error" && sync.error ? `：${sync.error}` : ""}
        </p>
        <div className="settings-actions">
          <button
            className={sync.status === "syncing" ? "busy-edge" : undefined}
            onClick={() => void syncNow()}
            disabled={sync.status === "syncing"}
          >
            同步
          </button>
          <button onClick={() => run(addPasskey)}>新增 passkey</button>
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
            登出
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="settings-section" data-testid="sign-in">
      <h3 className="settings-section-title">登入</h3>
      {/* Without this the reader arrives at their bookshelf with no idea why, having asked an
          agent to connect and been handed a library instead. The redirect that brought them
          here is invisible, so the page has to say it. */}
      {pendingAuthorize && (
        <p className="auth-pending">有一個應用程式要連上你的書架。登入之後會回去讓你確認。</p>
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
              寄登入碼給我
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
                用 passkey 登入
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
          <p className="settings-note">登入碼寄到 {email} 了，10 分鐘內有效。</p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="登入碼"
          />
          <div className="settings-actions">
            <button
              className={busy ? "primary busy-edge" : "primary"}
              type="submit"
              disabled={!code || busy}
            >
              登入
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("email");
              }}
            >
              改 email
            </button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
