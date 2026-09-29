import { Agent } from "agents";
import type { SystemModelMessage } from "ai";
import type { Env } from "./env";
import { Db } from "./db/client";
import { ConversationsRepo } from "./db/conversations";
import { MessagesRepo } from "./db/messages";
import { isPro } from "./config";
import { resolveAgentConfig } from "./settings-loader";
import { buildTools } from "./tools";
import { buildMultimodalUserMessage } from "./media/vision";
import { chunkReply } from "./replies/chunker";
import { pickAdapter } from "./replies/sender";
import { selectModel } from "./upgrade/modelSelector";
import type { Tier } from "./upgrade/modelSelector";
import { monthIaCostUsd, applyBudgetGuard } from "./budget";
import { CustomerFactsRepo } from "./db/facts";
import { createModel } from "./llm/provider";
import { formatLlmError } from "./llm/errorDetail";
import { runLlmTurn } from "./llm/runTurn";
import { detectReplyLanguage, replyLanguageInstruction } from "./language";
import {
  isBadWebsiteAssistantReply,
  portfolioFallbackReply,
} from "./webchat";
import {
  DEFAULT_WORKERS_AI_MODEL,
  runWorkersAiTurn,
} from "./llm/workersAi";
import { costOfUsage } from "./pricing";
import type { ChannelId } from "./channels/shared";
import { maskTelegramToken, unmaskTelegramToken } from "./telegramFiles";

export interface SupportAgentState {
  conversationId: string | null;
  channel: string;
  channelUserId: string;
  pendingMessages: { text: string; receivedAt: number }[];
  lastAlarmAt: number;
  lastUserLang: string;
  toolCallsInLast2Turns: number;
  lastSearchKbScore: number;
  imageRetryCount: number;
}

export interface AgentIncomingPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
  text?: string;
  audioUrl?: string;
  imageUrl?: string;
  isOwnerMessage?: boolean;
}

export interface WebChatPayload {
  channelUserId: string;
  text: string;
  displayName?: string;
}

export class SupportAgent extends Agent<Env, SupportAgentState> {
  initialState: SupportAgentState = {
    conversationId: null,
    channel: "",
    channelUserId: "",
    pendingMessages: [],
    lastAlarmAt: 0,
    lastUserLang: "en",
    toolCallsInLast2Turns: 0,
    lastSearchKbScore: 1,
    imageRetryCount: 0,
  };

