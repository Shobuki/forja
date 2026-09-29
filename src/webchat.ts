import type { ReplyLanguage } from "./language";

// Llama 3.2 1B can occasionally emit a generic safety refusal for harmless
// portfolio questions. Do not feed those replies back into the next turn.
const BAD_ASSISTANT_REPLY =
  /(tidak bisa membantu|tidak dapat membantu|tidak bisa menjawab|cannot help|can't help|unable to help|can't assist|cannot assist|temporarily unavailable|temporalmente no puedo|no puedo ayudar)/i;

export function isBadWebsiteAssistantReply(text: string): boolean {
  return BAD_ASSISTANT_REPLY.test(text.trim());
}

function isGreeting(text: string): boolean {
  return /^(hi+|hai+|halo+|hello+|hey+|hola+)(?:\s+[a-z]+)?[!?.,\s]*$/i.test(
    text.trim(),
  );
}

function asksAbout(text: string, pattern: RegExp): boolean {
  return pattern.test(text.toLocaleLowerCase());
}

/**
 * A small deterministic safety net for public portfolio FAQs. It is only used
 * after the model returns a refusal/error-like response, so normal answers
 * remain model-generated.
 */
export function portfolioFallbackReply(
  input: string,
  language: ReplyLanguage,
): string {
  const text = input.trim();

  if (isGreeting(text)) {
    return language === "id"
      ? "Hai! Saya Alfredo AI. Kamu bisa bertanya tentang project, pengalaman kerja, skill, atau cara menghubungi Alfredo."
      : "Hi! I’m Alfredo AI. You can ask about Alfredo’s projects, work experience, skills, or contact details.";
  }

  if (
    asksAbout(text, /\b(project|projects|proyek|proyeknya|karya|portfolio|portofolio|work)\b/)
  ) {
    return language === "id"
      ? "Beberapa project Alfredo adalah:\n1. Asianet Workforce Management System — platform workforce untuk work order, tim, site, analytics, export, dan microservices.\n2. Sunflex Store — website toko dan admin dashboard dengan alur approval transaksi.\n3. WhatsApp Bot Automation — eksperimen otomasi WhatsApp dan AI.\n4. Healthy Website Calculator — eksperimen Python, Streamlit, KNN, dan model lokal.\n5. Instagram & Twitter Data Scraper — workflow scraping data publik dengan Node.js dan Puppeteer.\n6. My Petz dan Canggihku — aplikasi Android berbasis Kotlin dan Firebase.\nAda juga Travel Landing Page, Profile Landing Page, dan Meme Playground."
      : "Some of Alfredo’s projects are:\n1. Asianet Workforce Management System — a workforce platform for work orders, teams, sites, analytics, exports, and microservices.\n2. Sunflex Store — a storefront and admin dashboard with transaction approval workflows.\n3. WhatsApp Bot Automation — a WhatsApp automation and AI experiment.\n4. Healthy Website Calculator — a Python, Streamlit, KNN, and local-model experiment.\n5. Instagram & Twitter Data Scraper — a public-data scraping workflow using Node.js and Puppeteer.\n6. My Petz and Canggihku — Android apps built with Kotlin and Firebase.\nThere are also the Travel Landing Page, Profile Landing Page, and Meme Playground.";
  }

  if (asksAbout(text, /\b(skill|skills|keahlian|tech stack|technology|teknologi)\b/)) {
    return language === "id"
      ? "Skill utama Alfredo mencakup Node.js, TypeScript, Golang, React, Next.js, Angular, Express, PostgreSQL, MySQL, Prisma, Kotlin, Firebase, Python, Streamlit, Puppeteer, Docker, AWS, dan Redis."
      : "Alfredo’s main skills include Node.js, TypeScript, Golang, React, Next.js, Angular, Express, PostgreSQL, MySQL, Prisma, Kotlin, Firebase, Python, Streamlit, Puppeteer, Docker, AWS, and Redis.";
  }

  if (
    asksAbout(text, /\b(experience|pengalaman|kerja|pekerjaan|job|company|perusahaan)\b/)
  ) {
    return language === "id"
      ? "Alfredo saat ini bekerja sebagai Full-stack Developer di Neural Technology. Sebelumnya, Alfredo bekerja sebagai Backend Developer di PT. Asianet Media Teknologi dari September sampai Desember 2025, mengerjakan API Golang, MySQL, microservices, Docker, dan infrastruktur AWS."
      : "Alfredo currently works as a Full-stack Developer at Neural Technology. Previously, he worked as a Backend Developer at PT. Asianet Media Teknologi from September to December 2025, focusing on Golang APIs, MySQL, microservices, Docker, and AWS infrastructure.";
  }

  if (asksAbout(text, /\b(contact|kontak|email|hire|kerja sama|collaborat)\b/)) {
    return language === "id"
      ? "Untuk kerja sama atau pertanyaan project, gunakan bagian Contact di portfolio Alfredo atau email dagonzaalfredo@gmail.com."
      : "For collaboration or project inquiries, use the Contact section on Alfredo’s portfolio or email dagonzaalfredo@gmail.com.";
  }

  return language === "id"
    ? "Saya bisa membantu menjelaskan project, skill, pengalaman kerja, atau informasi kontak Alfredo."
    : "I can help explain Alfredo’s projects, skills, work experience, or contact details.";
}
