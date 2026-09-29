// Tab "✦ Mejoras" — la cola del flywheel (F5). El sistema detecta huecos de
// conocimiento y lecciones de los takeovers del dueño, redacta la mejora y la
// propone AQUÍ con su evidencia. Nada se aplica sin el clic del dueño (modo
// manual). Aplicar un kb_entry crea+indexa el doc, aplicar una lección la mete
// al prompt generado como <lecciones_aprendidas>.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { SuggestionsRepo, type Suggestion } from "../../db/suggestions";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { getLessons, MAX_LESSONS } from "../../flywheel/detect";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

function ago(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.floor(h / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// Pill color per kind — accent2 (amber) is the "AI/insights" token.
const KIND_BADGE: Record<string, { txt: string; color: string }> = {
  kb_entry: { txt: "📚 Knowledge", color: "var(--info)" },
  leccion: { txt: "🎓 Lesson", color: "var(--accent-2)" },
};

const STATUS_BADGE: Record<string, { txt: string; color: string }> = {
  applied: { txt: "✓ applied", color: "var(--ok)" },
  dismissed: { txt: "descartada", color: "var(--dim)" },
};

function pill(txt: string, color: string): string {
  return `<span style="font-size:9px;letter-spacing:.03em;color:${color};border:1px solid ${color};padding:1px 6px;white-space:nowrap">${txt}</span>`;
}

function suggestionCard(s: Suggestion): string {
  const kind = KIND_BADGE[s.kind] ?? { txt: s.kind, color: "var(--muted)" };
  let preview = "";
  try {
    const p = JSON.parse(s.payload);
    if (s.kind === "kb_entry" && p.content) {
      preview = `
      <details style="margin-top:8px">
        <summary class="text-[11.5px]" style="color:var(--accent-2);cursor:pointer;list-style:none">View drafted entry (you can edit it later in Knowledge)</summary>
        <div class="text-[12.5px] leading-relaxed" style="margin-top:8px;background:var(--panel2);border:1px solid var(--line);padding:12px;white-space:pre-wrap">${esc(String(p.content))}</div>
      </details>`;
    }
  } catch { /* payload preview is best-effort */ }

  return `
  <div class="card bg-panel border border-line" style="padding:18px">
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px">
      ${pill(kind.txt, kind.color)}
      <span class="text-dim text-[11px]">${ago(s.created_at)}</span>
    </div>
    <div class="font-display font-semibold text-[13.5px] text-cream" style="margin-bottom:4px">${esc(s.title)}</div>
    ${s.evidence ? `<div class="text-muted text-[12px]">Evidencia: ${esc(s.evidence)}</div>` : ""}
    ${preview}
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">
      <form method="POST" action="/admin/mejoras/${encodeURIComponent(s.id)}/apply">
        <button class="bigbtn font-display font-bold text-[11.5px] cursor-pointer"
                style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:3px 3px 0 var(--linelit);padding:8px 16px">Apply</button>
      </form>
      <form method="POST" action="/admin/mejoras/${encodeURIComponent(s.id)}/dismiss">
        <button class="ghostbtn cursor-pointer"
                style="background:var(--panel);border:1px solid var(--line);color:var(--muted);padding:8px 16px;font-size:11.5px;transition:all .12s ease">Dismiss</button>
      </form>
    </div>
  </div>`;
}

export async function renderMejoras(
  env: Env,
  flash?: { found?: string; applied?: boolean; dismissed?: boolean },
): Promise<string> {
  const db = new Db(env.DB);
  const repo = new SuggestionsRepo(db);
  const [proposed, handled, lessons, autonomyRaw] = await Promise.all([
    repo.listProposed(),
    repo.listHandled(8),
    getLessons(env),
    new SettingsRepo(db).get(SETTING_KEYS.autonomyLevel),
  ]);
  const copilot = autonomyRaw === "copilot";

  const banner = flash?.found !== undefined
    ? `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.1);color:var(--ok);padding:10px 14px;font-size:12.5px;margin-bottom:16px">Search complete: ${esc(flash.found)} ${flash.found === "1" ? "new improvement proposed" : "new improvements proposed"}.</div>`
    : flash?.applied
      ? `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.1);color:var(--ok);padding:10px 14px;font-size:12.5px;margin-bottom:16px">✓ Improvement applied — active from the next message.</div>`
      : flash?.dismissed
        ? `<div style="border:1px solid var(--line);background:var(--panel2);color:var(--muted);padding:10px 14px;font-size:12.5px;margin-bottom:16px">Dismissed. It will not be proposed again.</div>`
        : "";

  const proposedList = proposed.length
    ? proposed.map(suggestionCard).join("")
    : `<div class="bg-panel border border-line text-dim text-[12.5px]" style="padding:32px;text-align:center">
         No pending improvements. The system searches every night — or press "Search for improvements now".
       </div>`;

  const lessonRows = lessons.length
    ? lessons
        .map(
          (l) => `
      <div style="display:flex;align-items:start;gap:8px;border-top:1px solid var(--line);padding:8px 0" class="first:border-t-0">
        <span class="text-[12.5px] text-muted" style="flex:1">🎓 ${esc(l)}</span>
        <form method="POST" action="/admin/mejoras/lessons/remove">
          <input type="hidden" name="lesson" value="${esc(l)}">
          <button class="text-dim text-[11px] cursor-pointer" style="background:none;border:none" title="Remove this lesson from the prompt">✕</button>
        </form>
      </div>`,
        )
        .join("")
    : `<p class="text-dim text-[12px]">No lessons applied yet. When you intervene in conversations, the system learns from your replies.</p>`;

  const historyRows = handled.length
    ? handled
        .map((s) => {
          const st = STATUS_BADGE[s.status] ?? { txt: s.status, color: "var(--dim)" };
          const kind = KIND_BADGE[s.kind] ?? { txt: s.kind, color: "var(--muted)" };
          return `
      <div style="display:flex;align-items:center;gap:8px;border-top:1px solid var(--line);padding:8px 0;font-size:12.5px" class="first:border-t-0">
        ${pill(kind.txt, kind.color)}
        <span class="text-muted truncate" style="flex:1">${esc(s.title)}</span>
        ${pill(st.txt, st.color)}
      </div>`;
        })
        .join("")
    : `<p class="text-dim text-[12px]">No history yet.</p>`;

  const body = `
    ${banner}
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:16px">
      <div>
        <h2 class="font-display font-semibold text-[15px] text-cream">✦ Suggested improvements</h2>
        <p class="text-muted text-[12.5px]" style="margin-top:2px">${
          copilot
            ? "Copilot mode: safe changes are applied each night. Sensitive changes wait here for you."
            : "Your bot detects what is missing and proposes it with evidence. Nothing changes without your approval."
        }</p>
      </div>
      <form method="POST" action="/admin/mejoras/run" style="margin-left:auto">
        <button class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
                style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:3px 3px 0 var(--linelit);padding:9px 16px;display:flex;align-items:center;gap:8px;white-space:nowrap">
          <i data-lucide="sparkles" width="14" height="14"></i> Search for improvements now
        </button>
      </form>
    </div>

    <div class="bg-panel border border-line" style="padding:14px 18px;margin-bottom:16px;display:flex;flex-wrap:wrap;align-items:center;gap:12px">
      <div style="flex:1;min-width:220px">
        <div class="font-display font-semibold text-[13px] text-cream" style="display:flex;align-items:center;gap:8px">
          <i data-lucide="moon" width="13" height="13"></i> Modo nocturno
          ${copilot ? pill("COPILOTO ACTIVO", "var(--ok)") : pill("MANUAL", "var(--dim)")}
        </div>
        <p class="text-dim text-[11.5px]" style="margin-top:4px">
          En <strong style="color:var(--muted)">copiloto</strong>, cada noche el bot se aplica solo lo SEGURO:
          complete knowledge entries and lessons from your interventions (everything is reversible from this tab).
          Items that need your judgment — knowledge gaps to complete — remain in the queue.
          It never touches your base prompt, settings, or code.
        </p>
      </div>
      <form method="POST" action="/admin/mejoras/autonomy">
        <input type="hidden" name="level" value="${copilot ? "manual" : "copilot"}">
        <button class="ghostbtn cursor-pointer" style="background:${copilot ? "var(--panel)" : "var(--accent)"};border:1px solid ${copilot ? "var(--line)" : "var(--accent)"};color:${copilot ? "var(--muted)" : "#1a1206"};padding:9px 16px;font-size:11.5px;font-weight:${copilot ? "400" : "700"};white-space:nowrap">
          ${copilot ? "Switch to manual" : "Enable copilot"}
        </button>
      </form>
    </div>

    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:24px">${proposedList}</div>

    <div style="display:grid;grid-template-columns:1fr;gap:16px" class="md:grid-cols-2">
      <div class="bg-panel border border-line" style="padding:18px">
        <div class="font-display font-semibold text-[13.5px] text-cream" style="margin-bottom:8px">🎓 Lecciones activas en el prompt <span class="text-dim" style="font-weight:400;font-size:11px">(${lessons.length}/${MAX_LESSONS})</span></div>
        <p class="text-dim text-[11.5px]" style="margin-bottom:12px">Rules learned from your interventions. The bot follows them in every reply (automatic prompt only).</p>
        ${lessonRows}
      </div>
      <div class="bg-panel border border-line" style="padding:18px">
        <div class="font-display font-semibold text-[13.5px] text-cream" style="margin-bottom:8px">📓 Historial</div>
        ${historyRows}
      </div>
    </div>`;

  return layout({ title: "Improvements", activeTab: "mejoras", body, env });
}
