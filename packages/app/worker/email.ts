// The one outbound vendor Tidemarks has, and the way to run without it.
//
// Resend is a single `fetch`: no second schema, no second thing to deploy. When no API key is
// configured the letter goes to the log instead of to an inbox — same flow, same tables, only
// the last step changes. That is what keeps a self-hosted Tidemarks free of vendors, and it is
// also how login gets tested by hand with no mailbox in the loop.
//
// See docs/adr/0015-an-account-is-only-as-strong-as-its-inbox.md.
//
// The message bodies are in Chinese because they are product copy, not prose about the code.

import { CODE_TTL_MS } from "./magic-code";

export interface MailerEnv {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}

export interface Mail {
  subject: string;
  text: string;
}

export function magicCodeMail(code: string): Mail {
  const minutes = Math.round(CODE_TTL_MS / 60_000);
  return {
    subject: `Tidemarks 登入碼：${code}`,
    text: [
      `登入碼：${code}`,
      "",
      `${minutes} 分鐘內有效，只能用一次。`,
      "",
      "Tidemarks 不會有任何人跟你要這串碼。有人這樣要求，那個人不是我們。",
      "不是你要登入的話，把這封信丟掉就好，沒有人進得去。",
    ].join("\n"),
  };
}

export function loginNoticeMail(): Mail {
  return {
    subject: "Tidemarks：剛才有人用登入碼登入",
    text: [
      "剛才有人用登入碼登入了你的 Tidemarks 帳號。",
      "",
      "是你的話，這封信不用理會。",
      "不是你的話，你的信箱可能被別人讀得到——先去把信箱的密碼換掉，那是帳號真正的鑰匙。",
    ].join("\n"),
  };
}

export async function sendMail(env: MailerEnv, to: string, mail: Mail): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // Visible in `wrangler tail`. The whole letter, not just the code, so what is read here is
    // what would have been read in an inbox.
    console.log(`[mail] no RESEND_API_KEY; not sending to ${to}\n${mail.subject}\n${mail.text}`);
    return;
  }
  if (!env.MAIL_FROM) {
    // Falling back to the log here would put magic codes in the log of a deployment that
    // believes it is sending mail. Refusing is the loud failure.
    throw new Error("RESEND_API_KEY is set but MAIL_FROM is not");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject: mail.subject, text: mail.text }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`resend refused the message: ${response.status} ${detail}`.trim());
  }
}
