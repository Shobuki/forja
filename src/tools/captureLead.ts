import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";

export function captureLeadTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Capture an interested lead so the owner can follow up later. Save it in D1 and optionally export it to Google Sheets, Notion, or Airtable.",
    inputSchema: z.object({
      name: z.string().optional().describe("Customer name"),
      contact: z.string().optional().describe("Phone or email"),
      intent: z.string().describe("What the customer wants, in 1–2 sentences"),
      notes: z.string().optional(),
    }),
    execute: async ({ name, contact, intent, notes }) => {
      const convId = getConversationId();
      const leads = new LeadsRepo(new Db(env.DB));
      const leadId = await leads.create({
        conversationId: convId,
        name,
        contact,
        channelUserId: null,
        intent,
        notes,
      });

      // Optional external export — Pro-tier feature, skipped if no creds
      // (Implementation deferred to Task 7.4 — adds Google Sheets export)

      return { leadId, message: "Lead captured." };
    },
  });
}
