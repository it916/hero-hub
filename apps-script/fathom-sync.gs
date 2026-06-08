// ═══════════════════════════════════════════════════════════════
// Hero Hub · Fathom Sync (Google Apps Script)
// ═══════════════════════════════════════════════════════════════
// Recibe webhooks de Fathom cuando termina una reunión,
// filtra por "Daily Team Meeting" y guarda en una Google Sheet.
// Expone doGet para que reuniones.html (Hero Hub) lea las reuniones.
//
// Docs Fathom:
//   https://developers.fathom.ai/webhooks
//   https://api.fathom.ai/external/v1/meetings
//
// SETUP (1 sola vez):
// ════════════════════
// 1. Crear nueva Google Sheet → renombrar "Hero Hub — Fathom Sync"
// 2. Extensions → Apps Script → pegar TODO este archivo en Code.gs
// 3. Project Settings (⚙) → Script Properties → agregar 2 props:
//      FATHOM_API_KEY        = tu API key de Fathom
//      FATHOM_WEBHOOK_SECRET = tu webhook secret de Fathom
// 4. Deploy → New deployment → Type: Web app
//      Description: "Fathom Sync v1"
//      Execute as:  Me (it@heroinsuranceusa.com)
//      Who has access: Anyone
//      → Authorize cuando lo pida
//      → Copiar la "Web app URL"
// 5. En Fathom Settings → Webhook → cambiar el destino a:
//      <Web app URL>?token=<FATHOM_WEBHOOK_SECRET>
//      (reemplazá <FATHOM_WEBHOOK_SECRET> por el valor real del secret)
// 6. Correr backfillFromAPI() UNA vez desde el editor de Apps Script
//      (seleccionar la función arriba → click ▶ Run)
// 7. En reuniones.html del Hub, swap SAMPLE_MEETINGS por fetch(<Web app URL>)
//
// FILTRO:
//   Solo se guardan reuniones cuyo title === "Daily Team Meeting".
//   Cambia TITLE_FILTER si quieres otro criterio.
//
// TRADUCCIÓN AL ESPAÑOL:
//   Fathom genera resúmenes solo en inglés (default_summary.markdown_formatted
//   está marcado como "English-only" en su API). Para que las cards del Hub
//   se vean en español, traducimos `purpose` y `takeaway` con
//   LanguageApp.translate(text, "en", "es") al momento de escribir al Sheet.
//   El campo `summary_md` se guarda raw (en inglés) por si se necesita después.
//   Si la traducción falla, se guarda el texto original.
//
// NOTA DE SEGURIDAD:
//   Apps Script no expone HTTP headers en doPost, por lo que NO podemos
//   verificar la firma HMAC oficial de Fathom. Usamos un shared-secret
//   en la URL (?token=) como autorización mínima. El secret viaja
//   encriptado en HTTPS. Si más adelante se quiere HMAC completo,
//   habría que migrar a Cloud Functions o similar.
// ════════════════════════════════════════════════════════════════

const SHEET_NAME   = "reuniones";
const TITLE_FILTER = "Daily Team Meeting";

const COLUMNS = [
  "recording_id",
  "call_id",
  "title",
  "url",
  "recorded_at",
  "duration_sec",
  "purpose",
  "takeaway",
  "action_items_count",
  "recorded_by_name",
  "recorded_by_email",
  "summary_md",
  "sync_source",
  "synced_at",
];


// ─── Webhook receiver (POST de Fathom) ──────────────────────────
function doPost(e) {
  try {
    const expectedToken = PropertiesService.getScriptProperties()
      .getProperty("FATHOM_WEBHOOK_SECRET");
    const providedToken = (e && e.parameter) ? e.parameter.token : null;

    if (!expectedToken) {
      return jsonResponse({ ok: false, error: "missing_secret_config" });
    }
    if (providedToken !== expectedToken) {
      console.warn("doPost: token inválido o ausente");
      return jsonResponse({ ok: false, error: "invalid_token" });
    }

    const payload = JSON.parse(e.postData.contents);
    const result  = processMeeting(payload, "webhook");
    return jsonResponse({
      ok: true,
      action: result,
      recording_id: payload.recording_id || null,
    });

  } catch (err) {
    console.error("doPost error:", err, err.stack);
    return jsonResponse({ ok: false, error: String(err) });
  }
}


// ─── Hub reader (GET — reuniones.html llama esto) ──────────────
function doGet(e) {
  try {
    const limit = parseInt((e && e.parameter) ? e.parameter.limit : "30", 10) || 30;
    const meetings = readMeetings(limit);
    return jsonResponse({
      ok: true,
      count: meetings.length,
      items: meetings,
    });
  } catch (err) {
    console.error("doGet error:", err);
    return jsonResponse({ ok: false, error: String(err) });
  }
}


