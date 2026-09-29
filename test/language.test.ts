import { describe, expect, it } from "vitest";
import { detectReplyLanguage, replyLanguageInstruction } from "../src/language";

describe("reply language detection", () => {
  it("detects Indonesian", () => {
    expect(detectReplyLanguage("bisa bantu saya dengan portfolio ini?"))
      .toBe("id");
  });

  it("detects English", () => {
    expect(detectReplyLanguage("Can you tell me about your projects?"))
      .toBe("en");
  });

  it("defaults short ambiguous greetings to English", () => {
    expect(detectReplyLanguage("hi")).toBe("en");
  });

  it("builds an explicit instruction", () => {
    expect(replyLanguageInstruction("id")).toContain("entirely in Indonesian");
    expect(replyLanguageInstruction("en")).toContain("entirely in English");
  });
});
