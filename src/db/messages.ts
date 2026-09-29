import { Db } from "./client";

export type MessageRole = "user" | "assistant" | "tool" | "owner";

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  owner_visible: number;
  tool_calls: string | null;
  model_used: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  audio_seconds: number | null;
  image_count: number | null;
  created_at: number;
}

export interface AppendOptions {
  toolCalls?: unknown[];
  modelUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  audioSeconds?: number;
  imageCount?: number;
  ownerVisible?: boolean;
  createdAt?: number;
}

export class MessagesRepo {
  constructor(private readonly db: Db) {}

  async append(
    conversationId: string,
    role: MessageRole,
    content: string,
    opts: AppendOptions = {},
  ): Promise<string> {
    const id = crypto.randomUUID();
    const createdAt = opts.createdAt ?? Date.now();
    await this.db.run(
      `INSERT INTO messages (
        id, conversation_id, role, content, owner_visible, tool_calls, model_used,
        input_tokens, output_tokens, cached_input_tokens,
        audio_seconds, image_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        conversationId,
        role,
        content,
        opts.ownerVisible ? 1 : 0,
        opts.toolCalls ? JSON.stringify(opts.toolCalls) : null,
        opts.modelUsed ?? null,
        opts.inputTokens ?? null,
        opts.outputTokens ?? null,
        opts.cachedInputTokens ?? null,
        opts.audioSeconds ?? null,
        opts.imageCount ?? null,
        createdAt,
      ],
    );
    return id;
  }

  async publicOwnerMessagesSince(
    conversationId: string,
    after: number,
    limit = 50,
  ): Promise<Array<{ id: string; role: "owner"; content: string; created_at: number }>> {
    return this.db.all(
      `SELECT id, role, content, created_at
       FROM messages
       WHERE conversation_id = ? AND role = 'owner' AND owner_visible = 1 AND created_at >= ?
       ORDER BY created_at ASC
       LIMIT ?`,
      [conversationId, Math.max(0, Math.floor(after)), Math.min(Math.max(1, Math.floor(limit)), 100)],
    );
  }

  async publicHistory(
    conversationId: string,
    limit = 100,
  ): Promise<Array<{ id: string; role: "user" | "assistant" | "owner"; content: string; created_at: number }>> {
    return this.db.all(
      `SELECT id, role, content, created_at
       FROM messages
       WHERE conversation_id = ?
         AND (role IN ('user', 'assistant') OR (role = 'owner' AND owner_visible = 1))
         AND NOT (
           role = 'assistant' AND content IN (
             'Something went wrong on my side. Please try again in a moment.',
             'Chat is temporarily paused. Please try again later.'
           )
         )
       ORDER BY created_at ASC
       LIMIT ?`,
      [conversationId, Math.min(Math.max(1, Math.floor(limit)), 200)],
    );
  }

  async lastN(conversationId: string, n: number): Promise<Message[]> {
    const rows = await this.db.all<Message>(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC
         LIMIT ?
       ) ORDER BY created_at ASC`,
      [conversationId, n],
    );
    return rows;
  }

  async purgeOlderThan(cutoffMs: number): Promise<number> {
    const res = await this.db.run(
      "DELETE FROM messages WHERE created_at < ?",
      [cutoffMs],
    );
    return res.meta.changes ?? 0;
  }
}