// ─── Backfill desde Fathom REST API (correr UNA vez manualmente) ─
function backfillFromAPI() {
  const apiKey = PropertiesService.getScriptProperties().getProperty("FATHOM_API_KEY");
  if (!apiKey) throw new Error("FATHOM_API_KEY no está en Script Properties");

  let cursor   = null;
  let imported = 0;
  let skipped  = 0;
  let pages    = 0;

  do {
    const params = {
      include_summary:      "true",
      include_action_items: "true",
    };
    if (cursor) params.cursor = cursor;

    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");

    const resp = UrlFetchApp.fetch(`https://api.fathom.ai/external/v1/meetings?${qs}`, {
      method:              "get",
      headers:             { "X-Api-Key": apiKey },
      muteHttpExceptions:  true,
    });

    const code = resp.getResponseCode();
    if (code !== 200) {
      throw new Error(`Fathom API ${code}: ${resp.getContentText().slice(0, 500)}`);
    }

    const data = JSON.parse(resp.getContentText());
    for (const meeting of (data.items || [])) {
      const result = processMeeting(meeting, "backfill");
      if (result === "skipped") skipped++;
      else imported++;
    }

    cursor = data.next_cursor;
    pages++;
    if (pages > 20) {
      console.warn("backfillFromAPI: límite de 20 páginas alcanzado");
      break;
    }
  } while (cursor);

  const summary = `Backfill OK · ${imported} importadas · ${skipped} filtradas · ${pages} páginas`;
  Logger.log(summary);
  return summary;
}


// ─── Procesar meeting (filtrar + upsert) ────────────────────────
function processMeeting(meeting, source) {
  if (!meeting || !meeting.recording_id) return "invalid";

  const title = String(meeting.title || "").trim();
  if (title !== TITLE_FILTER) return "skipped";

  const summaryMd = (meeting.default_summary && meeting.default_summary.markdown_formatted) || "";
  const purpose   = cleanAndTranslate(extractPurpose(summaryMd));
  const takeaway  = cleanAndTranslate(extractFirstTakeaway(summaryMd));
  const aiCount   = Array.isArray(meeting.action_items) ? meeting.action_items.length : 0;

  let durationSec = "";
  if (meeting.recording_start_time && meeting.recording_end_time) {
    const start = new Date(meeting.recording_start_time).getTime();
    const end   = new Date(meeting.recording_end_time).getTime();
    if (!isNaN(start) && !isNaN(end)) durationSec = Math.round((end - start) / 1000);
  }

  const url = meeting.share_url || meeting.url || "";

  const row = {
    recording_id:       String(meeting.recording_id),
    call_id:            extractCallId(url),
    title:              title,
    url:                url,
    recorded_at:        meeting.recording_start_time || meeting.created_at || "",
    duration_sec:       durationSec,
    purpose:            purpose,
    takeaway:           takeaway,
    action_items_count: aiCount,
    recorded_by_name:   (meeting.recorded_by && meeting.recorded_by.name)  || "",
    recorded_by_email:  (meeting.recorded_by && meeting.recorded_by.email) || "",
    summary_md:         summaryMd,
    sync_source:        source,
    synced_at:          new Date().toISOString(),
  };

  upsertRow(row);
  return "saved";
}


// ─── Sheet I/O ───────────────────────────────────────────────────
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 110);  // recording_id
    sheet.setColumnWidth(3, 200);  // title
    sheet.setColumnWidth(12, 400); // summary_md
  }
  return sheet;
}

function upsertRow(row) {
  const sheet   = getSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    const idCol = COLUMNS.indexOf("recording_id") + 1;
    const ids   = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === row.recording_id) {
        const values = COLUMNS.map(c => row[c] === undefined ? "" : row[c]);
        sheet.getRange(i + 2, 1, 1, COLUMNS.length).setValues([values]);
        return;
      }
    }
  }

  const values = COLUMNS.map(c => row[c] === undefined ? "" : row[c]);
  sheet.appendRow(values);
}

function readMeetings(limit) {
  const sheet   = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();
  return data
    .map(r => {
      const obj = {};
      COLUMNS.forEach((c, i) => obj[c] = r[i]);
      return obj;
    })
    .filter(r => r.recording_id)
    .sort((a, b) => {
      const ta = new Date(a.recorded_at).getTime() || 0;
      const tb = new Date(b.recorded_at).getTime() || 0;
      return tb - ta;
    })
    .slice(0, limit);
}