  /**
   * Called by the Worker fetch handler when a webhook arrives for this user.
   * Buffers the message, schedules/resets an alarm.
   */
  async ingest(payload: AgentIncomingPayload): Promise<{ acknowledged: true }> {
    const db = new Db(this.env.DB);
    const convs = new ConversationsRepo(db);
    const conv = await convs.getOrCreate(
      payload.channel,
      payload.channelUserId,
      payload.displayName,
    );
    this.setState({
      ...this.state,
      channel: payload.channel,
      channelUserId: payload.channelUserId,
      conversationId: conv.id,
    });

    // Owner intervened → pause the bot, do NOT process this as user input
    if (payload.isOwnerMessage) {
      const pausedUntil = Date.now() + 60 * 60 * 1000;
      await convs.setPausedUntil(conv.id, pausedUntil);
      return { acknowledged: true };
    }

    // If paused, ignore (bot stays silent)
    if (await convs.isPaused(conv.id)) {
      return { acknowledged: true };
    }

    // Guardrail anti-spam: el mismo mensaje por 3ª vez entre los últimos 5 →
    // la conversación descansa 1 hora, sin respuesta y sin gastar LLM.
    if (payload.text && !payload.audioUrl && !payload.imageUrl) {
      try {
        const { isRepeatSpam, SPAM_SNOOZE_MS, isOverDailyCap, DAILY_CAP_SNOOZE_MS, DAILY_CAP_MESSAGE } =
          await import("./spam");
        if (await isRepeatSpam(db, conv.id, payload.text)) {
          await convs.setPausedUntil(conv.id, Date.now() + SPAM_SNOOZE_MS);
          console.warn(`[spam-guard] conv ${conv.id} en cooldown 1h (mensaje repetido)`);
          return { acknowledged: true };
        }
        // Tope diario de turnos: despedida amable UNA vez + descanso 12h. La
        // pausa garantiza que no se repita (los siguientes mensajes mueren en
        // isPaused antes de llegar aquí).
        if (await isOverDailyCap(db, conv.id)) {
          await convs.setPausedUntil(conv.id, Date.now() + DAILY_CAP_SNOOZE_MS);
          await new MessagesRepo(db).append(conv.id, "assistant", DAILY_CAP_MESSAGE);
          if (payload.channel !== "web") {
            const channel = payload.channel as ChannelId;
            await pickAdapter(channel).sendReply(
              { channel, channelUserId: payload.channelUserId, chunks: [DAILY_CAP_MESSAGE] },
              this.env,
            );
          }
          console.warn(`[spam-guard] conv ${conv.id} tope diario de turnos → descanso 12h`);
          return { acknowledged: true };
        }
      } catch (e) {
        // El guard es un extra, nunca la ruta crítica: si falla, se responde normal.
        console.warn("[spam-guard] check failed:", e);
      }
    }

    // Process media (audio → transcription, image → Pro-gated multimodal marker)
    let processedText = payload.text ?? "";
    let hasImage = false;

    if (payload.audioUrl) {
      try {
        const { transcribeAudio } = await import("./media/transcribe");
        const result = await transcribeAudio(payload.audioUrl, this.env);
        processedText = result.text || "(audio without transcription)";
      } catch (e) {
        console.error("[ingest] transcription failed:", e);
        processedText = "(I could not understand the audio)";
      }
    }

    if (payload.imageUrl) {
      hasImage = true;
      // Pro-only: if free tier, strip the image and inform the bot owner-side
      if (!isPro(this.env)) {
        processedText =
          (processedText || "") +
          "\n(The customer sent an image, but this plan does not support image analysis.)";
      } else {
        processedText =
          (processedText || "(image without caption)") +
          // MASKED: a Telegram file URL carries the bot token inside, and this
          // marker gets persisted in D1 (and shown in the dashboard, and
          // included in exports). See src/telegramFiles.ts.
          `\n[IMAGE_URL: ${maskTelegramToken(payload.imageUrl)}]`;
      }
    }

    // Append to buffer (we always persist the client's message)
    const pending = [
      ...this.state.pendingMessages,
      { text: processedText, receivedAt: Date.now() },
    ];
    this.setState({
      ...this.state,
      pendingMessages: pending,
      imageRetryCount: hasImage ? 0 : this.state.imageRetryCount,
    });

    // Resolve effective config (D1 settings overlaid on env defaults).
    // We need at least bot_paused (to decide whether to reply) and the buffer.
    const cfg = await resolveAgentConfig(this.env, []);

    // Owner paused the bot via the dashboard → keep the message buffered but
    // stay silent: do NOT arm the alarm, so alarm() never runs.
    if (cfg.botPaused) {
      return { acknowledged: true };
    }

    // Web chat requests are completed synchronously by chat() below. They must
    // not also arm a delayed alarm, otherwise the same message could be run
    // twice after the HTTP response has already been sent.
    if (payload.channel === "web") {
      return { acknowledged: true };
    }

    // Schedule buffer processing via the agents SDK scheduler.
    // The SDK overrides alarm() to dispatch named callbacks from its
    // cf_agents_schedules table, so raw ctx.storage.setAlarm() alone won't
    // invoke our code. We upsert a fixed 'msg-buffer' row (so rapid messages
    // debounce to a single fire) and set the raw alarm as the trigger.
    // Rescue for stranded messages: a Cloudflare alarm can silently fail to
    // fire. When that happens the customer's message sits in the buffer until
    // they write again — we saw a real customer wait 11 minutes before typing
    // "Hola?". If the oldest buffered message is already older than 2x the
    // normal wait, don't wait a whole buffer window again: process almost
    // immediately.
    const oldestAt = pending[0]?.receivedAt ?? Date.now();
    const hasStranded = Date.now() - oldestAt > cfg.bufferMs * 2;
    const alarmAt = Date.now() + (hasStranded ? 500 : cfg.bufferMs);
    const alarmAtSec = Math.floor(alarmAt / 1000);
    this.sql`
      INSERT OR REPLACE INTO cf_agents_schedules
        (id, callback, payload, type, time, created_at)
      VALUES
        ('msg-buffer', 'processBuffer', '{}', 'delayed', ${alarmAtSec}, unixepoch())
    `;
    await this.ctx.storage.setAlarm(alarmAt);
    // Cheap guard against the lost alarm: if it didn't get registered, retry
    // once and leave a trace in the log.
    if ((await this.ctx.storage.getAlarm()) === null) {
      console.error("[ingest] alarm was not armed — retrying");
      await this.ctx.storage.setAlarm(alarmAt);
    }
    this.setState({ ...this.state, lastAlarmAt: alarmAt });

    return { acknowledged: true };
  }

