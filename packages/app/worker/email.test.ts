import { describe, expect, it, vi } from "vitest";
import { magicCodeMail, loginNoticeMail, sendMail } from "./email";
import { i18nOf } from "./i18n";

const i18n = i18nOf("en");

describe("magicCodeMail", () => {
  it("puts the code where a reader can copy it", () => {
    expect(magicCodeMail(i18n, "048213").text).toContain("048213");
  });

  it("says that nobody will ever ask for the code", () => {
    // The code is not tied to the browser that asked for it, so a caller who talks somebody
    // into reading six digits aloud is in. This sentence is the whole defence, which is why
    // it is asserted rather than trusted to survive the next edit of the wording.
    expect(magicCodeMail(i18n, "048213").text).toContain(
      "Nobody at Tidemarks will ever ask you for this code",
    );
  });
});

describe("loginNoticeMail", () => {
  it("tells the reader a code was just used, and what to do about it", () => {
    // The only way somebody finds out their inbox was read by the wrong person.
    const mail = loginNoticeMail(i18n);
    expect(mail.subject).toContain("signed in");
    expect(mail.text).toContain("change that password");
  });
});

describe("sendMail without a provider", () => {
  it("writes the letter to the log instead of dropping it", async () => {
    // The self-hosting path and the manual test path are the same path: no key, no vendor,
    // the code comes out of `wrangler tail`. Everything else about the flow is identical.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await sendMail({}, "reader@example.com", magicCodeMail(i18n, "048213"));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(log.mock.calls.flat().join(" ")).toContain("048213");
    } finally {
      log.mockRestore();
      fetchSpy.mockRestore();
    }
  });
});

describe("sendMail with Resend configured", () => {
  it("hands the letter to the API", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    try {
      await sendMail(
        { RESEND_API_KEY: "key-test", MAIL_FROM: "Tidemarks <login@tidemarks.test>" },
        "reader@example.com",
        { subject: "hi", text: "body" },
      );
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer key-test");
      expect(JSON.parse(init.body as string)).toEqual({
        from: "Tidemarks <login@tidemarks.test>",
        to: "reader@example.com",
        subject: "hi",
        text: "body",
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("throws when the API refuses, so the caller does not promise a letter that never left", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("domain not verified", { status: 403 }));
    try {
      await expect(
        sendMail(
          { RESEND_API_KEY: "key-test", MAIL_FROM: "Tidemarks <login@tidemarks.test>" },
          "r@e.com",
          {
            subject: "hi",
            text: "body",
          },
        ),
      ).rejects.toThrow(/403/);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("the letters follow the reader's language", () => {
  // The request that triggers a letter carries the interface language (`worker/i18n.ts`), so a
  // reader who set Tidemarks to Japanese is not sent English mail about a Japanese app.
  it("writes the sign-in code in the language the request asked for", () => {
    expect(magicCodeMail(i18nOf("ja"), "048213").subject).toContain("サインインコード");
    expect(magicCodeMail(i18nOf("zh-TW"), "048213").subject).toContain("登入碼");
  });
});