// ─── Markdown parsers ───────────────────────────────────────────
function extractPurpose(md) {
  if (!md) return "";
  const m = md.match(/##\s*Meeting Purpose\s*\n+([^\n#]+)/i);
  return m ? m[1].trim() : "";
}

function extractFirstTakeaway(md) {
  if (!md) return "";
  const section = md.match(/##\s*Key Takeaways\s*\n+([\s\S]+?)(?=\n##|$)/i);
  if (!section) return "";
  // Primer bullet: línea que empieza con -, *, o número.
  const bullet = section[1].match(/^[ \t]*[-*\d.]+\s+(.+?)(?:\n[ \t]*[-*\d]|$)/m);
  if (!bullet) return "";
  return bullet[1].replace(/\s+/g, " ").trim();
}

function extractCallId(url) {
  if (!url) return "";
  const m = String(url).match(/\/calls\/(\d+)/);
  return m ? m[1] : "";
}


// ─── Limpieza markdown + traducción EN→ES ───────────────────────
// Quita los wrappers [texto](url) que devuelve Fathom y traduce al español.
// Preserva el patrón "**Entidad:** descripción" para que el bold de la card
// siga funcionando — solo se traduce la descripción, la entidad queda igual.
function cleanAndTranslate(md) {
  if (!md) return "";
  // 1. Quitar markdown link wrappers: [texto](url) → texto
  let text = String(md).replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
  if (!text) return "";

  // 2. Si tiene patrón "**Entidad:** body", traducir solo el body
  const m = text.match(/^\*\*([^*]+?):\*\*\s*([\s\S]+)$/);
  if (m) {
    const entity = m[1];
    const body   = m[2];
    return `**${entity}:** ${translateSafe(body)}`;
  }

  // 3. Texto plano: traducir todo
  return translateSafe(text);
}

function translateSafe(text) {
  if (!text) return "";
  try {
    return LanguageApp.translate(text, "en", "es");
  } catch (err) {
    console.warn("translateSafe falló, mantengo texto original:", err);
    return text;
  }
}


// ─── Response helper ────────────────────────────────────────────
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


// ─── Re-traducir filas existentes sin re-llamar a Fathom ───────
// Recorre todas las filas del Sheet, re-extrae purpose/takeaway desde
// summary_md (que está en inglés) y los re-traduce al español.
// Útil después de cambiar la lógica de traducción para actualizar histórico
// sin gastar quota llamando a Fathom otra vez.
function retranslateSheet() {
  const sheet   = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("Sheet vacío, nada que retraducir");
    return "vacío";
  }

  const colPurpose  = COLUMNS.indexOf("purpose") + 1;
  const colTakeaway = COLUMNS.indexOf("takeaway") + 1;
  const colSummary  = COLUMNS.indexOf("summary_md") + 1;
  const colSynced   = COLUMNS.indexOf("synced_at") + 1;

  const summaries = sheet.getRange(2, colSummary, lastRow - 1, 1).getValues();
  let updated = 0;

  for (let i = 0; i < summaries.length; i++) {
    const md = summaries[i][0];
    if (!md) continue;
    const purpose  = cleanAndTranslate(extractPurpose(md));
    const takeaway = cleanAndTranslate(extractFirstTakeaway(md));
    sheet.getRange(i + 2, colPurpose).setValue(purpose);
    sheet.getRange(i + 2, colTakeaway).setValue(takeaway);
    sheet.getRange(i + 2, colSynced).setValue(new Date().toISOString());
    updated++;
  }

  const result = `Retraducidas ${updated} filas`;
  Logger.log(result);
  return result;
}


// ─── Test helpers (correr desde el editor para debug) ───────────
function testDoGet() {
  const result = doGet({ parameter: { limit: "5" } });
  Logger.log(result.getContent());
}

function testProcessSample() {
  const sample = {
    recording_id: 999999,
    title: "Daily Team Meeting",
    share_url: "https://fathom.video/calls/999999",
    recording_start_time: "2026-06-08T15:00:00Z",
    recording_end_time:   "2026-06-08T15:45:00Z",
    default_summary: {
      markdown_formatted:
        "## Meeting Purpose\nTest run desde Apps Script.\n\n" +
        "## Key Takeaways\n- **Test:** This is a sample takeaway.\n- Otro item.",
    },
    action_items: [{ description: "do something" }],
    recorded_by: { name: "Test User", email: "test@heroinsuranceusa.com" },
  };
  const result = processMeeting(sample, "test");
  Logger.log("Process result: " + result);
}
