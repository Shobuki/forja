import { Db } from "./client";

export interface Conversation {
  id: string;
  channel: string;
  channel_user_id: string;
  display_name: string | null;
  started_at: number;
  last_message_at: number;
  paused_until: number | null;
  open_ticket_id: string | null;
  metadata: string | null;
}

function makeConvId(channel: string, channelUserId: string): string {
  return `${channel}:${channelUserId}`;
}

export class ConversationsRepo {
  constructor(private readonly db: Db) {}

  /** Permanently remove website conversations and their conversation-scoped records. */
  async deleteWebsiteChats(): Promise<{ conversations: number; messages: number }> {
    const conversations =
      (await this.db.first<{ n: number }>(
        "SELECT COUNT(*) AS n FROM conversations WHERE channel = 'web'",
      ))?.n ?? 0;
    const messages =
      (await this.db.first<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages
         WHERE conversation_id IN (SELECT id FROM conversations WHERE channel = 'web')`,
      ))?.n ?? 0;

    const webIds = "SELECT id FROM conversations WHERE channel = 'web'";
    await this.db.d1.batch([
      // Preserve lead/ticket records while removing their conversation link.
      this.db.d1.prepare(`UPDATE leads SET conversation_id = NULL WHERE conversation_id IN (${webIds})`),
      this.db.d1.prepare(`UPDATE tickets SET conversation_id = NULL WHERE conversation_id IN (${webIds})`),
      this.db.d1.prepare(`DELETE FROM followup_sends WHERE conversation_id IN (${webIds})`),
      this.db.d1.prepare(`DELETE FROM customer_facts WHERE conversation_id IN (${webIds})`),
      this.db.d1.prepare(`DELETE FROM tracked_links WHERE conversation_id IN (${webIds})`),
      this.db.d1.prepare(`DELETE FROM keyword_hits WHERE conversation_id IN (${webIds})`),
      this.db.d1.prepare(`DELETE FROM conv_labels WHERE conversation_id IN (${webIds})`),
      this.db.d1.prepare(`DELETE FROM template_sends WHERE conversation_id IN (${webIds})`),
      this.db.d1.prepare(`DELETE FROM conversation_insights WHERE conversation_id IN (${webIds})`),
      this.db.d1.prepare(`DELETE FROM messages WHERE conversation_id IN (${webIds})`),
      this.db.d1.prepare("DELETE FROM conversations WHERE channel = 'web'"),
    ]);

    return { conversations, messages };
  }

  async getOrCreate(
    channel: string,
    channelUserId: string,
    displayName?: string,
  ): Promise<Conversation> {
    const id = makeConvId(channel, channelUserId);
    const existing = await this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE id = ?",
      [id],
    );
    if (existing) {
      // Website visitors identify themselves after the session cookie may already
      // exist. Keep the first supplied name instead of leaving the row unnamed.
      if (!existing.display_name && displayName?.trim()) {
        await this.db.run(
          "UPDATE conversations SET display_name = ? WHERE id = ?",
          [displayName.trim().slice(0, 120), id],
        );
        return (await this.db.first<Conversation>(
          "SELECT * FROM conversations WHERE id = ?",
          [id],
        ))!;
      }
      return existing;
    }

    const now = Date.now();
    await this.db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, channel, channelUserId, displayName ?? null, now, now],
    );
    return (await this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE id = ?",
      [id],
    ))!;
  }

  async getById(id: string): Promise<Conversation | null> {
    return this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE id = ?",
      [id],
    );
  }

  async setPausedUntil(id: string, until: number | null): Promise<void> {
    await this.db.run(
      "UPDATE conversations SET paused_until = ? WHERE id = ?",
      [until, id],
    );
  }

  async isPaused(id: string): Promise<boolean> {
    const conv = await this.getById(id);
    if (!conv?.paused_until) return false;
    return conv.paused_until > Date.now();
  }

  async touchLastMessage(id: string, when: number = Date.now()): Promise<void> {
    await this.db.run(
      "UPDATE conversations SET last_message_at = ? WHERE id = ?",
      [when, id],
    );
  }

  async setOpenTicket(id: string, ticketId: string | null): Promise<void> {
    await this.db.run(
      "UPDATE conversations SET open_ticket_id = ? WHERE id = ?",
      [ticketId, id],
    );
  }
}
