/**
 * Insights analyzer — the "Analista" layer of the dashboard.
 *
 * Once a conversation goes idle (no messages for IDLE_MS), a cheap "fast"-tier
 * model (Haiku by default) grades it against a fixed rubric and the result is
 * stored in `conversation_insights` (one row per conversation, re-analyzed if
 * the customer comes back). Cost ≈ $0.0006 per conversation on Haiku.
 *
 * Triggered from the admin dashboard (button + opportunistic waitUntil on the
 * Insights tab). TODO: also wire into `scheduled()` in src/index.ts for a
 * nightly run — deferred while that file is being reworked on another branch
 * of work (channels/meta).
 */
import { generateText } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { InsightsRepo, type UpsertInsightInput } from "../db/insights";
import { CustomerFactsRepo } from "../db/facts";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";

/** A conversation counts as "closed" after this much silence. */
export const IDLE_MS = 3 * 60 * 60 * 1000; // 3h

/** Max messages fed to the grader (ascending order, each truncated). */
const TRANSCRIPT_MESSAGES = 40;
const MAX_MSG_CHARS = 500;

const insightSchema = z.object({
  sentiment: z.enum(["positive", "neutral", "frustrated", "angry"]),
  resolution: z.enum(["resolved", "unresolved", "escalated", "abandoned"]),
  bot_score: z.number().int().min(1).max(5),
  topics: z.array(z.string()).max(6).default([]),
  summary: z.string().max(600),
  missed_kb: z.string().nullable().default(null),
  sale_opportunity: z.boolean().default(false),
  customer_facts: z.array(z.string()).max(8).default([]),
});

export interface AnalyzeOptions {
  /** Max conversations to grade in this run (cost guard). */
  limit?: number;
  /** Injectable clock for tests. */
  now?: number;
}

export interface AnalyzeResult {
  analyzed: number;
  errors: number;
  pending: number;
}

interface PendingConv {
  id: string;
  open_tickets: number;
}

/** Conversations that are idle, have a real exchange, and lack a fresh insight. */
async function pickPending(db: Db, now: number, limit: number): Promise<PendingConv[]> {
  return db.all<PendingConv>(
    `SELECT c.id,
       (SELECT COUNT(*) FROM tickets t
         WHERE t.conversation_id = c.id AND t.status != 'resolved') as open_tickets
     FROM conversations c
     LEFT JOIN conversation_insights i ON i.conversation_id = c.id
     WHERE c.last_message_at < ?
       AND (i.conversation_id IS NULL OR i.analyzed_at < c.last_message_at)
       AND (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) >= 2
     ORDER BY c.last_message_at DESC
     LIMIT ?`,
    [now - IDLE_MS, limit],
  );
}

/** How many idle conversations are still waiting for analysis (for the UI). */
export async function countPending(env: Env, now = Date.now()): Promise<number> {
  const db = new Db(env.DB);
  const row = await db.first<{ n: number }>(
    `SELECT COUNT(*) as n
     FROM conversations c
     LEFT JOIN conversation_insights i ON i.conversation_id = c.id
     WHERE c.last_message_at < ?
       AND (i.conversation_id IS NULL OR i.analyzed_at < c.last_message_at)
       AND (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) >= 2`,
    [now - IDLE_MS],
  );
  return row?.n ?? 0;
}

const ROLE_LABEL: Record<string, string> = {
  user: "Customer",
  assistant: "Bot",
  owner: "Owner",
  tool: "Tool",
};

function buildTranscript(msgs: { role: string; content: string }[]): string {
  return msgs
    .map((m) => {
      const text =
        m.content.length > MAX_MSG_CHARS
          ? `${m.content.slice(0, MAX_MSG_CHARS)}…`
          : m.content;
      return `${ROLE_LABEL[m.role] ?? m.role}: ${text}`;
    })
    .join("\n");
}

function gradingPrompt(env: Env, transcript: string, hasOpenTicket: boolean): string {
  return `You are a quality auditor for the customer-support chatbot of ${env.BUSINESS_NAME}.
Analyze the complete conversation and respond ONLY with a valid JSON object, without markdown or explanation:

{
  "sentiment": "positive" | "neutral" | "frustrated" | "angry",
  "resolution": "resolved" | "unresolved" | "escalated" | "abandoned",
  "bot_score": 1-5,
  "topics": ["tema1", "tema2"],
  "summary": "...",
  "missed_kb": "..." | null,
  "sale_opportunity": true | false,
  "customer_facts": ["hecho1", "hecho2"]
}

Criteria:
- sentiment: the customer's emotion at the end of the conversation.
- resolution: use "escalated" if a human intervened or a ticket was created; use "abandoned" if the customer stopped replying without a clear resolution.
- bot_score: quality of the bot's replies (accuracy, tone, brevity, and no fabrication).
- topics: 1 to 4 short lowercase topics in English.
- summary: 1–2 short English sentences explaining what the customer wanted and how it ended.
- missed_kb: if the bot could not answer a concrete business question, copy the customer's question; otherwise null.
- sale_opportunity: true ONLY when the customer showed real intent to buy or hire a paid offering and it remained open. Do not count free events, greetings, informational questions, or vague interest.
- customer_facts: 0 to 5 short useful facts about the customer (name, preferences, purchases, frustrations). Never include sensitive data such as cards, passwords, or exact addresses. Use an empty list when nothing is memorable.

Open ticket: ${hasOpenTicket ? "YES" : "NO"}.

Conversation:
${transcript}`;
}

/** Extract the first JSON object from LLM output (tolerates code fences). */
export function parseInsightJson(raw: string): z.infer<typeof insightSchema> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const result = insightSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Grade pending conversations. Safe to call concurrently/repeatedly: upserts
 * by conversation_id and the batch `limit` caps cost per run.
 */
export async function analyzeConversations(
  env: Env,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 10;
  const db = new Db(env.DB);
  const msgs = new MessagesRepo(db);
  const insights = new InsightsRepo(db);

  const pending = await pickPending(db, now, limit);
  let analyzed = 0;
  let errors = 0;

  const { model } = createModel(env, "fast", await loadLlmOverrides(env));

  for (const conv of pending) {
    try {
      const history = await msgs.lastN(conv.id, TRANSCRIPT_MESSAGES);
      const transcript = buildTranscript(history);
      if (!transcript.trim()) continue;

      const result = await generateText({
        model,
        prompt: gradingPrompt(env, transcript, conv.open_tickets > 0),
      });

      const insight = parseInsightJson(result.text);
      if (!insight) {
        errors++;
        console.error(`[insights] unparseable grader output for ${conv.id}`);
        continue;
      }

      const input: UpsertInsightInput = {
        conversationId: conv.id,
        analyzedAt: now,
        sentiment: insight.sentiment,
        resolution: insight.resolution,
        botScore: insight.bot_score,
        topics: insight.topics,
        summary: insight.summary,
        missedKb: insight.missed_kb,
        saleOpportunity: insight.sale_opportunity,
      };
      await insights.upsert(input);
      if (insight.customer_facts.length > 0) {
        await new CustomerFactsRepo(db).addMany(conv.id, insight.customer_facts);
      }
      analyzed++;
    } catch (e) {
      errors++;
      console.error(`[insights] failed to analyze ${conv.id}:`, e);
    }
  }

  const remaining = await countPending(env, now);
  return { analyzed, errors, pending: remaining };
}
