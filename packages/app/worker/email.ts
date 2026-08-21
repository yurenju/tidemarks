// The one outbound vendor Tidemarks has, and the way to run without it.
//
// Resend is a single `fetch`: no second schema, no second thing to deploy. When no API key is
// configured the letter goes to the log instead of to an inbox — same flow, same tables, only
// the last step changes. That is what keeps a self-hosted Tidemarks free of vendors, and it is
// also how login gets tested by hand with no mailbox in the loop.
//
// See docs/adr/0015-an-account-is-only-as-strong-as-its-inbox.md.
//
// The letters go out in the reader's own interface language, which the request that triggered
// them carried (`worker/i18n.ts`). Their messages are written by hand with explicit ids rather
// than with the macros the app uses — that file has why.

import type { I18n } from "@lingui/core";
import { CODE_TTL_MS } from "./magic-code";

export interface MailerEnv {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}

export interface Mail {
  subject: string;
  text: string;
}

export function magicCodeMail(i18n: I18n, code: string): Mail {
  const minutes = Math.round(CODE_TTL_MS / 60_000);
  return {
    subject: i18n._({
      id: "email.magicCode.subject",
      message: "Tidemarks sign-in code: {code}",
      comment:
        "Subject line of the letter carrying a one-time sign-in code. The product name stays as it is; the value is six digits.",
      values: { code },
    }),
    text: [
      i18n._({
        id: "email.magicCode.code",
        message: "Sign-in code: {code}",
        comment: "First line of the sign-in letter. The value is six digits.",
        values: { code },
      }),
      "",
      i18n._({
        id: "email.magicCode.validity",
        message: "Good for {minutes} minutes, and once only.",
        comment:
          "How long the code lasts. The value comes from what the Worker actually enforces, so it is not a rounded promise.",
        values: { minutes },
      }),
      "",
      i18n._({
        id: "email.magicCode.warning",
        message:
          "Nobody at Tidemarks will ever ask you for this code. If someone does, that someone is not us.",
        comment:
          "The anti-phishing line in the sign-in letter. Keep it blunt — its whole job is to be remembered by a reader who is being talked to by an attacker.",
      }),
      i18n._({
        id: "email.magicCode.notYou",
        message: "If you were not signing in, throw this away. Nobody gets in without it.",
        comment:
          "Closing line of the sign-in letter, for someone who did not ask for it. It says the code alone is the key, so ignoring the letter is enough.",
      }),
    ].join("\n"),
  };
}

export function loginNoticeMail(i18n: I18n): Mail {
  return {
    subject: i18n._({
      id: "email.loginNotice.subject",
      message: "Tidemarks: someone signed in with a code",
      comment:
        "Subject of the letter sent after a successful code sign-in. The product name stays as it is.",
    }),
    text: [
      i18n._({
        id: "email.loginNotice.body",
        message: "Someone just signed in to your Tidemarks account with a code.",
        comment: "First line of the after-the-fact sign-in notice.",
      }),
      "",
      i18n._({
        id: "email.loginNotice.wasYou",
        message: "If that was you, there is nothing to do.",
        comment: "The reassuring half of the sign-in notice.",
      }),
      i18n._({
        id: "email.loginNotice.wasNotYou",
        message:
          "If it was not, someone can read your inbox — change that password first. It is the real key to this account.",
        comment:
          "The half that matters: an account secured by email is only as strong as the inbox (ADR-0015). The advice is deliberately about the mailbox, not about Tidemarks.",
      }),
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
