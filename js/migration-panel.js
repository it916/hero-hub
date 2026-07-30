// ═══════════════════════════════════════════
// Hero Hub · Migración a users/{email} (Fase 0)
// ═══════════════════════════════════════════
// Panel one-shot que vive en admin.html (tab "Migración de datos", solo
// visible al rol IT). Consolida shared/team.members[] + shared/roles.users[]
// en la colección users/{email}. Los docs viejos NO se borran — se
// deprecan en Fase 1.5 después de validar todo.
//
// Flujo:
//   1) Descargar backup JSON de shared/team + shared/roles
//   2) Preview (dry-run): cruza data, aplica normalizaciones, muestra tabla
//   3) Ejecutar: escribe users/{email} con heroConfirm doble + audit-log

import { auth, db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { logEvent, ACTIONS } from "./audit-log.js";

// ═══════════════════════════════════════════
// CONSTANTES DE TRANSFORMACIÓN
// ═══════════════════════════════════════════

const ROLE_ENUM = ["admin", "IT", "finanzas", "interno", "agente"];

// Normalización del casing y aliases legacy que hoy vive en roles.js
// aliasing en runtime. Acá lo materializamos en la data.
const ROLE_NORMALIZE = {
  "admin": "admin",
  "it": "IT",
  "IT": "IT",
  "finanzas": "finanzas",
  "interno": "interno",
  "agente": "agente",
  "directivo": "interno", // legacy alias
  "rrhh": "interno"       // legacy alias
};

// Nombres de país → códigos ISO 3166-1 alpha-2.
// Cubre los orígenes actuales del equipo. Cualquier otro país queda
// como conflicto en el preview para revisión manual.
const COUNTRY_TO_ISO = {
  "venezuela": "VE",
  "cuba": "CU",
  "colombia": "CO",
  "chile": "CL",
  "honduras": "HN",
  "estados unidos": "US",
  "eeuu": "US",
  "us": "US",
  "united states": "US",
  "argentina": "AR",
  "méxico": "MX",
  "mexico": "MX",
  "españa": "ES",
  "espana": "ES",
  "perú": "PE",
  "peru": "PE",
  "ecuador": "EC",
  "uruguay": "UY",
  "costa rica": "CR",
  "panamá": "PA",
  "panama": "PA",
  "república dominicana": "DO",
  "republica dominicana": "DO",
  "guatemala": "GT",
  "nicaragua": "NI",
  "el salvador": "SV",
  "bolivia": "BO",
  "paraguay": "PY",
  "puerto rico": "PR",
  "brasil": "BR",
  "brazil": "BR"
};

// Personas excluidas de la vista de Equipo. Se materializa como
// access.active=false + meta.excluded=true (antes vivía hardcoded en equipo.js:38).
const EXCLUDED_NAMES = ["Luis Ernesto Gutiérrez"];

// ═══════════════════════════════════════════
// HELPERS DE NORMALIZACIÓN
// ═══════════════════════════════════════════

function slugifyName(name) {
  const clean = (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "miembro-" + Date.now();
  if (parts.length === 1) return parts[0];
  return `${parts[0]}-${parts[1]}`;
}

function normName(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function normalizeCountry(str) {
  if (!str) return { value: null, warning: null };
  const key = str.toLowerCase().trim();
  const iso = COUNTRY_TO_ISO[key];
  if (iso) return { value: iso, warning: null };
  return { value: null, warning: `País "${str}" sin mapping ISO — revisar` };
}

function normalizeRole(entry) {
  if (!entry) return { value: null, warning: null };
  const raw = typeof entry === "string" ? entry : entry.role;
  if (!raw) return { value: null, warning: "Entry sin campo role" };
  const normalized = ROLE_NORMALIZE[raw.toLowerCase()] || ROLE_NORMALIZE[raw];
  if (!normalized) {
    return { value: null, warning: `Rol "${raw}" desconocido — se deja null` };
  }
  const warning = (raw !== normalized) ? `Rol "${raw}" normalizado a "${normalized}"` : null;
  return { value: normalized, warning };
}

function normalizeBio(bio) {
  const empty = { identidad: "", superpoder: "", frase: "", union: "" };
  if (!bio) return { value: empty, warning: null };
  if (typeof bio === "string") {
    return {
      value: { ...empty, superpoder: bio.slice(0, 500) },
      warning: "Bio era string libre — movida a 'superpoder'"
    };
  }
  if (typeof bio === "object") {
    return {
      value: {
        identidad: bio.identidad || "",
        superpoder: bio.superpoder || "",
        frase: bio.frase || "",
        union: bio.union || ""
      },
      warning: null
    };
  }
  return { value: empty, warning: `Bio con tipo inesperado (${typeof bio}) — dejada vacía` };
}

function normalizeEmails(emails) {
  if (!emails) return { primary: null, all: [] };
  const arr = Array.isArray(emails) ? emails : [emails];
  const clean = arr.map(e => (e || "").toLowerCase().trim()).filter(Boolean);
  if (!clean.length) return { primary: null, all: [] };
  return { primary: clean[0], all: clean };
}

function normalizePhones(phones) {
  if (!phones) return [];
  const arr = Array.isArray(phones) ? phones : [phones];
  return arr.map(p => (p || "").trim()).filter(Boolean);
}

// ═══════════════════════════════════════════
// CONSTRUCCIÓN DEL PAYLOAD
// ═══════════════════════════════════════════

function buildUserPayload(member, roleEntry, actor) {
  const emails = normalizeEmails(member.email);
  const country = normalizeCountry(member.country);
  const role = normalizeRole(roleEntry);
  const bio = normalizeBio(member.bio);
  const phones = normalizePhones(member.phone);
  const excluded = EXCLUDED_NAMES.some(n => normName(n) === normName(member.name));
  const now = Timestamp.now();

  const warnings = [country.warning, role.warning, bio.warning].filter(Boolean);

  const payload = {
    identity: {
      name: member.name || "",
      photo: member.photo || "",
      country: country.value,
      birthdate: member.birthdate || "",
      phones: phones,
      emails: emails.all,
      personalEmail: member.personalEmail || null
    },
    display: {
      jobTitle: member.role || "",
      bio: bio.value
    },
    access: {
      role: role.value,
      active: !excluded,
      updatedBy: actor,
      updatedAt: now
    },
    prefs: {
      theme: member.theme || null
    },
    meta: {
      createdAt: now,
      slug: slugifyName(member.name),
      excluded: excluded
    }
  };

  return { docId: emails.primary, payload, warnings, excluded };
}

// ═══════════════════════════════════════════
// CROSS: team + roles → rows
// ═══════════════════════════════════════════

async function loadSources() {
  const [teamSnap, rolesSnap] = await Promise.all([
    getDoc(doc(db, "shared", "team")),
    getDoc(doc(db, "shared", "roles"))
  ]);
  const members = teamSnap.exists() ? (teamSnap.data().members || []) : [];
  const rolesUsers = rolesSnap.exists() ? (rolesSnap.data().users || {}) : {};
  return { members, rolesUsers };
}

function crossData(members, rolesUsers, actor) {
  const rows = [];
  const seenEmails = new Set();

  members.forEach((member, idx) => {
    const emails = normalizeEmails(member.email);
    if (!emails.primary) {
      rows.push({
        status: "error",
        docId: null,
        name: member.name || `(miembro sin nombre #${idx})`,
        roleBefore: "—",
        roleAfter: "—",
        warnings: ["Miembro sin email — no se puede migrar"],
        payload: null
      });
      return;
    }

    const roleEntry = rolesUsers[emails.primary] ||
                      Object.entries(rolesUsers).find(([k]) => k.toLowerCase() === emails.primary)?.[1];
    const built = buildUserPayload(member, roleEntry, actor);

    const roleBefore = roleEntry
      ? (typeof roleEntry === "string" ? roleEntry : roleEntry.role)
      : "(sin rol)";

    rows.push({
      status: built.payload.access.role ? "ok" : "warning",
      docId: built.docId,
      name: member.name || "",
      roleBefore: roleBefore || "(sin rol)",
      roleAfter: built.payload.access.role || "(null — requiere edición)",
      warnings: built.warnings,
      payload: built.payload,
      excluded: built.excluded
    });
    seenEmails.add(emails.primary);
    emails.all.forEach(e => seenEmails.add(e));
  });

  const orphans = [];
  Object.entries(rolesUsers).forEach(([email, entry]) => {
    if (!seenEmails.has(email.toLowerCase())) {
      const roleName = typeof entry === "string" ? entry : entry?.role;
      orphans.push({ email, role: roleName });
    }
  });

  return { rows, orphans };
}

// ═══════════════════════════════════════════
// RENDERIZADO (DOM API — no innerHTML con datos)
// ═══════════════════════════════════════════

function makeChip(label, color, bg) {
  const chip = document.createElement("span");
  chip.style.cssText = `background:${bg}; color:${color}; padding:6px 12px; border-radius:20px; font-weight:600;`;
  chip.textContent = label;
  return chip;
}

function makeStatusChip(status) {
  const chip = document.createElement("span");
  chip.style.cssText = "padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600;";
  if (status === "ok") {
    chip.style.background = "#e8f5f0";
    chip.style.color = "#0f8054";
    chip.textContent = "OK";
  } else if (status === "warning") {
    chip.style.background = "#fef3e2";
    chip.style.color = "#c17a1a";
    chip.textContent = "WARN";
  } else {
    chip.style.background = "#fbe5e0";
    chip.style.color = "#a52917";
    chip.textContent = "ERR";
  }
  return chip;
}

function renderPreviewSummary(rows, orphans) {
  const ok = rows.filter(r => r.status === "ok").length;
  const warn = rows.filter(r => r.status === "warning").length;
  const err = rows.filter(r => r.status === "error").length;

  const el = document.getElementById("mig-preview-summary");
  el.style.display = "";
  el.replaceChildren();

  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex; gap:12px; flex-wrap:wrap; font-size:13px;";
  wrap.appendChild(makeChip(`✓ ${ok} listos para migrar`, "#0f8054", "#e8f5f0"));
  if (warn) wrap.appendChild(makeChip(`⚠ ${warn} con warnings`, "#c17a1a", "#fef3e2"));
  if (err) wrap.appendChild(makeChip(`✗ ${err} con errores`, "#a52917", "#fbe5e0"));
  if (orphans.length) wrap.appendChild(makeChip(`${orphans.length} huérfanos en roles`, "#4a5a6a", "#e5eaef"));
  el.appendChild(wrap);
}

function renderPreviewTable(rows, orphans) {
  const el = document.getElementById("mig-preview-table");
  el.style.display = "";
  el.replaceChildren();

  const container = document.createElement("div");
  container.style.cssText = "border:1px solid #e5eaef; border-radius:10px; overflow:hidden;";

  const table = document.createElement("table");
  table.style.cssText = "width:100%; border-collapse:collapse; font-size:13px;";

  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  trHead.style.background = "#f7f9fb";
  ["Estado", "Doc ID (email)", "Nombre", "Rol", "Warnings"].forEach(label => {
    const th = document.createElement("th");
    th.style.cssText = "padding:10px 12px; text-align:left; font-weight:600;";
    th.textContent = label;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach(r => {
    const tr = document.createElement("tr");

    const tdStatus = document.createElement("td");
    tdStatus.style.cssText = "padding:8px 12px; border-bottom:1px solid #f0f4f8;";
    tdStatus.appendChild(makeStatusChip(r.status));
    tr.appendChild(tdStatus);

    const tdDoc = document.createElement("td");
    tdDoc.style.cssText = "padding:8px 12px; border-bottom:1px solid #f0f4f8; font-family:'JetBrains Mono', monospace; font-size:11px;";
    tdDoc.textContent = r.docId || "—";
    tr.appendChild(tdDoc);

    const tdName = document.createElement("td");
    tdName.style.cssText = "padding:8px 12px; border-bottom:1px solid #f0f4f8;";
    tdName.textContent = r.name;
    if (r.excluded) {
      const excl = document.createElement("span");
      excl.style.cssText = "color:#a52917; font-size:11px; margin-left:6px;";
      excl.textContent = "(excluido)";
      tdName.appendChild(excl);
    }
    tr.appendChild(tdName);

    const tdRole = document.createElement("td");
    tdRole.style.cssText = "padding:8px 12px; border-bottom:1px solid #f0f4f8; font-family:'JetBrains Mono', monospace; font-size:12px; color:#6a7a8a;";
    tdRole.textContent = `${r.roleBefore} → `;
    const strong = document.createElement("strong");
    strong.style.color = "#06a3b6";
    strong.textContent = r.roleAfter;
    tdRole.appendChild(strong);
    tr.appendChild(tdRole);

    const tdWarn = document.createElement("td");
    tdWarn.style.cssText = "padding:8px 12px; border-bottom:1px solid #f0f4f8; font-size:11px; color:#c17a1a;";
    tdWarn.textContent = r.warnings.join("; ") || "—";
    tr.appendChild(tdWarn);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
  el.appendChild(container);

  if (orphans.length) {
    const details = document.createElement("details");
    details.style.marginTop = "16px";

    const summary = document.createElement("summary");
    summary.style.cssText = "cursor:pointer; font-weight:600; color:#4a5a6a;";
    summary.textContent = `Huérfanos: ${orphans.length} emails en shared/roles sin miembro en shared/team`;
    details.appendChild(summary);

    const ul = document.createElement("ul");
    ul.style.cssText = "margin:8px 0 0; font-family:'JetBrains Mono', monospace; font-size:12px;";
    orphans.forEach(o => {
      const li = document.createElement("li");
      li.textContent = `${o.email} → ${o.role || "(sin rol)"}`;
      ul.appendChild(li);
    });
    details.appendChild(ul);

    const note = document.createElement("p");
    note.className = "admin-note";
    note.style.margin = "8px 0 0";
    note.textContent = "Estos NO se van a migrar. Si alguno debe migrarse, agrégalo primero a shared/team.";
    details.appendChild(note);

    el.appendChild(details);
  }
}

function logLine(text, level = "info") {
  const el = document.getElementById("mig-execute-log");
  el.style.display = "";
  const colors = { info: "#4a5a6a", ok: "#0f8054", err: "#a52917", warn: "#c17a1a" };
  const icons = { info: "·", ok: "✓", err: "✗", warn: "⚠" };
  const line = document.createElement("div");
  line.style.color = colors[level] || colors.info;
  line.textContent = `${icons[level] || "·"} ${text}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ═══════════════════════════════════════════
// ACCIONES: backup / preview / execute
// ═══════════════════════════════════════════

async function runBackup() {
  const status = document.getElementById("mig-backup-status");
  status.textContent = "Descargando…";
  try {
    const { members, rolesUsers } = await loadSources();
    const backup = {
      exportedAt: new Date().toISOString(),
      exportedBy: auth.currentUser?.email || "unknown",
      shared_team: { members },
      shared_roles: { users: rolesUsers }
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hero-hub-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    status.textContent = `✓ Descargado (${members.length} miembros, ${Object.keys(rolesUsers).length} roles)`;
    status.style.color = "#0f8054";
  } catch (e) {
    console.error(e);
    status.textContent = "✗ Error: " + e.message;
    status.style.color = "#a52917";
    heroToast.error("No se pudo descargar el backup: " + e.message);
  }
}

let cachedPreview = null;

async function runPreview() {
  const btn = document.getElementById("mig-preview");
  btn.setAttribute("disabled", "");
  btn.textContent = "Ejecutando…";
  try {
    const actor = auth.currentUser?.email || "system";
    const { members, rolesUsers } = await loadSources();
    const { rows, orphans } = crossData(members, rolesUsers, actor);
    cachedPreview = { rows, orphans };
    renderPreviewSummary(rows, orphans);
    renderPreviewTable(rows, orphans);
    const execBtn = document.getElementById("mig-execute");
    execBtn.removeAttribute("disabled");
    execBtn.setAttribute("title", "");
    heroToast.success(`Preview listo: ${rows.length} miembros, ${orphans.length} huérfanos`);
  } catch (e) {
    console.error(e);
    heroToast.error("No se pudo generar preview: " + e.message);
  } finally {
    btn.removeAttribute("disabled");
    // Restaurar el label del botón (sin ícono — se refresca en el próximo refreshIcons)
    btn.textContent = "Ejecutar preview";
  }
}

async function runExecute() {
  if (!cachedPreview) {
    heroToast.error("Ejecuta primero un Preview");
    return;
  }
  const migratable = cachedPreview.rows.filter(r => r.status !== "error" && r.payload && r.docId);
  if (!migratable.length) {
    heroToast.error("No hay miembros migrables");
    return;
  }

  const ok1 = await heroConfirm({
    title: "Ejecutar migración a users/",
    message: `Vas a escribir ${migratable.length} documentos en la colección users/. Los datos viejos (shared/team y shared/roles) NO se borran. ¿Continuar?`,
    confirmLabel: "Continuar",
    variant: "warning"
  });
  if (!ok1) return;

  const ok2 = await heroConfirm({
    title: "¿Estás seguro?",
    message: "Se escribe con merge:true — los campos del payload sobreescriben, pero cualquier campo NO tocado por la migración se conserva. Re-ejecutarlo es seguro si falló a mitad.",
    confirmLabel: "Sí, ejecutar",
    variant: "danger"
  });
  if (!ok2) return;

  const btn = document.getElementById("mig-execute");
  btn.setAttribute("disabled", "");
  btn.textContent = "Ejecutando…";

  const logEl = document.getElementById("mig-execute-log");
  logEl.replaceChildren();
  logLine(`Iniciando migración de ${migratable.length} miembros…`, "info");

  let okCount = 0;
  let errCount = 0;
  for (const row of migratable) {
    try {
      await setDoc(doc(db, "users", row.docId), row.payload, { merge: true });
      okCount++;
      logLine(`${row.docId} → ${row.name}`, "ok");
    } catch (e) {
      errCount++;
      logLine(`${row.docId} → ${e.message}`, "err");
    }
  }

  logLine("─────────────────────────────────", "info");
  logLine(`Migración completada: ${okCount} OK, ${errCount} errores`, errCount ? "warn" : "ok");

  try {
    await logEvent(ACTIONS.USERS_MIGRATION, "users/", {
      total: migratable.length,
      ok: okCount,
      errors: errCount,
      orphans: cachedPreview.orphans.length
    });
  } catch (e) {
    console.warn("No se pudo escribir en audit-log:", e);
  }

  btn.removeAttribute("disabled");
  btn.textContent = "Ejecutar migración";

  if (errCount === 0) {
    heroToast.success(`Migración completada: ${okCount} docs escritos`);
  } else {
    heroToast.error(`Migración con errores: ${okCount} OK, ${errCount} fallaron`);
  }
}

// ═══════════════════════════════════════════
// INIT (idempotente)
// ═══════════════════════════════════════════

let _bound = false;

window.loadMigrationPanel = function() {
  if (_bound) return;
  _bound = true;

  const backupBtn = document.getElementById("mig-backup");
  const previewBtn = document.getElementById("mig-preview");
  const executeBtn = document.getElementById("mig-execute");

  if (backupBtn) backupBtn.addEventListener("click", runBackup);
  if (previewBtn) previewBtn.addEventListener("click", runPreview);
  if (executeBtn) executeBtn.addEventListener("click", runExecute);
};
