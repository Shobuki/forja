export type ReplyLanguage = "en" | "id";

// Lightweight detection is intentional: this runs before the LLM and avoids
// spending an extra model call just to choose the reply language.
const INDONESIAN_WORDS = new Set([
  "aku",
  "anda",
  "apa",
  "aja",
  "atau",
  "bahasa",
  "belum",
  "bisa",
  "buat",
  "dengan",
  "dari",
  "dong",
  "ga",
  "gak",
  "gimana",
  "hai",
  "halo",
  "ini",
  "itu",
  "jangan",
  "jadi",
  "kalau",
  "kamu",
  "karena",
  "ke",
  "kok",
  "mau",
  "masih",
  "nggak",
  "pake",
  "pakai",
  "saya",
  "saja",
  "sudah",
  "tidak",
  "tolong",
  "untuk",
  "yang",
]);

const ENGLISH_WORDS = new Set([
  "about",
  "and",
  "are",
  "can",
  "could",
  "do",
  "for",
  "from",
  "hello",
  "help",
  "how",
  "is",
  "me",
  "please",
  "tell",
  "the",
  "this",
  "to",
  "want",
  "what",
  "when",
  "where",
  "which",
  "with",
  "you",
]);

export function detectReplyLanguage(text: string): ReplyLanguage {
  const words = text.toLocaleLowerCase().match(/[a-z]+/g) ?? [];
  let indonesianScore = 0;
  let englishScore = 0;

  for (const word of words) {
    if (INDONESIAN_WORDS.has(word)) indonesianScore += 1;
    if (ENGLISH_WORDS.has(word)) englishScore += 1;
  }

  return indonesianScore > englishScore ? "id" : "en";
}

export function replyLanguageInstruction(language: ReplyLanguage): string {
  if (language === "id") {
    return `<response_language>
The visitor's latest message is primarily Indonesian. Reply entirely in Indonesian. Do not reply in English or Spanish unless the visitor explicitly asks for a translation. Keep proper names, product names, code, URLs, and technical terms unchanged.
</response_language>`;
  }

  return `<response_language>
The visitor's latest message is primarily English. Reply entirely in English. Do not reply in Indonesian or Spanish unless the visitor explicitly asks for a translation. Keep proper names, product names, code, URLs, and technical terms unchanged.
</response_language>`;
}
