// "Campañas" — envío segmentado por WhatsApp respetando las reglas del canal:
// dentro de la ventana de 24h va mensaje free-form (gratis); fuera va plantilla
// HSM aprobada (Twilio Content API) que gasta el tope diario del número
// (default 250). La página enseña ambos números ANTES de mandar para que el
// dueño planee — la cuota es oro el día del evento.
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { layout } from "./layout";
import { SEGMENTS, segmentCounts } from "../../segments";
import {
  listContentTemplates,
  templatesSentLast24h,
  dailyTemplateCap,
  campaignHistory,
} from "../../campaigns";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

function fmtAgo(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

export async function renderCampanas(
  env: Env,
  q: Record<string, string | undefined> = {},
): Promise<string> {
  const db = new Db(env.DB);
  const [counts, templates, spent, history] = await Promise.all([
    segmentCounts(db),
    listContentTemplates(env).catch(() => []),
    templatesSentLast24h(db),
    campaignHistory(db),
  ]);
  const cap = dailyTemplateCap(env);
  const pct = Math.min(100, Math.round((spent / cap) * 100));

  const banner = q.ok
    ? `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:12px 16px;margin-bottom:18px;font-size:12.5px">
        ✅ Campaign sent — free-form: <b>${esc(q.ff ?? "0")}</b> · templates: <b>${esc(q.tp ?? "0")}</b>
        · already received (skipped): ${esc(q.dup ?? "0")} · over quota: ${esc(q.quota ?? "0")} · failed: ${esc(q.fail ?? "0")}
      </div>`
    : q.err
      ? `<div style="border:1px solid var(--bad);background:rgba(220,120,120,.08);padding:12px 16px;margin-bottom:18px;font-size:12.5px">⚠️ ${esc(q.err)}</div>`
      : "";

  const segRows = counts
    .map((s, i) => {
      const def = SEGMENTS.find((d) => d.id === s.id)!;
      return `
      <label style="display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);padding:12px 14px;cursor:pointer;background:var(--panel)">
        <input type="radio" name="segment" value="${esc(s.id)}" ${i === 0 ? "checked" : ""} style="margin-top:3px">
        <div style="min-width:0;flex:1">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <span style="font-weight:600;font-size:13px">${esc(def.label)}</span>
            <span class="font-mono" style="font-size:11px">
              <b>${s.total}</b> total ·
              <span style="color:var(--ok)">${s.inWindow} en ventana</span> ·
              <span style="color:var(--warn,#d9a441)">${s.outWindow} need a template</span>
            </span>
          </div>
          <div class="text-dim" style="font-size:11.5px;margin-top:2px">${esc(def.desc)}</div>
        </div>
      </label>`;
    })
    .join("");

  const templateOpts =
    templates.length > 0
      ? templates
          .map(
            (t) =>
              `<option value="${esc(t.sid)}">${esc(t.name)} — “${esc(t.body.slice(0, 70))}${t.body.length > 70 ? "…" : ""}”</option>`,
          )
          .join("")
      : "";

  const templateSection =
    templates.length > 0
      ? `<select name="template_sid" style="width:100%;background:var(--panel);border:1px solid var(--line);color:inherit;padding:9px 10px;font-size:12px">
          <option value="">— no template (send only to contacts in the window) —</option>
          ${templateOpts}
        </select>
        <input name="template_vars" placeholder='Variables JSON opcional, ej {"1":"Ana"}' class="font-mono"
          style="width:100%;margin-top:8px;background:var(--panel);border:1px solid var(--line);color:inherit;padding:8px 10px;font-size:11.5px">`
      : `<div class="text-dim" style="font-size:12px;border:1px dashed var(--line);padding:12px 14px">
          No approved templates found in your Twilio account (or credentials are missing).
          Create them in Twilio → Content Template Builder and submit them for Meta approval —
          approval can take hours to days, so plan ahead.
        </div>`;

  const historyRows =
    history.length === 0
      ? `<tr><td colspan="4" class="text-dim" style="padding:14px;text-align:center;font-size:12px">No campaigns yet.</td></tr>`
      : history
          .map(
            (h) => `<tr style="border-top:1px solid var(--line)">
          <td style="padding:8px 12px;font-size:12px" class="font-mono">${esc(h.campaign_key)}</td>
          <td style="padding:8px 12px;font-size:12px;text-align:right">${h.freeform}</td>
          <td style="padding:8px 12px;font-size:12px;text-align:right">${h.template}</td>
          <td style="padding:8px 12px;font-size:11px;text-align:right" class="text-dim">${fmtAgo(h.last_at)}</td>
        </tr>`,
          )
          .join("");

  const body = `
  ${banner}

  <div style="display:grid;grid-template-columns:1fr;gap:18px;max-width:860px">

    <div style="border:1px solid var(--line);background:var(--panel2);padding:16px 18px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap">
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase" class="text-dim">Template quota (last 24h)</div>
        <div class="font-mono" style="font-size:13px"><b>${spent}</b> / ${cap}</div>
      </div>
      <div style="height:8px;background:var(--raise);margin-top:8px;border:1px solid var(--line)">
        <div style="height:100%;width:${pct}%;background:${pct > 85 ? "var(--bad)" : "var(--accent,#d9a441)"}"></div>
      </div>
      <div class="text-dim" style="font-size:11px;margin-top:6px">
        Messages to people <b>inside the window</b> (wrote less than 23h ago) are free-form and do NOT use quota.
        Only templates sent to contacts outside the window count. The quota uses a rolling 24-hour window.
      </div>
    </div>

    <form method="post" action="/admin/campanas/send"
      onsubmit="return confirm('Send the campaign to the selected segment? Free-form messages go out immediately and templates use quota.')">

      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:8px" class="text-dim">1 · Elige el segmento</div>
      <div style="display:grid;gap:8px">${segRows}</div>

      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin:18px 0 8px" class="text-dim">2 · Free-form message (for contacts inside the window)</div>
      <textarea name="freeform_text" rows="3" placeholder="Sent as-is to contacts who wrote less than 23h ago. Leave empty to skip them."
        style="width:100%;background:var(--panel);border:1px solid var(--line);color:inherit;padding:10px 12px;font-size:12.5px"></textarea>

      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin:18px 0 8px" class="text-dim">3 · HSM template (for contacts outside the window)</div>
      ${templateSection}

      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin:18px 0 8px" class="text-dim">4 · Campaign name (duplicate-protection lock)</div>
      <input name="campaign_key" required placeholder="ej: deadline-bonos-26jul" class="font-mono"
        style="width:100%;background:var(--panel);border:1px solid var(--line);color:inherit;padding:9px 10px;font-size:12px">
      <div class="text-dim" style="font-size:11px;margin-top:4px">
        Retrying a campaign with the same name will not send anyone a duplicate.
      </div>

      <button type="submit" class="btn" style="margin-top:16px;border:1px solid var(--accent,#d9a441);background:rgba(217,164,65,.12);padding:10px 22px;font-weight:700;font-size:12px;letter-spacing:.08em;cursor:pointer">
        ⚡ ENVIAR CAMPAÑA
      </button>
      <span class="text-dim" style="font-size:11px;margin-left:10px">Puede tardar ~1 min con audiencias grandes.</span>
    </form>

    <div>
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:8px" class="text-dim">Historial</div>
      <table style="width:100%;border:1px solid var(--line);border-collapse:collapse;background:var(--panel)">
        <thead><tr class="text-dim" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase">
          <th style="padding:8px 12px;text-align:left">Campaign</th>
          <th style="padding:8px 12px;text-align:right">Free-form</th>
          <th style="padding:8px 12px;text-align:right">Templates</th>
          <th style="padding:8px 12px;text-align:right">Last send</th>
        </tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>
  </div>`;

  return layout({ title: "Campaigns", activeTab: "campanas", body, env });
}