  /**
   * Synchronous entrypoint for a first-party website chat widget. The normal
   * webhook channels call ingest() and answer later through their provider;
   * web chat needs the generated text in the HTTP response instead.
   */
  async chat(payload: WebChatPayload): Promise<{ text: string; conversationId: string; paused?: boolean }> {
    const db = new Db(this.env.DB);
    const convs = new ConversationsRepo(db);
    const existing = await convs.getOrCreate("web", payload.channelUserId, payload.displayName);
    const cfg = await resolveAgentConfig(this.env, []);
    if (cfg.botPaused || (await convs.isPaused(existing.id))) {
      await new MessagesRepo(db).append(existing.id, "user", payload.text);
      await convs.touchLastMessage(existing.id);
      return {
        text: "",
        conversationId: existing.id,
        paused: true,
      };
    }

    await this.ingest({
      channel: "web",
      channelUserId: payload.channelUserId,
      displayName: payload.displayName,
      text: payload.text,
    });
    await this.processBuffer();

    const latest = await new MessagesRepo(db).lastN(existing.id, 1);
    const reply = latest.find((message) => message.role === "assistant")?.content ?? "";
    return { text: reply, conversationId: existing.id };
  }

  /**
   * Called by the agents SDK scheduler when the msg-buffer task fires.
   * Processes accumulated messages as one input, runs the LLM loop, and
   * sends the chunked reply over the channel adapter.
   */
  async processBuffer(): Promise<void> {
    const buffered = [...this.state.pendingMessages];
    this.setState({ ...this.state, pendingMessages: [] });
    if (buffered.length === 0) return;

    const combined = buffered.map((m) => m.text).join("\n").trim();
    if (!combined) return;

    const db = new Db(this.env.DB);
    const msgs = new MessagesRepo(db);
    const convs = new ConversationsRepo(db);
    const convId = this.state.conversationId;
    if (!convId) {
      console.warn("[SupportAgent.processBuffer] no conversation_id in state");
      return;
    }

    // Persist user message
    await msgs.append(convId, "user", combined);
    await convs.touchLastMessage(convId);

    // Load history (last 20)
    const history = await msgs.lastN(convId, 20);
    const aiMessages: any[] = history.slice(0, -1).map((m) => ({
      role: (m.role === "tool"
        ? "user"
        : m.role === "owner"
          ? "assistant"
          : m.role) as "user" | "assistant",
      content: m.content,
    }));
    // Build the LAST user message multimodal-aware: if it carries an
    // [IMAGE_URL: ...] marker AND we're on the Pro tier, attach the image.
    const lastUserMsg = history[history.length - 1];
    if (lastUserMsg) {
      const imgMatch = lastUserMsg.content.match(/\[IMAGE_URL: (.+?)\]/);
      if (imgMatch && isPro(this.env)) {
        // The token was masked before storing; it goes back in only here, to
        // fetch the file. It never leaves this call.
        const imageUrl = unmaskTelegramToken(
          imgMatch[1],
          this.env.TELEGRAM_BOT_TOKEN,
        );
        const cleanText = lastUserMsg.content
          .replace(/\n?\[IMAGE_URL: .+?\]/, "")
          .trim();
        aiMessages.push(buildMultimodalUserMessage(cleanText, imageUrl));
      } else {
        aiMessages.push({ role: "user", content: lastUserMsg.content });
      }
    }

    // Build tools registry (tier-gated in buildTools)
    const tools = buildTools({
      env: this.env,
      getConversationId: () => convId,
    });
    const toolNames = Object.keys(tools);

    // Resolve effective config (D1 settings overlaid on env defaults).
    const cfg = await resolveAgentConfig(this.env, toolNames);

    // Honor the dashboard's tool toggles: the prompt already only advertises
    // enabled tools (settings-loader), so the registry must match.
    const enabledTools = Object.fromEntries(
      Object.entries(tools).filter(([name]) => cfg.enabledToolNames.includes(name)),
    );
    const replyLanguage = detectReplyLanguage(combined);

    // The public portfolio chat can use the native Workers AI binding. It is
    // deliberately a simple text-only path: Llama 3.2 1B is inexpensive and
    // reliable for FAQ-style portfolio replies, but is not used for tool
    // calling or the external channel adapters.
    const useWorkersAiWebChat =
      this.state.channel === "web" &&
      (this.env.WEBCHAT_LLM_PROVIDER === "workers-ai" ||
        cfg.llm.provider === "workers-ai");
    if (useWorkersAiWebChat) {
      const modelId =
        this.env.WORKERS_AI_MODEL_FAST?.trim() || DEFAULT_WORKERS_AI_MODEL;
      const allWorkerMessages = aiMessages
        .filter(
          (message) =>
            message.role === "user" || message.role === "assistant",
        )
        .map((message) => ({
          role: message.role as "user" | "assistant",
          content:
            typeof message.content === "string"
              ? message.content
              : JSON.stringify(message.content),
        }));
      // A small model strongly imitates the previous assistant turn. Keep
      // only same-language history, plus the current message, so switching
      // from Indonesian to English (or back) works reliably.
      const workerMessages = allWorkerMessages.filter(
        (message, index) =>
          (index === allWorkerMessages.length - 1 ||
            detectReplyLanguage(message.content) === replyLanguage) &&
          !(message.role === "assistant" && isBadWebsiteAssistantReply(message.content)),
      );
      const webSystem = `${cfg.systemPrompt}

${replyLanguageInstruction(replyLanguage)}

<public_portfolio_chat>
This is a normal public portfolio conversation. Questions about Alfredo's projects,
work experience, skills, education, website, and contact details are allowed.
Answer those questions directly from the portfolio context. Never refuse a normal
portfolio question and never use a generic safety refusal such as "I cannot help"
or "I am unable to assist". Do not mention tools, internal systems, providers,
or model limitations. If a detail is not in the context, say that you do not have
that detail and suggest the Contact section.
Keep the reply concise and natural. A greeting should receive a friendly greeting.
</public_portfolio_chat>`;

      let assistantText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let workersAiError: unknown;
      for (let attempt = 0; attempt < 2 && !assistantText; attempt += 1) {
        try {
          const turn = await runWorkersAiTurn({
            env: this.env,
            modelId,
            system: webSystem,
            messages: workerMessages,
            temperature: cfg.temperature,
          });
          assistantText = turn.text;
          inputTokens = turn.inputTokens;
          outputTokens = turn.outputTokens;
        } catch (e) {
          workersAiError = e;
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350));
        }
      }
      if (!assistantText) {
        console.error("[SupportAgent] Workers AI web chat failed after retry:", workersAiError);
        assistantText =
          "Sorry, the chat is temporarily unavailable. Please use the Contact section below.";
      } else if (isBadWebsiteAssistantReply(assistantText)) {
        console.warn("[SupportAgent] Replaced generic Workers AI refusal in website chat");
        assistantText = portfolioFallbackReply(combined, replyLanguage);
      }

