// member/config.local.ts
// Business-specific configuration for Alfredo's portfolio.

export const memberConfig = {
  businessName: "Alfredo Da Gonza's Portfolio",
  botName: "Alfredo AI",
  language: "en" as "es" | "en",
  tier: "pro" as "free" | "pro",
  timezone: "Asia/Jakarta",
  contactEmail: "dagonzaalfredo@gmail.com",
};

export type MemberConfig = typeof memberConfig;

// Business context consumed by src/businessContext.ts.
export const businessConfig = {
  hours: "Available for project inquiries and collaboration.",
  services: [] as { name: string; price: number }[],
  location: "Remote",
  paymentMethods: [] as string[],
  contactPhone: "",
  customFields: {
    focus: "Full-stack web development, backend systems, automation, and AI experiments.",
    education: "Studied at Universitas Bunda Mulia and now works professionally as a Full-stack Developer.",
    experience: "Alfredo currently works as a Full-stack Developer at Neural Technology. Previously, he worked as a Backend Developer at PT. Asianet Media Teknologi from September 2025 to December 2025.",
    stack: "Node.js, TypeScript, Golang, React, Next.js, Angular, Express, PostgreSQL, MySQL, Prisma, Kotlin, Firebase, Python, Streamlit, Puppeteer, Docker, AWS, and Redis.",
    projects: "Projects include Asianet Workforce Management System; Sunflex Store User Website; Sunflex Store Admin Dashboard; Travel Landing Page; Profile Landing Page; WhatsApp Bot Automation; Healthy Website Calculator; Instagram & Twitter Data Scraper; My Petz App; Canggihku App; and Meme Playground.",
    contact: "For collaboration or project inquiries, use the Contact section or email dagonzaalfredo@gmail.com.",
  } as Record<string, string>,
};

export type BusinessConfig = typeof businessConfig;

export const catalog: { name: string; price: number; description?: string; sku?: string }[] = [];
