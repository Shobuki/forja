import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";

// Guardrail de abuso decidido por el LLM: complementa al filtro determinístico
// de mensajes repetidos (src/spam.ts). Aquí caen los casos que requieren
// criterio — insultos, spam que varía el texto, otro bot del otro lado.
export function snoozeUserTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Put this conversation into a cooldown: the bot will ignore all messages for the requested minutes (default 60). Use it for insults, abusive behavior, repeated meaningless spam, another automated bot, or treating the bot as a free ChatGPT with unrelated questions. Before using it, send ONE final brief and kind reply; for ChatGPT-style use, invite the person to the AI community and use about 120 minutes. After calling it, say nothing else.",
    inputSchema: z.object({
      minutes: z.number().int().min(15).max(1440).default(60),
      reason: z
        .string()
        .describe("Motivo corto: insultos | spam | bot | uso_chatgpt | otro (con 2-3 palabras de contexto)"),
    }),
    execute: async ({ minutes, reason }) => {
      const convId = getConversationId();
      if (!convId) return { error: "no_conversation" as const };
      const convs = new ConversationsRepo(new Db(env.DB));
      const until = Date.now() + minutes * 60_000;
      await convs.setPausedUntil(convId, until);
      console.warn(`[snoozeUser] conv ${convId} en cooldown ${minutes}min — ${reason}`);
      return { snoozedUntil: until, minutes, reason };
    },
  });
}