      await msgs.append(convId, "assistant", assistantText, {
        modelUsed: modelId,
        inputTokens,
        outputTokens,
      });
      await convs.touchLastMessage(convId);
      this.setState({
        ...this.state,
        toolCallsInLast2Turns: 0,
      });
      return;
    }

    // Select tier: honor an explicit override, otherwise auto-select. The active
    // provider (Anthropic default | OpenAI) maps the tier to a concrete model id.
    let tier: Tier =
      cfg.modelOverride === "haiku"
        ? "fast"
        : cfg.modelOverride === "sonnet"
          ? "smart"
          : selectModel({
              toolCallsInLast2Turns: this.state.toolCallsInLast2Turns,
              lastUserText: combined,
              lastUserLang: this.env.BOT_LANGUAGE,
              hasImage: false,
              imageRetryCount: this.state.imageRetryCount,
              lastSearchKbScore: this.state.lastSearchKbScore,
            });

    // Budget guard: at/over the monthly AI budget the bot keeps answering but
    // only on the cheap tier (never goes silent over money).
    if (cfg.monthlyBudgetUsd !== undefined && tier !== "fast") {
      const spent = await monthIaCostUsd(db);
      const guard = applyBudgetGuard(tier, spent, cfg.monthlyBudgetUsd);
      if (guard.downgraded) {
        console.warn(
          `[SupportAgent] monthly budget reached ($${spent.toFixed(2)}/$${cfg.monthlyBudgetUsd}) — downgrading to fast tier`,
        );
      }
      tier = guard.tier;
    }

    const { model, modelId, provider, supportsPromptCache } = createModel(this.env, tier, cfg.llm);

    // Cache the (large, stable) system prompt with an ephemeral cache breakpoint.
    // Only the system block is cached — messages change every turn. Cache hits
    // show up in usage.cachedInputTokens (read below for cost accounting).
    // Prompt caching is Anthropic-only; on OpenAI we send the plain system block.
    const system: SystemModelMessage[] = [
      {
        role: "system",
        content: cfg.systemPrompt,
        ...(supportsPromptCache
          ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
          : {}),
      },
    ];

    // Customer memory (flywheel): facts extracted by the insights analyzer are
    // injected as a small UNCACHED system block, so a returning customer is
    // greeted by a bot that remembers them. The big prompt above stays cached.
    // Memory is an enhancement, never the critical path: if the lookup fails,
    // the reply still goes out.
    try {
      const facts = await new CustomerFactsRepo(db).forConversation(convId, 8);
      if (facts.length > 0) {
        system.push({
          role: "system",
          content: `<customer_memory>\nWhat you already know about this customer from past conversations:\n${facts
            .map((f) => `- ${f.fact}`)
            .join("\n")}\n</customer_memory>`,
        });
      }
    } catch (e) {
      console.warn("[SupportAgent] customer facts lookup failed:", e);
    }

    // This instruction is intentionally the last system block so the reply
    // follows the visitor's current language even when older context differs.
    system.push({
      role: "system",
      content: replyLanguageInstruction(replyLanguage),
    });

    let assistantText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let toolCallCount = 0;
    let toolCallsMade: { toolName: string; input: unknown }[] = [];
    let usedModelId = modelId;

    // Corre el loop del LLM con un modelo dado; deja los resultados en las vars.
    const attempt = async (m: any, providerForAttempt: string = provider) => {
      const turn = await runLlmTurn({
        model: m,
        provider: providerForAttempt,
        system,
        messages: aiMessages,
        tools: enabledTools,
        stopWhen: ({ steps }) => steps.length >= 6,
        ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
      });
      assistantText = turn.text;
      inputTokens = turn.inputTokens;
      outputTokens = turn.outputTokens;
      cachedTokens = turn.cachedTokens;
      toolCallCount = turn.toolCallCount;
      // Persist what the agent DID (not just what it said): tool name + input,
      // feeding the dashboard's thread chips, stats and the Mi Agente counters.
      toolCallsMade = turn.toolCallsMade;
    };

    try {
      await attempt(model, provider);
    } catch (e: any) {
      // FAILOVER con backoff: en ráfagas (historias) el primario suele dar un
      // rate-limit TRANSITORIO — esperar con jitter y reintentar resuelve la
      // mayoría; si no, se prueba el proveedor alterno (también con un segundo
      // intento). El jitter des-sincroniza mensajes que llegaron en el mismo
      // segundo. El bot no puede quedarse mudo el día del evento.
      console.error("[SupportAgent.processBuffer] streamText failed:", formatLlmError(e));
      const backoff = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const { fallbackModel } = await import("./llm/provider");
      const primary = createModel(this.env, tier, cfg.llm);
      const fb = fallbackModel(this.env, tier, primary.provider);
      let ok = false;

      await backoff(2000 + Math.floor(Math.random() * 1500));
      try {
        await attempt(model, primary.provider);
        ok = true;
      } catch (e1: any) {
        console.error("[SupportAgent.processBuffer] primary retry failed:", formatLlmError(e1));
      }

      if (!ok && fb) {
        console.warn(
          `[SupportAgent] failover ${primary.provider} → ${fb.provider}/${fb.modelId}`,
        );
        try {
          await attempt(fb.model, fb.provider);
          usedModelId = fb.modelId;
          ok = true;
        } catch (e2: any) {
          console.error("[SupportAgent.processBuffer] fallback failed:", formatLlmError(e2));
          await backoff(2500 + Math.floor(Math.random() * 1500));
          try {
            await attempt(fb.model, fb.provider);
            usedModelId = fb.modelId;
            ok = true;
          } catch (e3: any) {
            console.error("[SupportAgent.processBuffer] fallback retry failed:", formatLlmError(e3));
          }
        }
      }

      if (!ok) {
        assistantText = "Something went wrong on my side. Please try again in a moment.";
      }
    }

    // Persist assistant message (with usage + model_used + tool calls)
    await msgs.append(convId, "assistant", assistantText, {
      modelUsed: usedModelId,
      inputTokens,
      outputTokens,
      cachedInputTokens: cachedTokens,
      toolCalls: toolCallsMade.length > 0 ? toolCallsMade : undefined,
    });

    // Update state for next turn
    this.setState({
      ...this.state,
      toolCallsInLast2Turns: toolCallCount,
    });

    // Chunk + send via the channel adapter
    const chunks = chunkReply(assistantText, cfg.maxChunks);
    const channel = this.state.channel as ChannelId;
    if (channel !== ("web" as ChannelId)) {
      const adapter = pickAdapter(channel);
      await adapter.sendReply(
        {
          channel,
          channelUserId: this.state.channelUserId,
          chunks,
          interChunkDelayMs: cfg.interChunkDelayMs,
        },
        this.env,
      );
    }

    console.log(
      `[SupportAgent.processBuffer] sent ${chunks.length} chunks, model=${usedModelId}, cost=$${costOfUsage(
        usedModelId,
        { input: inputTokens, cached: cachedTokens, output: outputTokens },
      ).toFixed(5)}`,
    );
  }
}
