// Tab "Insights" — la capa de IA que trabaja para el dueño. Muestra lo que el
// analizador (Haiku) concluyó de cada conversación cerrada: sentimiento,
// resolución, calidad del bot, radar de preguntas que la KB no supo y ventas
// que quedaron abiertas. Todo en español simple para un dueño no-técnico.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { InsightsRepo, type InsightWithConversation } from "../../db/insights";
import { countPending } from "../../insights/analyzer";
import { channelLabel } from "../../channels/labels";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

/** Short relative time in English. */
function ago(ms: number | null | undefined): string {
  if (!ms) return "";
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.floor(h / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// cls se comparte con conversations.ts (interpolado dentro de un class="...")
// así que se queda como utilities de Tailwind — mapeadas a los tokens oscuros,
// no a los grises/verdes claros de antes.
export const SENTIMENT_BADGE: Record<string, { txt: string; cls: string }> = {
  positive: { txt: "🙂 Positive", cls: "border border-ok text-ok bg-ok/10" },
  neutral: { txt: "Neutral", cls: "border border-line text-muted bg-panel2" },
  frustrated: { txt: "😕 Frustrated", cls: "border border-accent2 text-accent2 bg-accent2/10" },
  angry: { txt: "😠 Angry", cls: "border border-bad text-bad bg-bad/10" },
};

export const RESOLUTION_BADGE: Record<string, { txt: string; cls: string }> = {
  resolved: { txt: "✓ Resolved", cls: "border border-ok text-ok bg-ok/10" },
  unresolved: { txt: "Unresolved", cls: "border border-accent2 text-accent2 bg-accent2/10" },
  escalated: { txt: "↗ Escalated", cls: "border border-info text-info bg-info/10" },
  abandoned: { txt: "Abandoned", cls: "border border-line text-dim bg-panel2" },
};

function badge(map: Record<string, { txt: string; cls: string }>, key: string | null): string {
  if (!key || !map[key]) return "";
  const b = map[key];
  return `<span class="text-[9px] tracking-wide px-1.5 py-0.5 whitespace-nowrap ${b.cls}">${b.txt}</span>`;
}

function scoreStars(score: number | null): string {
  if (!score) return "";
  return `<span class="text-[11px] text-accent2 whitespace-nowrap" style="letter-spacing:1px" title="Bot reply quality">${"★".repeat(score)}${"☆".repeat(5 - score)}</span>`;
}

function convName(r: InsightWithConversation): string {
  return esc(r.display_name ?? r.channel_user_id ?? r.conversation_id);
}

const CHANNEL_CHIP: Record<string, string> = {
  twilio: "text-info border-info",
  whatsapp: "text-info border-info",
  telegram: "text-accent2 border-accent2",
};

function channelChip(channel: string | null): string {
  const cls = (channel && CHANNEL_CHIP[channel]) ?? "text-muted border-linelit";
  return `<span class="text-[9px] tracking-wide border px-1.5 ${cls}">${esc(channelLabel(channel))}</span>`;
}

export async function renderInsights(env: Env, analyzedParam?: string): Promise<string> {
  const db = new Db(env.DB);
  const repo = new InsightsRepo(db);
  const sevenDays = Date.now() - 7 * 86_400_000;
  const thirtyDays = Date.now() - 30 * 86_400_000;

  const [stats, missed, opportunities, recent, pending] = await Promise.all([
    repo.stats(sevenDays),
    repo.missedKb(thirtyDays),
    repo.opportunities(thirtyDays),
    repo.recent(15),
    countPending(env),
  ]);

  const resolvedPct =
    stats.analyzed > 0 ? Math.round((stats.resolvedNoHuman / stats.analyzed) * 100) : null;

  const analyzedBanner =
    analyzedParam != null
      ? `<div class="border border-ok text-ok px-4 py-3 text-[12.5px] mb-1" style="background:var(--panel)">
           Analysis complete: ${esc(analyzedParam)} conversations graded ✓
         </div>`
      : "";

  const statCard = (value: string, label: string, sub = "", accent = "") => `
    <div class="card bg-panel border border-line p-4${accent ? ` border-l-[3px] ${accent}` : ""}">
      <div class="font-display font-bold text-[30px] leading-none">${value}</div>
      <div class="text-[11px] text-muted mt-1">${label}</div>
      ${sub ? `<div class="text-[10px] text-dim mt-0.5">${sub}</div>` : ""}
    </div>`;

  const cards = `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${statCard(String(stats.analyzed), "Analyzed conversations", "last 7 days")}
      ${statCard(resolvedPct === null ? "—" : `${resolvedPct}%`, "Resolved without a human", "", "border-l-ok")}
      ${statCard(
        stats.avgScore === null ? "—" : `${stats.avgScore.toFixed(1)}<span class="text-[16px] text-dim">/5</span>`,
        "Bot quality",
        stats.avgScore === null ? "" : "★".repeat(Math.round(stats.avgScore)) + "☆".repeat(5 - Math.round(stats.avgScore)),
      )}
      ${statCard(String(stats.negative), stats.negative > 0 ? "⚠ Frustrated customers" : "Frustrated customers", "", stats.negative > 0 ? "border-l-bad" : "")}
    </div>`;

  // --- Radar de conocimiento --------------------------------------------------
  const missedRows = missed.length
    ? missed
        .map(
          (m) => `
      <div class="border border-linelit p-[10px_12px]" style="background:var(--panel2)">
        <div class="text-[10.5px] text-accent2">${m.n} ${m.n === 1 ? "customer asked" : "customers asked"} · the bot did not know</div>
        <div class="text-[12.5px] mt-[3px] text-cream">${esc(m.question)}</div>
      </div>`,
        )
        .join("")
    : `<p class="text-[12.5px] text-dim">No gaps detected. The bot answered everything analyzed. 🎉</p>`;

  const radarCard = `
    <div class="card bg-panel border border-line p-[18px]">
      <div class="font-display font-semibold text-[14px] flex items-center gap-2"><i data-lucide="radar" width="16" height="16" class="text-accent2"></i> Knowledge radar <span class="text-[10px] text-dim font-normal">(30 days)</span></div>
      <p class="text-[11px] text-dim my-[6px_0_12px] leading-relaxed">Questions the bot could not answer. Add them to the business information or knowledge base.</p>
      <div class="flex flex-col gap-2">${missedRows}</div>
    </div>`;

  // --- Ventas abiertas ---------------------------------------------------------
  const oppRows = opportunities.length
    ? opportunities
        .map(
          (o) => `
      <div class="border border-linelit p-[10px_12px]" style="background:var(--panel2)">
        <div class="flex items-center justify-between gap-2">
          <a href="/admin/conversations/${encodeURIComponent(o.conversation_id)}" class="text-[12.5px] font-semibold text-accent hover:text-accent2">${convName(o)}</a>
          <span class="text-[10px] text-dim whitespace-nowrap">${ago(o.last_message_at)}</span>
        </div>
        <div class="text-[11.5px] text-muted mt-[3px]">${esc(o.summary ?? "")}</div>
      </div>`,
        )
        .join("")
    : `<p class="text-[12.5px] text-dim">No open sales opportunities detected.</p>`;

  const oppCard = `
    <div class="card bg-panel border border-line p-[18px]">
      <div class="font-display font-semibold text-[14px] flex items-center gap-2"><i data-lucide="dollar-sign" width="16" height="16" class="text-ok"></i> Open sales opportunities <span class="text-[10px] text-dim font-normal">(30 days)</span></div>
      <p class="text-[11px] text-dim my-[6px_0_12px] leading-relaxed">Interested customers who did not close. A follow-up message may recover them.</p>
      <div class="flex flex-col gap-2">${oppRows}</div>
    </div>`;

  // --- Análisis recientes --------------------------------------------------------
  const recentRows = recent.length
    ? recent
        .map(
          (r) => `
      <div class="datarow" style="display:flex;align-items:flex-start;gap:14px;padding:13px 18px;border-top:1px solid var(--line);transition:background .12s ease">
        <div style="min-width:0;flex:1">
          <div style="display:flex;align-items:center;gap:7px">
            <a href="/admin/conversations/${encodeURIComponent(r.conversation_id)}" class="text-[13px] font-semibold text-cream hover:text-accent">${convName(r)}</a>
            ${channelChip(r.channel)}
          </div>
          <div class="text-[11.5px] text-muted mt-[3px] leading-relaxed">${esc(r.summary ?? "")}</div>
        </div>
        <div style="text-align:right;flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:5px">
          <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">
            ${badge(SENTIMENT_BADGE, r.sentiment)}
            ${badge(RESOLUTION_BADGE, r.resolution)}
          </div>
          <div>${scoreStars(r.bot_score)}</div>
        </div>
      </div>`,
        )
        .join("")
    : `<div class="py-6 text-center text-[12.5px] text-dim">No analyzed conversations yet. Press "Analyze now".</div>`;

  const recentCard = `
    <div class="card bg-panel border border-line">
      <div class="font-display font-semibold text-[14px] px-[18px] pt-4 pb-[6px]">Recent analyses</div>
      ${recentRows}
    </div>`;

  const analyzeBar = `
    <div class="flex flex-wrap items-center gap-[14px]">
      <form method="POST" action="/admin/insights/analyze">
        <button class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
          style="background:var(--panel);border:1px solid var(--linelit);color:var(--accent-2);box-shadow:4px 4px 0 var(--linelit);padding:11px 16px;display:flex;align-items:center;gap:8px">
          <i data-lucide="sparkles" width="16" height="16"></i> Analyze now
        </button>
      </form>
      <span class="text-[11px] text-dim">
        ${pending > 0 ? `${pending} conversations waiting for analysis` : "Everything analyzed ✓"}
        · analysis uses the fast model (~$0.001 per conversation)
      </span>
    </div>`;

  const body = `
    <div class="flex flex-col gap-4" style="max-width:1080px">
      ${analyzedBanner}
      ${analyzeBar}
      ${cards}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-[14px]">
        ${radarCard}
        ${oppCard}
      </div>
      ${recentCard}
    </div>`;

  return layout({ title: "Insights", activeTab: "insights", body, env });
}
