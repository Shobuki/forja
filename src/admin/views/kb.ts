// Tab "Conocimiento" — la KB editable desde el dashboard (F4).
//
// El dueño escribe documentos (horarios, políticas, FAQ, promos) y quedan
// indexados en Vectorize AL GUARDAR: el bot los usa vía searchKb desde el
// siguiente mensaje. Los fragmentos precargados del repo conviven con estos.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { KbDocsRepo, FIXTURE_CHUNKS, MAX_DOC_CHARS, chunkContent, type KbDoc } from "../../kb/docs";
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

/** Callout banner. `tone` picks the token: ok=verde (éxito), bad=rojo (error), neutral=gris (info). */
function banner(tone: "ok" | "bad" | "neutral", text: string): string {
  const color = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : "var(--dim)";
  const bg = tone === "ok" ? "rgba(127,183,126,.1)" : tone === "bad" ? "rgba(217,122,106,.1)" : "var(--panel2)";
  return `<div style="border:1px solid ${color};background:${bg};color:${tone === "neutral" ? "var(--muted)" : color};padding:10px 14px;font-size:12.5px;margin-bottom:16px">${text}</div>`;
}

export async function renderKbList(
  env: Env,
  flash?: { saved?: boolean; deleted?: boolean; reindexed?: string },
): Promise<string> {
  const docs = await new KbDocsRepo(new Db(env.DB)).list();

  const bannerHtml = flash?.saved
    ? banner("ok", "✓ Guardado e indexado — el bot ya puede usarlo.")
    : flash?.deleted
      ? banner("neutral", "Document deleted (also removed from the bot index).")
      : flash?.reindexed
        ? banner("ok", `✓ Reindexado: ${esc(flash.reindexed)} fragmentos actualizados.`)
        : "";

  const rows = docs.length
    ? docs
        .map((d) => {
          const chunks = chunkContent(d.content).length;
          return `
      <div class="kbrow" style="display:flex;align-items:center;gap:12px;padding:13px 18px;border-top:1px solid var(--line);transition:background .12s ease">
        <div style="min-width:0;flex:1">
          <a href="/admin/kb/${encodeURIComponent(d.id)}/edit" class="font-display font-semibold text-[13px] text-cream" style="display:block">${esc(d.title)}</a>
          <div class="text-dim text-[11.5px]" style="margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.content.replace(/\s+/g, " ").slice(0, 90))}</div>
        </div>
        <div class="text-dim text-[10.5px]" style="text-align:right;white-space:nowrap;flex:none">
          <div>${d.content.length.toLocaleString("es-MX")} caracteres · ${chunks} ${chunks === 1 ? "fragmento" : "fragmentos"}</div>
          <div>${ago(d.updated_at)}</div>
        </div>
        <a href="/admin/kb/${encodeURIComponent(d.id)}/edit" class="kbedit" style="border:1px solid var(--line);color:var(--muted);padding:5px 12px;font-size:11px;white-space:nowrap;transition:all .12s ease;flex:none">Edit</a>
      </div>`;
        })
        .join("")
    : `<div class="text-dim text-[12.5px]" style="padding:40px 18px;text-align:center">
         You do not have custom documents yet. Create the first one — hours, prices, policies, promotions…
       </div>`;

  const body = `
    ${bannerHtml}
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:16px">
      <div>
        <h2 class="font-display font-semibold text-[15px] text-cream">📚 Bot knowledge</h2>
        <p class="text-muted text-[12.5px]" style="margin-top:2px">What your bot knows about the business. Each document is indexed on save and used immediately.</p>
      </div>
      <a href="/admin/kb/new" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
         style="margin-left:auto;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:3px 3px 0 var(--linelit);padding:9px 16px;display:flex;align-items:center;gap:8px;white-space:nowrap">
        <i data-lucide="plus" width="14" height="14"></i> New document
      </a>
    </div>

    <div class="bg-panel border border-line" style="margin-bottom:16px;overflow:hidden">
      ${rows}
    </div>

    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px" class="text-dim text-[11.5px]">
      <span>Your bot also includes <b class="text-cream">${FIXTURE_CHUNKS.length}</b> preloaded snippets from the repository.</span>
      <form method="POST" action="/admin/kb/reindex" style="margin-left:auto">
        <button class="ghostbtn cursor-pointer" style="display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);color:var(--muted);padding:8px 14px;font-size:11.5px;transition:all .12s ease">
           <i data-lucide="refresh-cw" width="13" height="13"></i> Reindex all
        </button>
      </form>
    </div>`;

  return layout({ title: "Knowledge", activeTab: "kb", body, env });
}

export function renderKbEditor(doc: KbDoc | null, env: Env): string {
  const isNew = doc === null;
  const body = `
    <div style="margin-bottom:16px">
      <a href="/admin/kb" style="font-size:12.5px;display:inline-flex;align-items:center;gap:6px">
        <i data-lucide="arrow-left" width="14" height="14"></i> Back to Knowledge
      </a>
    </div>
    <form method="POST" action="/admin/kb/save" class="bg-panel border border-line" style="padding:22px;display:flex;flex-direction:column;gap:18px">
      <h2 class="font-display font-semibold text-[15px] text-cream">${isNew ? "＋ New document" : "Edit document"}</h2>
      ${isNew ? "" : `<input type="hidden" name="id" value="${esc(doc.id)}">`}

      <div style="display:flex;flex-direction:column;gap:6px">
        <label for="title" class="font-display font-semibold text-[12.5px] text-cream">Title</label>
        <p class="text-dim text-[11px]">A clear topic name (the bot sees it as context).</p>
        <input type="text" id="title" name="title" required maxlength="200"
               value="${esc(doc?.title ?? "")}" placeholder="Example: Hours and location"
               style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none">
      </div>

      <div style="display:flex;flex-direction:column;gap:6px">
        <label for="content" class="font-display font-semibold text-[12.5px] text-cream">Contenido</label>
        <p class="text-dim text-[11px]">Write in natural language, as you would explain it to a new employee. Maximum ${MAX_DOC_CHARS.toLocaleString("en-US")} characters.</p>
        <textarea id="content" name="content" rows="14" required maxlength="${MAX_DOC_CHARS}"
                  placeholder="Example: We are open Monday to Saturday from 9am to 7pm. Closed Sundays. We are at 123 Reforma Ave., two blocks from the metro…"
                  style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;resize:vertical">${esc(doc?.content ?? "")}</textarea>
      </div>

      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">
        <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
                style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:4px 4px 0 var(--linelit);padding:11px 20px">Save and index</button>
        ${isNew ? "" : `
        <details style="margin-left:auto">
          <summary class="text-bad text-[12px]" style="cursor:pointer;list-style:none">Delete document…</summary>
          <span style="display:inline-flex;align-items:center;gap:10px;margin-top:8px">
            <span class="text-dim text-[11px]">Are you sure? The bot will forget this.</span>
            <button type="submit" formaction="/admin/kb/${encodeURIComponent(doc.id)}/delete" formnovalidate
                    style="background:transparent;border:1px solid var(--bad);color:var(--bad);padding:6px 12px;font-size:11px;cursor:pointer">Yes, delete</button>
          </span>
        </details>`}
      </div>
    </form>`;

  return layout({ title: isNew ? "New document" : "Edit document", activeTab: "kb", body, env });
}
