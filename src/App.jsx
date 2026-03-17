import { useState, useRef, useEffect } from "react";
import { supabase } from "./supabase.js";

// ─── THEME ────────────────────────────────────────────────────────────────────
const T = {
  bg:       "#F4EFE9",   // warm greige background
  surface:  "#FFFFFF",
  surface2: "#EDE8E1",
  border:   "#D9D1C7",
  border2:  "#C9BFB4",
  text:     "#2A2018",
  text2:    "#7A6B5E",
  text3:    "#A89B8E",
  pink:     "#D4175A",   // Foppo-style primary pink
  pinkBg:   "#FAE8EF",
  pinkBd:   "#EAB8CB",
  green:    "#1F8A55",
  greenBg:  "#E6F5EE",
  blue:     "#1A5FAB",
  blueBg:   "#E8F0FA",
  amber:    "#C47A10",
  amberBg:  "#FDF3E0",
  red:      "#C0252A",
  redBg:    "#FAE8E8",
  purple:   "#7340AB",
  purpleBg: "#F0E8FA",
  orange:   "#C4520F",
  orangeBg: "#FAF0E6",
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const VAT_RATE   = 0.255;
const SHOP_NAME  = "Foppo Älylaitehuolto";
const SHOP_BRAND = "Foppo";
const SHOP_ADDR  = "Munkinmäentie 29, 02400 Kirkkonummi";
const SHOP_TEL   = "+358 10 200 1610";
const SHOP_EMAIL = "info@foppo.fi";
const SHOP_BIZ   = "Y-tunnus: 2847826-8";


// ─── DEFAULT MESSAGE TEMPLATES ────────────────────────────────────────────────
const DEFAULT_TEMPLATES = {
  part_arrived: {
    email_subject: "Part arrived — Ticket {tid}",
    email_body: "Hi {name},\n\nGreat news! The part for your {device} repair has arrived and we'll get started shortly.\n\nTicket: {tid}\n\nIf you have any questions, don't hesitate to reach out.\n\nBest regards,\n{shop}",
    sms: "{shop}: Part arrived! Your {device} repair will begin shortly. Ticket: {tid}",
  },
  accessory_arrived: {
    email_subject: "Your accessory has arrived — Ticket {tid}",
    email_body: "Hi {name},\n\nYour accessory for {device} has arrived and is ready for collection.\n\nTicket: {tid}\n\nBest regards,\n{shop}",
    sms: "{shop}: Your accessory has arrived! Ticket: {tid}",
  },
  ready_for_pickup: {
    email_subject: "Your device is ready — Ticket {tid}",
    email_body: "Hi {name},\n\nYour {device} has been repaired and is ready for collection!\n\nLocation:\n{shop_addr}\nHours: Mon–Fri 9–18, Sat 10–15\n\nPlease bring this message and a photo ID.\n\nTicket: {tid}\n\nThank you for choosing {shop}!\n\nBest regards,\n{shop}",
    sms: "{shop}: Your {device} is ready! Come pick it up: {shop_addr}. Ticket: {tid}",
  },
};

function applyVars(str, vars) {
  return str
    .replace(/{name}/g,      vars.name)
    .replace(/{device}/g,    vars.device)
    .replace(/{tid}/g,       vars.tid)
    .replace(/{shop}/g,      vars.shop)
    .replace(/{shop_addr}/g, vars.shop_addr);
}

// ─── MESSAGE TEMPLATES ────────────────────────────────────────────────────────
function buildMessage(template_key, channel, customer, ticket, templates) {
  const tmpl   = templates || DEFAULT_TEMPLATES;
  const device = `${ticket?.device_manufacturer || ""} ${ticket?.device_model || ""}`.trim();
  const vars   = { name: customer?.name?.split(" ")[0] || "Customer", device, tid: ticket?.id || "", shop: SHOP_NAME, shop_addr: SHOP_ADDR };
  const t = tmpl[template_key];
  if (!t) return channel === "email"
    ? { subject: `Update — ${vars.tid}`, body: `Ticket ${vars.tid} updated.` }
    : `${SHOP_NAME}: Ticket ${vars.tid} updated.`;
  if (channel === "email") return { subject: applyVars(t.email_subject, vars), body: applyVars(t.email_body, vars) };
  return applyVars(t.sms, vars);
}

const WARRANTY_OPTIONS = [
  { value:3,  label:"3 months" },
  { value:6,  label:"6 months" },
  { value:12, label:"12 months" },
  { value:24, label:"24 months" },
];

const REPAIR_TYPES = [
  { value:"screen_repair",        label:"Screen repair"          },
  { value:"battery_change",       label:"Battery change"         },
  { value:"charging_port_repair", label:"Charging port repair"   },
  { value:"camera_lens_repair",   label:"Camera lens repair"     },
  { value:"water_damage",         label:"Water damage treatment" },
  { value:"software_issue",       label:"Software / OS issue"    },
  { value:"speaker_microphone",   label:"Speaker / Microphone"   },
  { value:"other",                label:"Other (describe below)" },
];

function exVat(t)  { return t / (1 + VAT_RATE); }
function vatAmt(t) { return t - exVat(t); }
function fmtEur(n) { return `€${Number(n || 0).toFixed(2).replace(".", ",")}`; }
function fmtDate(iso, long) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fi-FI", long
    ? { year:"numeric", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit" }
    : { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
}
function genId(p) { return `${p}-${Math.random().toString(36).slice(2,8).toUpperCase()}`; }
function getStatus(k) { return STATUSES.find(s => s.key === k) || STATUSES[0]; }

// ─── DEVICE MODELS — SEED DATA ───────────────────────────────────────────────
// This is the initial dataset. In production this lives in a database table:
//   device_models(id, category, brand, model_name, sort_order)
// sort_order uses steps of 10 to leave room for insertions.
// All device models are now managed in Supabase (device_models table)
// Use SQL files in the project to add/update models
const SEED_MODELS = [];

// ─── DEVICE MODELS API ────────────────────────────────────────────────────────
// ✦ SUPABASE SWAP GUIDE ✦
// To connect a real backend, replace ONLY the bodies of these two functions.
// All component logic above stays identical.
//
// fetchModels():
//   const { data } = await supabase.from('device_models').select('*').order('sort_order');
//   return data;
//
// saveModels(models):
//   // Upsert changed rows, delete removed ones
//   const { error } = await supabase.from('device_models').upsert(models, { onConflict: 'id' });
//   const currentIds = models.map(m => m.id);
//   await supabase.from('device_models').delete().not('id', 'in', `(${currentIds.join(',')})`);

async function fetchModels() {
  const { data, error } = await supabase.from("device_models").select("*").order("sort_order");
  if (error) console.error("fetchModels:", error);
  const custom = (data || []).filter(m => !m.id.startsWith("seed_"));
  // Merge: seeds first, then custom models appended at end
  return [...SEED_MODELS, ...custom];
}

async function saveModels(models) {
  // Only save custom (non-seed) models to Supabase
  // We ONLY upsert — never delete — to avoid wiping SQL-inserted models
  const custom = (models || []).filter(m => !m.id.startsWith("seed_"));
  if (custom.length === 0) return;
  const { error } = await supabase.from("device_models").upsert(custom, { onConflict: "id" });
  if (error) console.error("saveModels upsert:", error);
}

async function deleteModel(modelId) {
  // Explicit single-row delete — only called when user removes a model
  if (!modelId || modelId.startsWith("seed_")) return;
  const { error } = await supabase.from("device_models").delete().eq("id", modelId);
  if (error) console.error("deleteModel:", error);
}

const CATEGORIES = ["Phone", "Tablet", "Computer", "Other"];
const CAT_ICON   = { Phone:"📱", Tablet:"⬛", Computer:"💻", Other:"🔧" };

const STATUSES = [
  { key:"intake",             label:"Intake",             color:T.text3,   bg:T.surface2 },
  { key:"diagnosis",          label:"Diagnosis",          color:T.amber,   bg:T.amberBg  },
  { key:"part_ordered",       label:"Part Ordered",       color:T.blue,    bg:T.blueBg   },
  { key:"part_arrived",       label:"Part Arrived",       color:T.purple,  bg:T.purpleBg },
  { key:"repair_in_progress", label:"Repair In Progress", color:T.orange,  bg:T.orangeBg },
  { key:"ready_for_pickup",   label:"Ready for Pickup",   color:T.green,   bg:T.greenBg  },
  { key:"closed",             label:"Closed",             color:T.text3,   bg:T.surface2 },
];
const PART_STATUS_ORDER = ["pending","ordered","arrived"];
const WORKFLOW_PRESETS = [
  { key:"intake",             label:"Intake",          desc:"Normal flow, awaiting diagnosis",   icon:"📥" },
  { key:"diagnosis",          label:"Diagnosis",       desc:"Device already being examined",     icon:"🔍" },
  { key:"repair_in_progress", label:"Repair queue",    desc:"Part in stock, start immediately",  icon:"🔧" },
  { key:"part_ordered",       label:"Part ordered",    desc:"Part already ordered before ticket", icon:"📦" },
  { key:"ready_for_pickup",   label:"Ready for pickup",desc:"Repair done, customer can collect", icon:"✅" },
];


// ─── PRINT (note: opens popup — blocked in artifact preview, works in real browser) ──
function buildReceiptHtml(ticket, customer, parts, mode) {
  const isThermal  = mode === "thermal";
  const isAcc      = ticket.type === "accessory";
  const accentHex  = isAcc ? "#7C3AED" : "#D4175A";
  const w          = isThermal ? "302px" : "210mm";
  const ex         = exVat(ticket.initial_quote), vat = vatAmt(ticket.initial_quote);
  const partsRows  = parts.map(p => `<tr><td>${p.part_name}</td><td style="text-align:right">${p.qty}×</td><td style="text-align:right">${fmtEur(p.cost * p.qty * (1+VAT_RATE))}</td></tr>`).join("");
  const warrantyLine = (!isAcc && ticket.warranty_months) ? `<div style="margin-top:8px;font-weight:600;">Warranty: ${ticket.warranty_months} months from repair date</div>` : "";

  // Body content differs by type
  const accItemsList = (ticket.acc_items || []);
  const accItemRows = accItemsList.map(i =>
    `<tr><td>${i.item}${i.color ? " <span style='color:#777;font-size:.9em'>– "+i.color+"</span>" : ""}</td><td style="text-align:right;color:#777">${i.qty}×</td><td style="text-align:right">${fmtEur(i.price_incl_vat*(i.qty||1))}</td></tr>`
  ).join("");
  const bodyContent = isAcc ? `
  <div class="lbl">Accessory Order</div>
  ${ticket.device_model ? `<div class="val" style="color:#555;margin-bottom:6px">For: ${ticket.device_manufacturer ? ticket.device_manufacturer+" " : ""}${ticket.device_model}</div>` : ""}
  <div class="hr-dash"/>
  <div class="lbl">Items</div>
  <table><tbody>${accItemRows}</tbody></table>
  ${ticket.acc_notes ? `<div class="lbl" style="margin-top:8px">Notes</div><div class="val" style="color:#444">${ticket.acc_notes}</div>` : ""}
  ` : `
  <div class="lbl">Device</div>
  <div class="val" style="font-weight:600">${ticket.device_manufacturer} ${ticket.device_model}</div>
  ${ticket.serial_imei ? `<div style="font-family:monospace;font-size:10px;color:#555;margin-bottom:4px">S/N: ${ticket.serial_imei}</div>` : ""}
  <div class="lbl" style="margin-top:6px">Reported issue</div>
  <div class="val">${ticket.issue_desc}</div>
  ${ticket.technician_notes ? `<div class="lbl" style="margin-top:4px">Technician notes</div><div class="val" style="color:#444">${ticket.technician_notes.replace(/\n/g,"<br/>")}</div>` : ""}
  ${warrantyLine}
  ${parts.length ? `<div class="hr-dash"/><div class="lbl">Parts / Materials</div><table><tbody>${partsRows}</tbody></table>` : ""}
  `;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{width:${w};margin:0 auto;padding:${isThermal?"10px 8px":"20mm"};font-family:Georgia,serif;font-size:${isThermal?"11px":"12px"};color:#1a1a1a;background:#fff}
    .logo{font-family:sans-serif;font-weight:800;font-size:${isThermal?"15px":"20px"};color:${accentHex};margin-bottom:2px}
    .type-badge{display:inline-block;font-family:sans-serif;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;background:${accentHex}18;color:${accentHex};border:1px solid ${accentHex}44;border-radius:4px;padding:2px 7px;margin-bottom:${isThermal?"6px":"10px"}}
    .sub{font-size:${isThermal?"9px":"10px"};color:#666;margin-bottom:${isThermal?"8px":"14px"};line-height:1.5}
    hr{border:none;border-top:1px solid #ccc;margin:${isThermal?"7px 0":"12px 0"}}
    .hr-dash{border:none;border-top:1px dashed #ccc;margin:${isThermal?"7px 0":"12px 0"}}
    .lbl{font-family:sans-serif;font-size:${isThermal?"8px":"9px"};text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:2px}
    .val{font-size:${isThermal?"11px":"12px"};margin-bottom:6px;line-height:1.5}
    table{width:100%;border-collapse:collapse;font-size:${isThermal?"10px":"11px"}}
    .tot td{font-weight:700;font-size:${isThermal?"13px":"14px"};padding-top:6px;border-top:2px solid #1a1a1a}
    .foot{text-align:center;font-size:9px;color:#888;margin-top:16px;line-height:1.6}
    @media print{body{margin:0;padding:${isThermal?"8px":"12mm"}}}
  </style></head><body>
  <div class="logo">${isAcc?"📦":"⚙"} ${SHOP_NAME}</div>
  <div class="type-badge">${isAcc ? "Accessory Order" : "Repair Ticket"}</div>
  <div class="sub">${SHOP_ADDR}<br>${SHOP_TEL} · ${SHOP_EMAIL}<br>${SHOP_BIZ}</div>
  <hr/>
  <div style="display:flex;justify-content:space-between;margin-bottom:8px">
    <div><div class="lbl">Ticket</div><div style="font-family:monospace;font-weight:700;font-size:${isThermal?"13px":"16px"}">${ticket.id}</div></div>
    <div style="text-align:right"><div class="lbl">Date</div><div class="val">${fmtDate(new Date().toISOString(), true)}</div></div>
  </div>
  <div class="hr-dash"/>
  <div class="lbl">Customer</div>
  <div class="val" style="font-weight:600">${customer.name}</div>
  <div class="val" style="color:#444">${customer.email || ""}${customer.email && customer.phone ? " · " : ""}${customer.phone || ""}</div>
  <div class="hr-dash"/>
  ${bodyContent}
  <hr/>
  <table><tbody>
    <tr><td style="color:#555">Price (excl. VAT)</td><td style="text-align:right;color:#555">${fmtEur(ex)}</td></tr>
    <tr><td style="color:#555">VAT ${(VAT_RATE * 100).toFixed(1)}%</td><td style="text-align:right;color:#555">${fmtEur(vat)}</td></tr>
    <tr class="tot"><td>Total (incl. VAT)</td><td style="text-align:right;color:${accentHex}">${fmtEur(ticket.initial_quote)}</td></tr>
  </tbody></table>
  <div class="foot">Thank you! · ${SHOP_NAME}<br>${SHOP_ADDR}</div>
  <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),800);}<\/script>
  </body></html>`;
}
function printReceipt(ticket, customer, parts, mode) {
  const w = window.open("", "_blank", mode === "thermal" ? "width=360,height=700" : "width=900,height=750");
  if (!w) { alert("Salli ponnahdusikkunat selaimessa tulostusta varten."); return; }
  w.document.write(buildReceiptHtml(ticket, customer, parts, mode));
  w.document.close();
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div style={{ position:"fixed", bottom:24, right:24, zIndex:9999, display:"flex", flexDirection:"column", gap:8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background:t.type==="success"?T.green:t.type==="warn"?T.amber:T.red, color:"#fff", padding:"10px 16px", borderRadius:8, fontSize:13, maxWidth:320, boxShadow:"0 4px 16px rgba(0,0,0,.15)", animation:"slideIn .3s ease" }}>
          {t.type==="success"?"✓ ":t.type==="warn"?"⚠ ":"✗ "}{t.msg}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status, small }) {
  const s = getStatus(status);
  return <span style={{ display:"inline-block", background:s.bg, color:s.color, border:`1px solid ${s.color}33`, borderRadius:4, padding:small?"1px 7px":"3px 10px", fontSize:small?9:11, fontWeight:700, letterSpacing:".05em", textTransform:"uppercase", whiteSpace:"nowrap" }}>{s.label}</span>;
}
function PartBadge({ status }) {
  const cfg = { pending:{bg:T.surface2,c:T.text2,l:"Pending"}, ordered:{bg:T.blueBg,c:T.blue,l:"Ordered"}, arrived:{bg:T.greenBg,c:T.green,l:"Arrived"} }[status] || { bg:T.surface2,c:T.text2,l:status };
  return <span style={{ background:cfg.bg, color:cfg.c, border:`1px solid ${cfg.c}33`, borderRadius:4, padding:"2px 8px", fontSize:10, fontWeight:700, letterSpacing:".06em", textTransform:"uppercase" }}>{cfg.l}</span>;
}

// ─── CUSTOMER SEARCH ──────────────────────────────────────────────────────────
function CustomerSearch({ customers, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ]       = useState("");
  const ref = useRef(null);
  const sel = customers.find(c => c.id === value);

  useEffect(() => {
    function h(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = customers.filter(c => {
    const s = q.toLowerCase();
    return !s || c.name.toLowerCase().includes(s) || c.email.toLowerCase().includes(s) || c.phone.includes(s);
  });

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <div onClick={() => setOpen(o => !o)} style={{ ...inp(), display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", userSelect:"none" }}>
        <span style={{ color:sel?T.text:T.text3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {sel ? `${sel.name}  —  ${sel.email}` : "Select existing customer…"}
        </span>
        <span style={{ color:T.text3, fontSize:10, flexShrink:0, marginLeft:8 }}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:T.surface, border:`1px solid ${T.border2}`, borderRadius:8, zIndex:999, boxShadow:"0 8px 28px rgba(0,0,0,.12)", maxHeight:280, display:"flex", flexDirection:"column" }}>
          <div style={{ padding:8, borderBottom:`1px solid ${T.border}` }}>
            <input autoFocus placeholder="Search by name, email or phone…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inp(), width:"100%" }} />
          </div>
          <div style={{ overflowY:"auto" }}>
            {!filtered.length && <div style={{ padding:"12px 14px", color:T.text3, fontSize:12 }}>No results</div>}
            {filtered.map(c => (
              <div key={c.id} onClick={() => { onChange(c.id); setOpen(false); setQ(""); }}
                style={{ padding:"9px 14px", cursor:"pointer", borderBottom:`1px solid ${T.border}`, background:c.id===value?T.surface2:"transparent" }}
                onMouseEnter={e => e.currentTarget.style.background=T.surface2}
                onMouseLeave={e => e.currentTarget.style.background=c.id===value?T.surface2:"transparent"}>
                <div style={{ fontSize:13, color:T.text, fontWeight:500 }}>{c.name}</div>
                <div style={{ fontSize:11, color:T.text2, marginTop:1 }}>{c.email}  ·  {c.phone}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DEVICE SELECTOR ──────────────────────────────────────────────────────────
// allModels: [{ id, category, brand, model_name, sort_order }]  (lifted to App)
// setAllModels: setter for the above
//
// The "Other" brand sentinel uses manufacturer === "__other__" with a
// customBrand string for free-text entry.

function DeviceSelector({ value, onChange, allModels, setAllModels }) {
  // ── loading state (only while initial fetch is in flight) ──
  const [loading,      setLoading]      = useState(allModels === null);

  // ── manager UI state ──
  const [showManager,  setShowManager]  = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [savedFlash,   setSavedFlash]   = useState(false);

  // ── inline-edit: id of row being edited, draft text ──
  const [editId,       setEditId]       = useState(null);
  const [editDraft,    setEditDraft]    = useState("");

  // ── add-new state ──
  const [newName,      setNewName]      = useState("");
  const [insertAfterId,setInsertAfterId]= useState("__top__");

  // ── "Other" brand free-text ──
  const [customBrand,  setCustomBrand]  = useState(value.customBrand || "");

  // ── fetch on mount if not yet loaded ──
  useEffect(() => {
    if (allModels !== null) return;      // already loaded by a previous mount
    fetchModels().then(rows => {
      setAllModels(rows);
      setLoading(false);
    });
  }, []);

  // ── derived values ──
  const cat        = value.category;
  const mfr        = value.manufacturer;
  const isOtherCat = cat === "Other";
  const isOtherMfr = mfr === "__other__";

  // Brands present for the selected category (derived from live data)
  const brandsForCat = allModels
    ? [...new Set(
        allModels
          .filter(r => r.category === cat)
          .map(r => r.brand)
      )]
    : [];

  // Models for the selected cat+brand, sorted by sort_order
  const modelsForBrand = allModels
    ? allModels
        .filter(r => r.category === cat && r.brand === mfr)
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
    : [];

  // ── helpers ──
  function setField(field, val) {
    if (field === "category")
      onChange({ category:val, manufacturer:"", model:"", customModel:"", customBrand:"" });
    else if (field === "manufacturer")
      onChange({ ...value, manufacturer:val, model:"", customModel:"" });
    else
      onChange({ ...value, [field]:val });
  }

  function reassignSortOrders(list) {
    // Compact sort_orders after any reorder/insert so gaps stay tidy
    return list.map((m, i) => ({ ...m, sort_order: (i + 1) * 10 }));
  }

  function updateBrandModels(newList) {
    // Replace all rows for this cat+brand with newList, keep everything else
    const others = (allModels || []).filter(r => !(r.category === cat && r.brand === mfr));
    setAllModels([...others, ...reassignSortOrders(newList)]);
  }

  // ── Add new model ──
  function addModel() {
    const name = newName.trim();
    if (!name || !cat || !mfr || isOtherCat || isOtherMfr) return;
    const entry = { id: genId("mdl"), category: cat, brand: mfr, model_name: name, sort_order: 0 };
    let updated;
    if (insertAfterId === "__top__") {
      updated = [entry, ...modelsForBrand];
    } else {
      const idx = modelsForBrand.findIndex(m => m.id === insertAfterId);
      updated = idx >= 0
        ? [...modelsForBrand.slice(0, idx+1), entry, ...modelsForBrand.slice(idx+1)]
        : [...modelsForBrand, entry];
    }
    updateBrandModels(updated);
    onChange({ ...value, model: name });
    setNewName(""); setInsertAfterId("__top__");
  }

  // ── Move model up/down ──
  function moveModel(idx, dir) {
    const list = modelsForBrand.slice();
    const swap = idx + dir;
    if (swap < 0 || swap >= list.length) return;
    [list[idx], list[swap]] = [list[swap], list[idx]];
    updateBrandModels(list);
  }

  // ── Commit inline edit ──
  function commitEdit(id) {
    const name = editDraft.trim();
    if (!name) { setEditId(null); return; }
    const updated = modelsForBrand.map(m => m.id === id ? { ...m, model_name: name } : m);
    updateBrandModels(updated);
    // Keep selection in sync if the edited model was selected
    if (value.model === modelsForBrand.find(m => m.id === id)?.model_name)
      onChange({ ...value, model: name });
    setEditId(null);
  }

  // ── Delete model ──
  function deleteModel(id) {
    const row = modelsForBrand.find(m => m.id === id);
    updateBrandModels(modelsForBrand.filter(m => m.id !== id));
    if (row && value.model === row.model_name) onChange({ ...value, model: "" });
    // Explicitly delete from Supabase immediately
    if (id && !id.startsWith("seed_")) {
      supabase.from("device_models").delete().eq("id", id).then(({ error }) => {
        if (error) console.error("deleteModel:", error);
      });
    }
  }

  // ── Save to backend ──
  async function handleSave() {
    if (!allModels) return;
    setSaving(true);
    await saveModels(allModels);
    setSaving(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }

  // ── Render ──
  if (loading) {
    return <div style={{ color:T.text3, fontSize:12, padding:"20px 0" }}>Loading models…</div>;
  }

  return (
    <div style={{ display:"grid", gap:12 }}>

      {/* ── Level 1: Category ── */}
      <div>
        <FL>Device category *</FL>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
          {CATEGORIES.map(c => (
            <button key={c} type="button" onClick={() => setField("category", c)}
              style={{ padding:"9px 4px", borderRadius:7, border:`1px solid ${cat===c?T.pink:T.border}`,
                background:cat===c?T.pinkBg:T.surface2, color:cat===c?T.pink:T.text2,
                fontSize:12, fontWeight:700, cursor:"pointer", textAlign:"center", transition:"all .15s" }}>
              {CAT_ICON[c]}<br/><span style={{ fontSize:11 }}>{c}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Level 2: Brand (Phone / Tablet / Computer) ── */}
      {cat && !isOtherCat && (
        <div>
          <FL>Brand *</FL>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {brandsForCat.map(b => (
              <button key={b} type="button" onClick={() => setField("manufacturer", b)}
                style={{ padding:"5px 14px", borderRadius:6, border:`1px solid ${mfr===b?T.pink:T.border}`,
                  background:mfr===b?T.pinkBg:T.surface2, color:mfr===b?T.pink:T.text2,
                  fontSize:12, fontWeight:600, cursor:"pointer", transition:"all .15s" }}>
                {b}
              </button>
            ))}
            <button type="button" onClick={() => { setField("manufacturer","__other__"); setCustomBrand(""); }}
              style={{ padding:"5px 14px", borderRadius:6, border:`1px solid ${isOtherMfr?T.pink:T.border}`,
                background:isOtherMfr?T.pinkBg:T.surface2, color:isOtherMfr?T.pink:T.text2,
                fontSize:12, fontWeight:600, cursor:"pointer" }}>
              🔧 Other
            </button>
          </div>
          {isOtherMfr && (
            <input autoFocus placeholder="Enter brand name…" value={customBrand}
              onChange={e => { setCustomBrand(e.target.value); onChange({ ...value, manufacturer:"__other__", customBrand:e.target.value }); }}
              style={{ ...inp(), marginTop:8 }} />
          )}
        </div>
      )}

      {/* ── Level 3: Model (known brand) ── */}
      {cat && !isOtherCat && mfr && !isOtherMfr && (
        <div>
          {/* Header row */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
            <FL>Model *</FL>
            <button type="button" onClick={() => setShowManager(v => !v)}
              style={{ fontSize:11, background:showManager?T.pinkBg:T.surface2,
                border:`1px solid ${showManager?T.pink:T.border}`, borderRadius:5,
                padding:"2px 10px", color:showManager?T.pink:T.text2, fontWeight:700, cursor:"pointer" }}>
              {showManager ? "✕ Close" : "⚙ Manage models"}
            </button>
          </div>

          {/* ── Model Manager panel ── */}
          {showManager && (
            <div style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:8, padding:14, marginBottom:10 }}>

              {/* Title + Save */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <div style={{ fontSize:12, fontWeight:700, color:T.text }}>
                  ⚙ Model Manager — {mfr}
                  <span style={{ fontWeight:400, color:T.text3, marginLeft:6 }}>({modelsForBrand.length} models)</span>
                </div>
                <button type="button" onClick={handleSave} disabled={saving}
                  style={{ background:savedFlash?T.green:T.blue, border:"none", borderRadius:6,
                    padding:"4px 14px", color:"#fff", fontWeight:700, fontSize:11,
                    opacity:saving?0.6:1, cursor:saving?"default":"pointer", minWidth:90 }}>
                  {saving ? "Saving…" : savedFlash ? "✓ Saved!" : "💾 Save changes"}
                </button>
              </div>

              {/* Add new model row */}
              <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"10px 12px", marginBottom:10 }}>
                <FL>Add new model</FL>
                <div style={{ display:"flex", gap:6, marginBottom:6 }}>
                  <input placeholder={`e.g. ${mfr === "Apple" ? "iPhone 17 Pro" : "New model name"}`}
                    value={newName} onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addModel()}
                    style={{ ...inp(), flex:1 }} />
                  <button type="button" onClick={addModel} disabled={!newName.trim()}
                    style={{ background:T.pink, border:"none", borderRadius:6, padding:"0 14px",
                      color:"#fff", fontWeight:700, fontSize:12, cursor:newName.trim()?"pointer":"default",
                      opacity:newName.trim()?1:0.5, flexShrink:0 }}>
                    + Add
                  </button>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:11, color:T.text2, flexShrink:0 }}>Insert after:</span>
                  <select value={insertAfterId} onChange={e => setInsertAfterId(e.target.value)}
                    style={{ ...inp(), fontSize:11, flex:1 }}>
                    <option value="__top__">↑ Top of list</option>
                    {modelsForBrand.map(m => (
                      <option key={m.id} value={m.id}>After: {m.model_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Unified models list: all models, all reorderable */}
              <div style={{ display:"flex", flexDirection:"column", gap:3, maxHeight:260, overflowY:"auto" }}>
                {modelsForBrand.length === 0 && (
                  <div style={{ fontSize:12, color:T.text3, textAlign:"center", padding:"16px 0" }}>
                    No models yet — add one above.
                  </div>
                )}
                {modelsForBrand.map((m, idx) => (
                  <div key={m.id}
                    style={{ display:"flex", alignItems:"center", gap:5,
                      background:T.surface, border:`1px solid ${T.border}`,
                      borderRadius:5, padding:"4px 8px" }}>

                    {/* Reorder */}
                    <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
                      <button type="button" onClick={() => moveModel(idx, -1)} disabled={idx === 0}
                        style={{ background:"none", border:"none", padding:"0 2px", fontSize:10,
                          color:idx===0?T.border:T.text2, cursor:idx===0?"default":"pointer", lineHeight:1 }}>▲</button>
                      <button type="button" onClick={() => moveModel(idx, +1)} disabled={idx === modelsForBrand.length-1}
                        style={{ background:"none", border:"none", padding:"0 2px", fontSize:10,
                          color:idx===modelsForBrand.length-1?T.border:T.text2,
                          cursor:idx===modelsForBrand.length-1?"default":"pointer", lineHeight:1 }}>▼</button>
                    </div>

                    {/* Name / inline edit */}
                    {editId === m.id ? (
                      <input autoFocus value={editDraft}
                        onChange={e => setEditDraft(e.target.value)}
                        onBlur={() => commitEdit(m.id)}
                        onKeyDown={e => { if (e.key==="Enter") commitEdit(m.id); if (e.key==="Escape") setEditId(null); }}
                        style={{ ...inp(), flex:1, fontSize:12, padding:"2px 6px" }} />
                    ) : (
                      <span style={{ flex:1, fontSize:12, color:T.text }}>{m.model_name}</span>
                    )}

                    {/* Sort position badge */}
                    <span style={{ fontSize:9, color:T.text3, fontFamily:"'IBM Plex Mono',monospace",
                      background:T.surface2, borderRadius:3, padding:"1px 4px", flexShrink:0 }}>
                      #{idx+1}
                    </span>

                    {/* Edit / Delete */}
                    {editId !== m.id && (
                      <button type="button" onClick={() => { setEditId(m.id); setEditDraft(m.model_name); }}
                        style={{ background:"none", border:"none", color:T.text2, cursor:"pointer",
                          padding:"0 3px", fontSize:11 }}>✎</button>
                    )}
                    <button type="button" onClick={() => deleteModel(m.id)}
                      style={{ background:"none", border:"none", color:T.red, cursor:"pointer",
                        padding:"0 3px", fontSize:12 }}>✕</button>
                  </div>
                ))}
              </div>

              <div style={{ fontSize:10, color:T.text3, marginTop:8 }}>
                Changes apply immediately in the dropdown. Click <b>Save changes</b> to persist to the database.
              </div>
            </div>
          )}

          {/* Model dropdown — single flat list sorted by sort_order */}
          <select value={value.model} onChange={e => setField("model", e.target.value)}
            style={{ ...inp(), width:"100%" }}>
            <option value="">Select model…</option>
            {modelsForBrand.map(m => (
              <option key={m.id} value={m.model_name}>{m.model_name}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── "Other" brand: free-text model ── */}
      {cat && !isOtherCat && isOtherMfr && (
        <div>
          <FL>Model *</FL>
          <input placeholder="Enter model name…" value={value.model||""}
            onChange={e => onChange({ ...value, model:e.target.value })}
            style={{ ...inp(), width:"100%" }} />
        </div>
      )}

      {/* ── "Other" category: full free text ── */}
      {isOtherCat && (
        <div>
          <FL>Device description *</FL>
          <input placeholder="e.g. DJI Mini 4 Pro drone, Kindle Paperwhite, smartwatch…"
            value={value.customModel || ""}
            onChange={e => onChange({ ...value, customModel:e.target.value, model:e.target.value })}
            style={{ ...inp(), width:"100%" }} />
        </div>
      )}

    </div>
  );
}

// ─── VAT BOX ─────────────────────────────────────────────────────────────────
function VatBox({ total, inline }) {
  const ex = exVat(total), vat = vatAmt(total);
  if (inline) return <span style={{ fontSize:11, color:T.text2 }}>{fmtEur(ex)} + ALV {(VAT_RATE*100).toFixed(1)}%</span>;
  return (
    <div style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:8, padding:"10px 14px", fontSize:12 }}>
      <R2 l={`Price (excl. VAT)`}            v={fmtEur(ex)} />
      <R2 l={`ALV ${(VAT_RATE*100).toFixed(1)}%`}   v={fmtEur(vat)} />
      <div style={{ height:1, background:T.border, margin:"6px 0" }}/>
      <R2 l="Total (incl. VAT)" v={fmtEur(total)} bold />
    </div>
  );
}
function R2({ l, v, bold }) {
  return <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
    <span style={{ color:T.text2 }}>{l}</span>
    <span style={{ color:bold?T.pink:T.text, fontWeight:bold?700:400 }}>{v}</span>
  </div>;
}

function PriceEditor({ ticket, save }) {
  const [editing, setEditing] = useState(false);
  const [val,     setVal]     = useState("");

  function open() { setVal(ticket.initial_quote > 0 ? String(ticket.initial_quote) : ""); setEditing(true); }
  function cancel() { setEditing(false); setVal(""); }
  function confirm() {
    const v = parseFloat(val) || 0;
    save("initial_quote", v);
    setEditing(false);
  }

  return (
    <div>
      <div style={{ fontSize:10, color:T.text3, letterSpacing:".07em", textTransform:"uppercase", marginBottom:6 }}>💶 Price (incl. 25.5% VAT)</div>
      {editing ? (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <input
            autoFocus
            type="number" step="0.01" min="0"
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key==="Enter") confirm(); if (e.key==="Escape") cancel(); }}
            placeholder="0.00"
            style={{ ...inp(), fontFamily:"'IBM Plex Mono',monospace", fontWeight:700, fontSize:15 }}
          />
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={confirm}
              style={{ flex:1, background:T.pink, color:"#fff", border:"none", borderRadius:7, padding:"7px 0", fontWeight:700, fontSize:13, cursor:"pointer" }}>
              ✓ Save price
            </button>
            <button onClick={cancel}
              style={{ background:T.surface2, color:T.text2, border:`1px solid ${T.border}`, borderRadius:7, padding:"7px 12px", fontSize:13, cursor:"pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
          <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:18, fontWeight:800, color:ticket.initial_quote>0?T.text:T.text3 }}>
            {ticket.initial_quote > 0 ? fmtEur(ticket.initial_quote) : "Not set"}
          </div>
          <button onClick={open}
            style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:7, padding:"5px 12px", fontSize:12, fontWeight:600, color:T.text2, cursor:"pointer" }}>
            ✏ Edit price
          </button>
        </div>
      )}
      {!editing && ticket.initial_quote > 0 && (
        <div style={{ marginTop:8 }}><VatBox total={ticket.initial_quote} /></div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// ─── SET PASSWORD SCREEN ──────────────────────────────────────────────────────
function SetPasswordScreen() {
  const [password,  setPassword]  = useState("");
  const [password2, setPassword2] = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [done,      setDone]      = useState(false);

  async function handleSet(e) {
    e.preventDefault();
    if (password.length < 6)        { setError("Password must be at least 6 characters"); return; }
    if (password !== password2)     { setError("Passwords don't match"); return; }
    setLoading(true); setError("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); setLoading(false); }
    else setDone(true);
  }

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'IBM Plex Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap'); *{box-sizing:border-box}`}</style>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:16, padding:"40px 44px", width:380, boxShadow:"0 8px 32px rgba(0,0,0,.08)" }}>
        <div style={{ marginBottom:28, textAlign:"center" }}>
          <div style={{ fontSize:28, fontWeight:800, color:T.pink, letterSpacing:"-.5px" }}>Foppo</div>
          <div style={{ fontSize:13, color:T.text3, marginTop:4 }}>Set your password to continue</div>
        </div>
        {done ? (
          <div style={{ textAlign:"center", color:T.green, fontSize:14, fontWeight:600 }}>✓ Password set! Taking you to the app…</div>
        ) : (
          <form onSubmit={handleSet}>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.text2, marginBottom:5 }}>New password</div>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoFocus
                placeholder="At least 6 characters"
                style={{ ...inp(), width:"100%", fontSize:14 }} />
            </div>
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.text2, marginBottom:5 }}>Confirm password</div>
              <input type="password" value={password2} onChange={e=>setPassword2(e.target.value)} required
                placeholder="Repeat password"
                style={{ ...inp(), width:"100%", fontSize:14 }} />
            </div>
            {error && (
              <div style={{ background:T.redBg, border:`1px solid ${T.red}44`, borderRadius:7, padding:"8px 12px", fontSize:12, color:T.red, marginBottom:14 }}>{error}</div>
            )}
            <button type="submit" disabled={loading}
              style={{ width:"100%", background:T.pink, border:"none", borderRadius:8, padding:"11px 0", color:"#fff", fontSize:14, fontWeight:700, opacity:loading?.6:1 }}>
              {loading ? "Saving…" : "Set password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); }
  }

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'IBM Plex Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap'); *{box-sizing:border-box}`}</style>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:16, padding:"40px 44px", width:380, boxShadow:"0 8px 32px rgba(0,0,0,.08)" }}>
        <div style={{ marginBottom:28, textAlign:"center" }}>
          <div style={{ fontSize:28, fontWeight:800, color:T.pink, letterSpacing:"-.5px" }}>Foppo</div>
          <div style={{ fontSize:13, color:T.text3, marginTop:4 }}>RepairFlow — sign in to continue</div>
        </div>
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, fontWeight:600, color:T.text2, marginBottom:5 }}>Email</div>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required
              placeholder="you@example.com" autoFocus
              style={{ ...inp(), width:"100%", fontSize:14 }} />
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:600, color:T.text2, marginBottom:5 }}>Password</div>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required
              placeholder="••••••••"
              style={{ ...inp(), width:"100%", fontSize:14 }} />
          </div>
          {error && (
            <div style={{ background:T.redBg, border:`1px solid ${T.red}44`, borderRadius:7, padding:"8px 12px", fontSize:12, color:T.red, marginBottom:14 }}>
              {error}
            </div>
          )}
          <button type="submit" disabled={loading}
            style={{ width:"100%", background:T.pink, border:"none", borderRadius:8, padding:"11px 0", color:"#fff", fontSize:14, fontWeight:700, opacity:loading?.6:1 }}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function RepairFlow() {
  // ── Auth session ────────────────────────────────────────────────────────────
  const [session,      setSession]      = useState(undefined);
  const [dbReady,      setDbReady]      = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);

  useEffect(() => {
    // Detect invite or password recovery links (hash contains type=invite or type=recovery)
    const hash = window.location.hash;
    if (hash.includes("type=invite") || hash.includes("type=recovery")) {
      setNeedsPassword(true);
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s ?? null);
      // Once password is set, clear the flag
      if (_e === "USER_UPDATED") setNeedsPassword(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const [tickets,        setTickets]       = useState([]);
  const [customers,      setCustomers]     = useState([]);
  const [parts,          setParts]         = useState([]);
  const [logs,           setLogs]          = useState([]);
  const [manualOrders,   setManualOrders]  = useState([]);
  const [allModels,      setAllModels]     = useState(null);
  const [view,           setView]          = useState("dashboard");
  const [activeTicket,   setActiveTicket]  = useState(null);
  const [toasts,         setToasts]        = useState([]);
  const [filterStatus,   setFilterStatus]  = useState("all");
  const [msgTemplates,   setMsgTemplates]  = useState(DEFAULT_TEMPLATES);
  const [technicians,    setTechnicians]   = useState([]);
  const [filterTech,     setFilterTech]    = useState("all");
  const [catalogue,      setCatalogue]     = useState([]);
  const [partCategories, setPartCategories]= useState([]);
  const [intakeLogs,     setIntakeLogs]    = useState([]);

  const hasLoadedRef = useRef(false);

  // ── Load all data from Supabase once session is ready ───────────────────────
  useEffect(() => {
    if (!session?.user?.id) return;
    if (hasLoadedRef.current) return; // never reload after first successful load
    hasLoadedRef.current = true;
    async function loadAll() {
      const [
        { data: tix },  { data: custs }, { data: ps },
        { data: ls },   { data: techs }, { data: cat },
        { data: cats },  { data: il }, { data: settings },
      ] = await Promise.all([
        supabase.from("tickets").select("*").order("created_at", { ascending: false }),
        supabase.from("customers").select("*").order("name"),
        supabase.from("parts").select("*"),
        supabase.from("logs").select("*").order("created_at", { ascending: false }),
        supabase.from("technicians").select("*"),
        supabase.from("catalogue").select("*").order("name"),
        supabase.from("part_categories").select("*").order("name"),
        supabase.from("intake_logs").select("*").order("created_at", { ascending: false }),
        supabase.from("settings").select("*"),
      ]);
      if (tix)   setTickets(tix);
      if (custs) setCustomers(custs);
      if (ps)    setParts(ps);
      if (ls)    setLogs(ls);
      if (techs) setTechnicians(techs);
      if (cat)   setCatalogue(cat.map(c => ({ ...c, compatible_models: c.compatible_models||[], compatible_categories: c.compatible_categories||[] })));
      if (cats)  setPartCategories(cats.map(c => c.name));
      if (il)    setIntakeLogs(il);
      // Load persisted message templates if they exist
      if (settings) {
        const tmplRow = settings.find(s => s.key === "msg_templates");
        if (tmplRow?.value) setMsgTemplates({ ...DEFAULT_TEMPLATES, ...tmplRow.value });
      }
      setDbReady(true);
    }
    loadAll();
  }, [session?.user?.id]);

  function toast(msg, type="success") {
    const id = Date.now(); setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }
  function openTicket(t) { setActiveTicket(t.id); setView("ticket"); }

  // ── Real notification sender ─────────────────────────────────────────────
  async function sendNotification(tmplKey, cust, ticket) {
    const channels = [...(cust.email?["email"]:[]), ...(cust.sms_opt_in?["sms"]:[])];
    if (!channels.length) channels.push("email");
    const results = [];
    for (const ch of channels) {
      const msg = buildMessage(tmplKey, ch, cust, ticket, msgTemplates);
      let deliveryStatus = "sent";
      try {
        if (ch === "email" && cust.email) {
          const r = await fetch("/api/send-email", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ to: cust.email, subject: msg.subject, body: msg.body }),
          });
          const d = await r.json();
          if (!r.ok) { console.error("Email failed:", d); deliveryStatus = "failed"; }
        } else if (ch === "sms" && cust.phone) {
          const r = await fetch("/api/send-sms", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ to: cust.phone, message: msg }),
          });
          const d = await r.json();
          if (!r.ok) { console.error("SMS failed:", d); deliveryStatus = "failed"; }
        }
      } catch(e) { console.error("Send error:", e); deliveryStatus = "failed"; }

      const logEntry = { id:genId("l"), ticket_id:ticket.id, customer_id:cust.id, channel:ch, template_key:tmplKey, message: ch==="email" ? `${msg.subject}\n\n${msg.body}` : msg, sent_at:new Date().toISOString(), status:deliveryStatus };
      setLogs(ls => [...ls, logEntry]);
      const { error: logErr } = await supabase.from("logs").insert(logEntry);
      if (logErr) console.error("log insert failed:", logErr);
      results.push({ ch, status: deliveryStatus });
    }
    const icons = results.map(r => (r.ch==="email"?"📧":"📱") + (r.status==="failed"?" ❌":"")).join(" ");
    return { icons, channels };
  }

  const NOTIFY_STATUSES = ["part_arrived", "ready_for_pickup"];

  async function updateTicketStatus(tid, newStatus) {
    setTickets(ts => ts.map(t => t.id===tid ? { ...t, status:newStatus } : t));
    await supabase.from("tickets").update({ status: newStatus }).eq("id", tid);
    const NOTIFY = ["part_arrived","ready_for_pickup"];
    if (NOTIFY.includes(newStatus)) {
      const ticket = tickets.find(t => t.id===tid);
      const cust   = ticket ? customers.find(c => c.id===ticket.customer_id) : null;
      if (cust) {
        const tmpl = newStatus==="ready_for_pickup" ? "ready_for_pickup" : "part_arrived";
        const { icons } = await sendNotification(tmpl, cust, ticket);
        toast(`${icons} Notification → ${cust.name}  (${newStatus==="ready_for_pickup"?"Ready for pickup":"Part arrived"})`, "success");
        return;
      }
    }
    toast(`Siirretty: "${getStatus(newStatus).label}"`);
  }

  async function deleteTicket(tid) {
    setTickets(ts => ts.filter(t => t.id!==tid));
    setParts(ps => ps.filter(p => p.ticket_id!==tid));
    setLogs(ls => ls.filter(l => l.ticket_id!==tid));
    if (activeTicket===tid) { setActiveTicket(null); setView("dashboard"); }
    await supabase.from("tickets").delete().eq("id", tid);
    toast("Ticket deleted", "warn");
  }

  async function updatePartStatus(partId, newStatus) {
    const part   = parts.find(p => p.id === partId);
    if (!part) return;
    const ticket = tickets.find(t => t.id === part.ticket_id);
    const cust   = ticket ? customers.find(c => c.id === ticket.customer_id) : null;

    const updatedParts = parts.map(p =>
      p.id === partId ? { ...p, part_status: newStatus, arrived_at: newStatus==="arrived" ? new Date().toISOString() : p.arrived_at } : p
    );
    setParts(updatedParts);
    await supabase.from("parts").update({ part_status: newStatus }).eq("id", partId);

    if (newStatus === "arrived" && ticket && cust) {
      const ticketParts = updatedParts.filter(p => p.ticket_id === ticket.id);
      const allArrived  = ticketParts.every(p => p.part_status === "arrived");
      const remaining   = ticketParts.filter(p => p.part_status !== "arrived").length;

      if (allArrived) {
        setTickets(ts => ts.map(t => t.id === ticket.id ? { ...t, status: "part_arrived" } : t));
        await supabase.from("tickets").update({ status: "part_arrived" }).eq("id", ticket.id);
        const tmpl = part.is_accessory ? "accessory_arrived" : "part_arrived";
        const { icons } = await sendNotification(tmpl, cust, ticket);
        toast(`${icons} All parts arrived — notified ${cust.name}`, "success");
      } else {
        toast(`Part marked arrived · ${remaining} part${remaining!==1?"s":""} still pending`);
      }
    }
  }

  // ── Supabase db helpers (passed to child views) ─────────────────────────────
  const db = {
    async saveTicket(t)   { const {error} = await supabase.from("tickets").upsert(t); if(error) console.error("saveTicket",error); },
    async saveCustomer(c) { const {error} = await supabase.from("customers").upsert(c); if(error) console.error("saveCustomer",error); },
    async savePart(p)     { const {error} = await supabase.from("parts").upsert(p); if(error) console.error("savePart",error); },
    async deletePart(id)  { const {error} = await supabase.from("parts").delete().eq("id",id); if(error) console.error("deletePart",error); },
    async saveCatalogueItem(c) { const {error} = await supabase.from("catalogue").upsert(c); if(error) console.error("saveCatalogueItem",error); },
    async deleteCatalogueItem(id) { const {error} = await supabase.from("catalogue").delete().eq("id",id); if(error) console.error("deleteCatalogueItem",error); },
    async saveTechnician(t)   { const {error} = await supabase.from("technicians").upsert(t); if(error) console.error("saveTechnician",error); },
    async deleteTechnician(id){ const {error} = await supabase.from("technicians").delete().eq("id",id); if(error) console.error("deleteTechnician",error); },
    async savePartCategory(name) { const {error} = await supabase.from("part_categories").upsert({name}); if(error) console.error("savePartCategory",error); },
    async deletePartCategory(name){ const {error} = await supabase.from("part_categories").delete().eq("name",name); if(error) console.error("deletePartCategory",error); },
    async saveIntakeLog(l) { const {error} = await supabase.from("intake_logs").insert(l); if(error) console.error("saveIntakeLog",error); },
    async saveSetting(key, value) { const {error} = await supabase.from("settings").upsert({ key, value }); if(error) console.error("saveSetting",error); },
  };

  const pendingCount = parts.filter(p => p.part_status==="pending").length + manualOrders.filter(m => m.status==="pending").length;
  const filteredTickets = tickets.filter(t => {
    const ms = filterStatus==="all" || t.status===filterStatus;
    const mt = filterTech==="all" || t.technician_id===filterTech || (filterTech==="unassigned" && !t.technician_id);
    return ms && mt;
  });

  // ── Auth gates ───────────────────────────────────────────────────────────────
  if (needsPassword) return <SetPasswordScreen />;
  if (session === undefined) return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'IBM Plex Sans',sans-serif" }}>
      <div style={{ fontSize:14, color:T.text3 }}>Loading…</div>
    </div>
  );
  if (!session) return <LoginScreen />;
  if (!dbReady) return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'IBM Plex Sans',sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:22, fontWeight:800, color:T.pink, marginBottom:8 }}>Foppo</div>
        <div style={{ fontSize:13, color:T.text3 }}>Loading data…</div>
      </div>
    </div>
  );

  return (
    <div style={{ display:"flex", height:"100vh", background:T.bg, color:T.text, fontFamily:"'IBM Plex Sans', sans-serif", overflow:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:${T.surface2}}
        ::-webkit-scrollbar-thumb{background:${T.border2};border-radius:3px}
        *{box-sizing:border-box} button{cursor:pointer;transition:opacity .15s} button:hover{opacity:.82}
        input,select,textarea{outline:none}
        @keyframes slideIn{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}
      `}</style>

      <Sidebar view={view} setView={setView} pendingCount={pendingCount} />

      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {/* Topbar */}
        <div style={{ padding:"0 24px", height:54, display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:`1px solid ${T.border}`, background:T.surface, flexShrink:0, boxShadow:"0 1px 3px rgba(0,0,0,.06)" }}>
          <span style={{ fontSize:12, color:T.text3 }}>
            {new Date().toLocaleDateString("fi-FI", { weekday:"long", year:"numeric", month:"long", day:"numeric" })}
            <span style={{ marginLeft:14, color:T.border2 }}>ALV {(VAT_RATE*100).toFixed(1)}%</span>
          </span>
          <div style={{ display:"flex", gap:10 }}>
            <GlobalSearch tickets={tickets} customers={customers} parts={parts} openTicket={openTicket} setView={setView} />
            <button onClick={() => setView("new_ticket")} style={{ background:T.pink, color:"#fff", border:"none", borderRadius:7, padding:"7px 18px", fontWeight:700, fontSize:13 }}>
              + New ticket
            </button>
            <button onClick={() => supabase.auth.signOut()} style={{ background:T.surface2, color:T.text2, border:`1px solid ${T.border}`, borderRadius:7, padding:"7px 14px", fontWeight:600, fontSize:12 }}>
              Sign out
            </button>
          </div>
        </div>

        <div style={{ flex:1, overflow:"auto" }}>
          {view==="dashboard"   && <DashboardView tickets={filteredTickets} customers={customers} parts={parts} openTicket={openTicket} filterStatus={filterStatus} setFilterStatus={setFilterStatus} updateTicketStatus={updateTicketStatus} deleteTicket={deleteTicket} technicians={technicians} filterTech={filterTech} setFilterTech={setFilterTech} />}
          {view==="ticket"      && <TicketView ticketId={activeTicket} tickets={tickets} customers={customers} parts={parts} logs={logs} setTickets={setTickets} setParts={setParts} updateTicketStatus={updateTicketStatus} updatePartStatus={updatePartStatus} deleteTicket={deleteTicket} toast={toast} technicians={technicians} catalogue={catalogue} setCatalogue={setCatalogue} allModels={allModels} setAllModels={setAllModels} db={db} />}
          {view==="parts_order" && <PartsOrderView tickets={tickets} setTickets={setTickets} customers={customers} parts={parts} updatePartStatus={updatePartStatus} manualOrders={manualOrders} setManualOrders={setManualOrders} toast={toast} catalogue={catalogue} setCatalogue={setCatalogue} db={db} sendNotification={sendNotification} />}
          {view==="templates"   && <TemplatesView msgTemplates={msgTemplates} setMsgTemplates={setMsgTemplates} db={db} />}
          {view==="settings"    && <SettingsView technicians={technicians} setTechnicians={setTechnicians} toast={toast} partCategories={partCategories} setPartCategories={setPartCategories} catalogue={catalogue} setCatalogue={setCatalogue} db={db} tickets={tickets} customers={customers} parts={parts} intakeLogs={intakeLogs} logs={logs} />}
          {view==="catalogue"   && <CatalogueView catalogue={catalogue} setCatalogue={setCatalogue} allModels={allModels} setAllModels={setAllModels} toast={toast} parts={parts} partCategories={partCategories} setPartCategories={setPartCategories} db={db} />}
          {view==="stock_intake" && <StockIntakeView catalogue={catalogue} setCatalogue={setCatalogue} partCategories={partCategories} intakeLogs={intakeLogs} setIntakeLogs={setIntakeLogs} toast={toast} allModels={allModels} setAllModels={setAllModels} db={db} />}
          {view==="customers"   && <CustomersView customers={customers} setCustomers={setCustomers} tickets={tickets} openTicket={openTicket} db={db} toast={toast} />}
          {view==="new_ticket"  && <NewTicketView customers={customers} setCustomers={setCustomers} tickets={tickets} setTickets={setTickets} toast={toast} setView={setView} setActiveTicket={setActiveTicket} allModels={allModels} setAllModels={setAllModels} db={db} />}
          {view==="logs"        && <LogsView logs={logs} tickets={tickets} customers={customers} />}
        </div>
      </div>
      <Toast toasts={toasts} />
    </div>
  );
}

// ─── GLOBAL SEARCH ────────────────────────────────────────────────────────────
function GlobalSearch({ tickets, customers, parts, openTicket, setView }) {
  const [q,       setQ]       = useState("");
  const [open,    setOpen]    = useState(false);
  const inputRef              = useRef(null);
  const boxRef                = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false); setQ("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const query = q.trim().toLowerCase();

  const matchedTickets = query.length < 1 ? [] : tickets.filter(t => {
    const c = customers.find(x => x.id === t.customer_id);
    return (
      t.id.toLowerCase().includes(query) ||
      t.device_model?.toLowerCase().includes(query) ||
      t.device_manufacturer?.toLowerCase().includes(query) ||
      t.issue_desc?.toLowerCase().includes(query) ||
      (c && c.name.toLowerCase().includes(query)) ||
      (c && c.phone?.toLowerCase().includes(query)) ||
      (c && c.email?.toLowerCase().includes(query))
    );
  }).slice(0, 6);

  const matchedCustomers = query.length < 1 ? [] : customers.filter(c =>
    !matchedTickets.some(t => t.customer_id === c.id) && (
      c.name.toLowerCase().includes(query) ||
      c.email?.toLowerCase().includes(query) ||
      c.phone?.toLowerCase().includes(query)
    )
  ).slice(0, 4);

  const hasResults = matchedTickets.length > 0 || matchedCustomers.length > 0;

  function handleKey(e) {
    if (e.key === "Escape") { setOpen(false); setQ(""); }
  }

  return (
    <div ref={boxRef} style={{ position:"relative", width:300 }}>
      <input
        ref={inputRef}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        placeholder="Search tickets, customers…"
        style={{ ...inp(), width:"100%", paddingLeft:32 }}
      />
      <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:T.text3, fontSize:14, pointerEvents:"none" }}>🔍</span>

      {open && q.length > 0 && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, right:0, background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,.12)", zIndex:999, overflow:"hidden", maxHeight:420, overflowY:"auto" }}>

          {!hasResults && (
            <div style={{ padding:"16px 14px", fontSize:13, color:T.text3, textAlign:"center" }}>No results for "{q}"</div>
          )}

          {matchedTickets.length > 0 && (
            <>
              <div style={{ padding:"8px 14px 4px", fontSize:10, fontWeight:700, color:T.text3, textTransform:"uppercase", letterSpacing:".07em", borderBottom:`1px solid ${T.border}` }}>Tickets</div>
              {matchedTickets.map(t => {
                const c = customers.find(x => x.id === t.customer_id);
                const st = getStatus(t.status);
                return (
                  <div key={t.id} onClick={() => { openTicket(t); setOpen(false); setQ(""); }}
                    style={{ padding:"10px 14px", cursor:"pointer", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:10 }}
                    onMouseEnter={e => e.currentTarget.style.background=T.surface2}
                    onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                    <span style={{ fontSize:10, fontWeight:700, color:T.text3, fontFamily:"'IBM Plex Mono',monospace", flexShrink:0 }}>{t.id}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                        {t.device_manufacturer} {t.device_model}
                      </div>
                      <div style={{ fontSize:11, color:T.text3 }}>{c?.name || "—"} · {t.issue_desc?.slice(0,40)}{t.issue_desc?.length>40?"…":""}</div>
                    </div>
                    <span style={{ fontSize:10, fontWeight:700, color:st.color, background:st.bg, border:`1px solid ${st.color}44`, borderRadius:4, padding:"2px 7px", flexShrink:0 }}>{st.label}</span>
                  </div>
                );
              })}
            </>
          )}

          {matchedCustomers.length > 0 && (
            <>
              <div style={{ padding:"8px 14px 4px", fontSize:10, fontWeight:700, color:T.text3, textTransform:"uppercase", letterSpacing:".07em", borderBottom:`1px solid ${T.border}` }}>Customers</div>
              {matchedCustomers.map(c => {
                const ticketCount = tickets.filter(t => t.customer_id === c.id).length;
                return (
                  <div key={c.id} onClick={() => { setView("customers"); setOpen(false); setQ(""); }}
                    style={{ padding:"10px 14px", cursor:"pointer", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:10 }}
                    onMouseEnter={e => e.currentTarget.style.background=T.surface2}
                    onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                    <span style={{ width:32, height:32, borderRadius:"50%", background:T.pinkBg, border:`1px solid ${T.pinkBd}`, display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:T.pink, flexShrink:0 }}>
                      {c.name.charAt(0).toUpperCase()}
                    </span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:T.text }}>{c.name}</div>
                      <div style={{ fontSize:11, color:T.text3 }}>{c.phone || c.email || "—"} · {ticketCount} ticket{ticketCount!==1?"s":""}</div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CATALOGUE ROW (used in TicketView part picker) ───────────────────────────
function CatPartRow({ part, onAdd, available: avail }) {
  const [qty, setQty] = useState(1);
  const stock   = avail !== undefined ? avail : part.stock_qty;
  const low     = stock > 0 && stock <= part.min_stock;
  const out     = stock <= 0;
  const stockColor = stock < 0 ? T.red : out ? T.red : low ? T.amber : T.green;
  const stockLabel = stock < 0 ? `${stock} (shortage)` : out ? "Out of stock" : `${stock} available${low?" · low":""}`;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 8px", borderRadius:6, background:T.surface, border:`1px solid ${T.border}`, marginBottom:4 }}>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:600, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{part.name}</div>
        <div style={{ fontSize:10, color:T.text3, fontFamily:"'IBM Plex Mono',monospace" }}>
          {part.sku} · {fmtEur(part.cost)} ex.VAT
          <span style={{ marginLeft:8, color:stockColor, fontWeight:700 }}>● {stockLabel}</span>
        </div>
      </div>
      <input type="number" value={qty} min={1} onChange={e=>setQty(Math.max(1,parseInt(e.target.value)||1))}
        style={{ ...inp(), width:44, textAlign:"center", padding:"3px 4px", fontSize:12 }} />
      <button onClick={()=>onAdd(qty)}
        style={{ background:out?T.surface2:T.pink, border:`1px solid ${out?T.border:T.pink}`, borderRadius:5, padding:"4px 10px", color:out?"#999":"#fff", fontSize:11, fontWeight:700, whiteSpace:"nowrap" }}>
        {out ? "Add (order)" : "Add"}
      </button>
    </div>
  );
}

// ─── CATALOGUE VIEW ────────────────────────────────────────────────────────────
const DEFAULT_PART_CATEGORIES = ["Screens","Batteries","Ports & Connectors","Cameras","Keyboards & Cases","Adhesives & Kits","Tools & Hardware","Other"];

function CatalogueView({ catalogue, setCatalogue, allModels, setAllModels, toast, parts, partCategories, setPartCategories, db }) {
  const DEVICE_CATEGORIES = ["Phone","Tablet","Computer","Other"];
  const [search,      setSearch]      = useState("");
  const [editId,      setEditId]      = useState(null);
  const [showForm,    setShowForm]    = useState(false);
  const [filterCat,   setFilterCat]   = useState("all");   // part category filter
  const [sortCol,     setSortCol]     = useState("name");   // name | sku | supplier | cost | stock | available | part_category
  const [sortDir,     setSortDir]     = useState("asc");
  const [newCatInput,  setNewCatInput]  = useState("");
  const [modelSearch,  setModelSearch]  = useState("");

  const blank = { name:"", sku:"", supplier:"", cost:"", stock_qty:"", min_stock:"", part_category:"", compatible_models:[], compatible_categories:[] };
  const [form, setForm] = useState(blank);

  useEffect(() => {
    if (allModels !== null) return;
    fetchModels().then(rows => setAllModels(rows));
  }, [allModels, setAllModels]);

  const models = allModels || [];

  function startAdd()    { setForm(blank); setEditId(null); setShowForm(true); setModelSearch(""); }
  function startEdit(p)  { setForm({ ...p, cost:String(p.cost), stock_qty:String(p.stock_qty), min_stock:String(p.min_stock) }); setEditId(p.id); setShowForm(true); setModelSearch(""); }
  function cancel()      { setShowForm(false); setEditId(null); setForm(blank); setModelSearch(""); }

  async function save() {
    if (!form.name.trim()) { toast("Part name required", "error"); return; }
    if (form.sku.trim()) {
      const skuLower = form.sku.trim().toLowerCase();
      const duplicate = catalogue.find(c => c.sku.toLowerCase() === skuLower && c.id !== editId);
      if (duplicate) { toast(`SKU "${form.sku.trim()}" is already used by "${duplicate.name}"`, "error"); return; }
    }
    const entry = { ...form, cost:parseFloat(form.cost)||0, avg_cost:parseFloat(form.avg_cost)||parseFloat(form.cost)||0, stock_qty:parseInt(form.stock_qty)||0, min_stock:parseInt(form.min_stock)||0 };
    if (editId) {
      setCatalogue(cs => cs.map(c => c.id===editId ? entry : c));
      await db.saveCatalogueItem(entry);
      toast("Part updated");
    } else {
      const newEntry = { ...entry, id:genId("cat") };
      setCatalogue(cs => [...cs, newEntry]);
      await db.saveCatalogueItem(newEntry);
      toast("Part added to inventory");
    }
    cancel();
  }

  async function remove(id) {
    setCatalogue(cs => cs.filter(c => c.id!==id));
    await db.deleteCatalogueItem(id);
    toast("Part removed","warn");
  }

  async function adjustStock(id, delta) {
    const updated = catalogue.map(c => c.id===id ? { ...c, stock_qty: Math.max(0, c.stock_qty + delta) } : c);
    setCatalogue(updated);
    const item = updated.find(c => c.id===id);
    if (item) await db.saveCatalogueItem(item);
  }

  async function addPartCategory() {
    const v = newCatInput.trim();
    if (!v) return;
    if (partCategories.includes(v)) { toast("Category already exists","error"); return; }
    setPartCategories(cats => [...cats, v]);
    setNewCatInput("");
    await db.savePartCategory(v);
    toast(`Category "${v}" added`);
  }

  // Reserved / available computation
  const reservedMap = {};
  (parts||[]).forEach(p => {
    if (p.catalogue_id && (p.part_status==="pending" || p.part_status==="ordered")) {
      reservedMap[p.catalogue_id] = (reservedMap[p.catalogue_id]||0) + (p.qty||1);
    }
  });
  function available(c) { return c.stock_qty - (reservedMap[c.id]||0); }

  const lowStock = catalogue.filter(c => available(c) < c.min_stock);

  // Filter
  const q = search.toLowerCase();
  let filtered = catalogue.filter(c =>
    (filterCat==="all" || c.part_category===filterCat) &&
    (!q || c.name.toLowerCase().includes(q) || (c.sku||"").toLowerCase().includes(q) || (c.supplier||"").toLowerCase().includes(q))
  );

  // Sort
  function toggleSort(col) {
    if (sortCol===col) setSortDir(d => d==="asc"?"desc":"asc");
    else { setSortCol(col); setSortDir("asc"); }
  }
  const sortFn = (a, b) => {
    let av, bv;
    if (sortCol==="cost")      { av=a.cost;              bv=b.cost; }
    else if (sortCol==="avg_cost") { av=a.avg_cost??a.cost; bv=b.avg_cost??b.cost; }
    else if (sortCol==="stock"){ av=a.stock_qty;         bv=b.stock_qty; }
    else if (sortCol==="available") { av=available(a);   bv=available(b); }
    else if (sortCol==="sku")  { av=(a.sku||"").toLowerCase(); bv=(b.sku||"").toLowerCase(); }
    else if (sortCol==="supplier") { av=(a.supplier||"").toLowerCase(); bv=(b.supplier||"").toLowerCase(); }
    else if (sortCol==="part_category") { av=(a.part_category||"").toLowerCase(); bv=(b.part_category||"").toLowerCase(); }
    else { av=a.name.toLowerCase(); bv=b.name.toLowerCase(); }
    if (av < bv) return sortDir==="asc" ? -1 : 1;
    if (av > bv) return sortDir==="asc" ? 1 : -1;
    return 0;
  };
  filtered = [...filtered].sort(sortFn);

  function SortTh({ col, label, style: s }) {
    const active = sortCol===col;
    return (
      <div onClick={()=>toggleSort(col)} style={{ padding:"8px 12px", fontSize:9, fontWeight:700, color:active?T.pink:T.text3, textTransform:"uppercase", letterSpacing:".08em", cursor:"pointer", userSelect:"none", display:"flex", alignItems:"center", gap:3, ...s }}>
        {label}
        <span style={{ fontSize:9, color:active?T.pink:T.border2 }}>{active?(sortDir==="asc"?"▲":"▼"):"⇅"}</span>
      </div>
    );
  }

  // Group models by brand for model picker
  const modelsByBrand = {};
  models.forEach(m => { if (!modelsByBrand[m.brand]) modelsByBrand[m.brand]=[]; modelsByBrand[m.brand].push(m); });

  return (
    <div style={{ padding:24 }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <div>
          <h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700, color:T.text }}>◑ Inventory</h2>
          <div style={{ fontSize:12, color:T.text3 }}>{catalogue.length} parts · {catalogue.reduce((s,c)=>s+c.stock_qty,0)} units on shelf</div>
        </div>
        <button onClick={startAdd} style={{ background:T.pink, border:"none", borderRadius:7, padding:"8px 18px", color:"#fff", fontSize:13, fontWeight:700 }}>+ Add part</button>
      </div>

      {/* Low stock alert */}
      {lowStock.length > 0 && (
        <div style={{ background:T.amberBg, border:`1px solid ${T.amber}55`, borderRadius:8, padding:"10px 14px", marginBottom:14, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:16 }}>⚠️</span>
          <div style={{ flex:1 }}>
            <span style={{ fontSize:12, fontWeight:700, color:T.amber }}>Low stock: </span>
            <span style={{ fontSize:12, color:T.text2 }}>{lowStock.map(c=>`${c.name} (avail. ${available(c)}/${c.min_stock})`).join(" · ")}</span>
          </div>
        </div>
      )}

      {/* Category manager */}
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"10px 14px", marginBottom:14 }}>
        <div style={{ fontSize:10, fontWeight:700, color:T.text3, textTransform:"uppercase", letterSpacing:".08em", marginBottom:8 }}>Part categories <span style={{ fontSize:10, fontWeight:400, textTransform:"none", letterSpacing:0, color:T.text3 }}>— remove in Settings</span></div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          {partCategories.map(cat => (
            <span key={cat} style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:11, fontWeight:600, padding:"3px 10px", borderRadius:20, background:T.surface2, border:`1px solid ${T.border}`, color:T.text2 }}>
              {cat}
            </span>
          ))}
          <div style={{ display:"flex", gap:4, alignItems:"center" }}>
            <input value={newCatInput} onChange={e=>setNewCatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPartCategory()}
              placeholder="New category…" style={{ ...inp(), width:140, fontSize:11, padding:"4px 8px" }} />
            <button onClick={addPartCategory} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:5, padding:"4px 10px", color:T.text2, fontSize:11, fontWeight:700 }}>+ Add</button>
          </div>
        </div>
      </div>

      {/* Search + category filter */}
      <div style={{ display:"flex", gap:8, marginBottom:14, alignItems:"center", flexWrap:"wrap" }}>
        <input placeholder="Search name, SKU, supplier…" value={search} onChange={e=>setSearch(e.target.value)}
          style={{ ...inp(), flex:1, minWidth:200 }} />
        <button onClick={()=>setFilterCat("all")} style={{ fontSize:11, fontWeight:600, padding:"5px 12px", borderRadius:6, border:`1px solid ${filterCat==="all"?T.pink:T.border}`, background:filterCat==="all"?T.pinkBg:T.surface, color:filterCat==="all"?T.pink:T.text2 }}>All</button>
        {partCategories.map(cat => (
          <button key={cat} onClick={()=>setFilterCat(cat==="all"?"all":cat)} style={{ fontSize:11, fontWeight:600, padding:"5px 12px", borderRadius:6, border:`1px solid ${filterCat===cat?T.pink:T.border}`, background:filterCat===cat?T.pinkBg:T.surface, color:filterCat===cat?T.pink:T.text2 }}>{cat}</button>
        ))}
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:20, marginBottom:16 }}>
          <div style={{ fontSize:13, fontWeight:700, color:T.pink, marginBottom:14 }}>{editId ? "Edit part" : "New part"}</div>

          {/* Name + SKU */}
          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:8, marginBottom:8 }}>
            <div>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4 }}>Part name *</div>
              <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. iPhone 15 Battery" style={{ ...inp(), width:"100%" }} />
            </div>
            <div>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4 }}>SKU <span style={{ color:T.text3 }}>(must be unique)</span></div>
              <input value={form.sku} onChange={e=>setForm(f=>({...f,sku:e.target.value}))} placeholder="APL-IP15-BAT" style={{ ...inp(), width:"100%", borderColor: form.sku && catalogue.find(c=>c.sku.toLowerCase()===form.sku.toLowerCase()&&c.id!==editId) ? T.red : undefined }} />
              {form.sku.trim() && catalogue.find(c=>c.sku.toLowerCase()===form.sku.trim().toLowerCase()&&c.id!==editId) && (
                <div style={{ fontSize:10, color:T.red, marginTop:3 }}>⚠ SKU already used by "{catalogue.find(c=>c.sku.toLowerCase()===form.sku.trim().toLowerCase()&&c.id!==editId)?.name}"</div>
              )}
            </div>
          </div>

          {/* Part category + Supplier + Cost + Stock + Min */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 80px 80px", gap:8, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4 }}>Part category</div>
              <select value={form.part_category} onChange={e=>setForm(f=>({...f,part_category:e.target.value}))} style={{ ...inp(), width:"100%" }}>
                <option value="">— None —</option>
                {partCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4 }}>Supplier</div>
              <input value={form.supplier} onChange={e=>setForm(f=>({...f,supplier:e.target.value}))} placeholder="iFixit" style={{ ...inp(), width:"100%" }} />
            </div>
            <div>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4 }}>Cost excl. VAT (€)</div>
              <input type="number" value={form.cost} onChange={e=>setForm(f=>({...f,cost:e.target.value}))} placeholder="0.00" style={{ ...inp(), width:"100%" }} />
            </div>
            <div>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4 }}>In stock</div>
              <input type="number" value={form.stock_qty} onChange={e=>setForm(f=>({...f,stock_qty:e.target.value}))} placeholder="0" style={{ ...inp(), width:"100%" }} />
            </div>
            <div>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4 }}>Min stock</div>
              <input type="number" value={form.min_stock} onChange={e=>setForm(f=>({...f,min_stock:e.target.value}))} placeholder="1" style={{ ...inp(), width:"100%" }} />
            </div>
          </div>

          {/* Compatible device categories */}
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, color:T.text2, marginBottom:6 }}>Compatible device categories <span style={{ color:T.text3 }}>(shows for ALL models in category)</span></div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {DEVICE_CATEGORIES.map(cat => {
                const on = form.compatible_categories.includes(cat);
                return (
                  <button key={cat} onClick={()=>setForm(f=>({ ...f, compatible_categories: on ? f.compatible_categories.filter(c=>c!==cat) : [...f.compatible_categories,cat] }))}
                    style={{ fontSize:11, padding:"3px 12px", borderRadius:5, border:`1px solid ${on?T.blue:T.border}`, background:on?T.blueBg:T.surface2, color:on?T.blue:T.text2, fontWeight:on?700:400 }}>
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Compatible models */}
          <div style={{ marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
              <div style={{ fontSize:11, color:T.text2 }}>Compatible models <span style={{ color:T.text3 }}>({form.compatible_models.length} selected)</span></div>
              {form.compatible_models.length > 0 && (
                <button onClick={()=>setForm(f=>({...f,compatible_models:[]}))} style={{ background:"none", border:"none", fontSize:10, color:T.text3, cursor:"pointer", padding:0 }}>Clear all</button>
              )}
            </div>
            <input value={modelSearch} onChange={e=>setModelSearch(e.target.value)}
              placeholder="Filter models…" style={{ ...inp(), width:"100%", fontSize:11, padding:"5px 10px", marginBottom:6 }} />
            <div style={{ maxHeight:180, overflowY:"auto", border:`1px solid ${T.border}`, borderRadius:7, background:T.surface2, padding:8 }}>
              {(() => {
                const mq = modelSearch.toLowerCase();
                const filtered = Object.entries(modelsByBrand).map(([brand, ms]) => ({
                  brand, ms: ms.filter(m => !mq || m.model_name.toLowerCase().includes(mq) || brand.toLowerCase().includes(mq))
                })).filter(g => g.ms.length > 0);
                if (models.length === 0) return <div style={{ fontSize:11, color:T.text3 }}>Loading models…</div>;
                if (filtered.length === 0) return <div style={{ fontSize:11, color:T.text3 }}>No models match "{modelSearch}"</div>;
                return filtered.map(({ brand, ms }) => (
                  <div key={brand} style={{ marginBottom:8 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:T.text3, textTransform:"uppercase", letterSpacing:".07em", marginBottom:4 }}>{brand}</div>
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                      {ms.map(m => {
                        const on = form.compatible_models.includes(m.id);
                        return (
                          <button key={m.id} onClick={()=>setForm(f=>({ ...f, compatible_models: on ? f.compatible_models.filter(x=>x!==m.id) : [...f.compatible_models,m.id] }))}
                            style={{ fontSize:10, padding:"2px 8px", borderRadius:4, border:`1px solid ${on?T.pink:T.border}`, background:on?T.pinkBg:T.surface, color:on?T.pink:T.text2, fontWeight:on?700:400 }}>
                            {m.model_name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>

          <div style={{ display:"flex", gap:8 }}>
            <button onClick={save} style={{ background:T.pink, border:"none", borderRadius:7, padding:"7px 18px", color:"#fff", fontSize:13, fontWeight:700 }}>
              {editId ? "💾 Save" : "Add to inventory"}
            </button>
            <button onClick={cancel} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:7, padding:"7px 14px", color:T.text2, fontSize:13 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Parts table */}
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden" }}>
        {/* Sortable header */}
        <div style={{ display:"grid", gridTemplateColumns:"2fr 100px 100px 110px 90px 80px 80px 70px 80px 70px 36px 36px", background:T.surface2, borderBottom:`1px solid ${T.border}` }}>
          <SortTh col="name"          label="Part" />
          <SortTh col="part_category" label="Category" />
          <SortTh col="sku"           label="SKU" />
          <SortTh col="supplier"      label="Supplier" />
          <SortTh col="cost"          label="List Cost" />
          <SortTh col="avg_cost"      label="Avg Cost" />
          <SortTh col="stock"         label="Shelf" />
          <div style={{ padding:"8px 12px", fontSize:9, fontWeight:700, color:T.text3, textTransform:"uppercase", letterSpacing:".08em" }}>Resv.</div>
          <SortTh col="available"     label="Available" />
          <div style={{ padding:"8px 12px", fontSize:9, fontWeight:700, color:T.text3, textTransform:"uppercase", letterSpacing:".08em" }}>Min</div>
          <div /><div />
        </div>

        {filtered.length === 0 && <div style={{ padding:"32px", textAlign:"center", color:T.text3, fontSize:13 }}>No parts found</div>}

        {filtered.map((c, i) => {
          const reserved  = reservedMap[c.id] || 0;
          const avail     = c.stock_qty - reserved;
          const sc        = avail < 0 ? T.red : avail === 0 ? T.red : avail <= c.min_stock ? T.amber : T.green;
          const zeroStock = c.stock_qty === 0;
          const compatCount = c.compatible_models.length + c.compatible_categories.length;
          const rowBg = zeroStock ? T.redBg : i%2===1 ? T.surface2 : T.surface;
          return (
            <div key={c.id} style={{ display:"grid", gridTemplateColumns:"2fr 100px 100px 110px 90px 80px 80px 70px 80px 70px 36px 36px", borderTop:`1px solid ${T.border}`, background:rowBg, alignItems:"center", minHeight:44 }}>
              <div style={{ padding:"8px 12px" }}>
                <div style={{ fontSize:13, fontWeight:600, color:zeroStock?T.red:T.text, display:"flex", alignItems:"center", gap:6 }}>
                  {zeroStock && <span style={{ fontSize:9, fontWeight:800, color:T.red, background:T.redBg, border:`1px solid ${T.red}44`, borderRadius:3, padding:"1px 5px" }}>OUT</span>}
                  {c.name}
                </div>
                <div style={{ fontSize:10, color:T.text3, marginTop:1 }}>
                  {compatCount > 0 ? `${c.compatible_models.length} model${c.compatible_models.length!==1?"s":""} · ${c.compatible_categories.join(", ")||"—"}` : "Universal"}
                </div>
              </div>
              <div style={{ padding:"6px 8px" }}>
                {c.part_category
                  ? <span style={{ fontSize:10, fontWeight:600, padding:"2px 7px", borderRadius:10, background:T.surface2, border:`1px solid ${T.border}`, color:T.text2 }}>{c.part_category}</span>
                  : <span style={{ fontSize:10, color:T.text3 }}>—</span>}
              </div>
              <div style={{ padding:"8px 12px", fontSize:11, color:T.text3, fontFamily:"'IBM Plex Mono',monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.sku||"—"}</div>
              <div style={{ padding:"8px 12px", fontSize:11, color:T.text2 }}>{c.supplier||"—"}</div>
              <div style={{ padding:"8px 12px", fontSize:12, color:T.text2 }}>{fmtEur(c.cost)}</div>
              <div style={{ padding:"8px 12px", fontSize:12, fontWeight:700, color:T.blue }}>{fmtEur(c.avg_cost ?? c.cost)}</div>
              {/* Shelf ± */}
              <div style={{ padding:"4px 8px", display:"flex", alignItems:"center", gap:3 }}>
                <button onClick={()=>adjustStock(c.id,-1)} disabled={c.stock_qty===0}
                  style={{ width:18, height:18, borderRadius:3, border:`1px solid ${T.border}`, background:T.surface2, color:T.text2, fontSize:12, padding:0, display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
                <span style={{ fontSize:13, fontWeight:800, color:zeroStock?T.red:T.text, minWidth:20, textAlign:"center" }}>{c.stock_qty}</span>
                <button onClick={()=>adjustStock(c.id,+1)}
                  style={{ width:18, height:18, borderRadius:3, border:`1px solid ${T.border}`, background:T.surface2, color:T.text2, fontSize:12, padding:0, display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
              </div>
              {/* Reserved */}
              <div style={{ padding:"8px 8px", textAlign:"center" }}>
                {reserved > 0
                  ? <span style={{ fontSize:12, fontWeight:700, color:T.amber }}>−{reserved}</span>
                  : <span style={{ fontSize:11, color:T.text3 }}>—</span>}
              </div>
              {/* Available */}
              <div style={{ padding:"8px 12px", textAlign:"center" }}>
                <span style={{ fontSize:14, fontWeight:800, color:sc }}>{avail}</span>
                {avail < 0 && <div style={{ fontSize:9, color:T.red, fontWeight:700 }}>SHORT</div>}
              </div>
              <div style={{ padding:"8px 12px", fontSize:12, color:T.text2, textAlign:"center" }}>{c.min_stock}</div>
              <div style={{ padding:"4px 6px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <button onClick={()=>startEdit(c)} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:5, padding:"3px 6px", color:T.text2, fontSize:11 }}>✏</button>
              </div>
              <div style={{ padding:"4px 6px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <button onClick={()=>remove(c.id)} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:5, padding:"3px 6px", color:T.red, fontSize:11 }}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── STOCK INTAKE ─────────────────────────────────────────────────────────────
function StockIntakeView({ catalogue, setCatalogue, partCategories, intakeLogs, setIntakeLogs, toast, allModels, setAllModels, db }) {
  const DEVICE_CATEGORIES = ["Phone","Tablet","Computer","Other"];

  useEffect(() => {
    if (allModels !== null) return;
    fetchModels().then(rows => setAllModels(rows));
  }, [allModels, setAllModels]);

  // ── mode: "log" | "intake" | "new_part" ─────────────────────────────────────
  const [mode,        setMode]        = useState("log");   // default = inventory dashboard
  const [search,      setSearch]      = useState("");
  const [selected,    setSelected]    = useState(null);    // catalogue entry being restocked

  // Intake form state
  const INTAKE_BLANK = { qty:"", buyIn:"" };
  const [intakeForm,  setIntakeForm]  = useState(INTAKE_BLANK);

  // New-part form (create & intake simultaneously)
  const NEW_BLANK = { name:"", sku:"", supplier:"", part_category:"", cost:"", stock_qty:"", min_stock:"1",
                      compatible_models:[], compatible_categories:[], buyIn:"", qty:"" };
  const [newForm,     setNewForm]     = useState(NEW_BLANK);
  const [skuError,    setSkuError]    = useState("");
  const [modelSearch, setModelSearch] = useState("");

  // Sort state for the inventory dashboard table
  const [sortCol,     setSortCol]     = useState("name");
  const [sortDir,     setSortDir]     = useState("asc");

  // ── Weighted average cost calculation ────────────────────────────────────────
  function calcWAC(currentQty, currentAvg, addedQty, buyInPrice) {
    const total = currentQty + addedQty;
    if (total === 0) return buyInPrice;
    return ((currentQty * currentAvg) + (addedQty * buyInPrice)) / total;
  }

  // ── Save intake for existing catalogue item ───────────────────────────────
  async function saveIntake() {
    const addedQty   = parseInt(intakeForm.qty)   || 0;
    const buyInPrice = parseFloat(intakeForm.buyIn) || 0;
    if (!selected)         { toast("No item selected","error"); return; }
    if (addedQty <= 0)     { toast("Quantity must be > 0","error"); return; }
    if (buyInPrice <= 0)   { toast("Buy-in price must be > 0","error"); return; }

    const newAvg = calcWAC(selected.stock_qty, selected.avg_cost ?? selected.cost, addedQty, buyInPrice);
    const newQty = selected.stock_qty + addedQty;
    const updatedItem = { ...selected, stock_qty: newQty, avg_cost: Math.round(newAvg * 10000) / 10000 };

    setCatalogue(cs => cs.map(c => c.id === selected.id ? updatedItem : c));
    await db.saveCatalogueItem(updatedItem);

    const log = {
      id: genId("il"), catalogue_id: selected.id, part_name: selected.name,
      sku: selected.sku, added_qty: addedQty, buy_in: buyInPrice,
      new_avg: Math.round(newAvg * 10000) / 10000, new_total: newQty,
      created_at: new Date().toISOString(),
    };
    setIntakeLogs(ls => [log, ...ls]);
    await db.saveIntakeLog(log);
    toast(`✓ ${selected.name} — +${addedQty} units @ ${fmtEur(buyInPrice)} · new avg ${fmtEur(log.new_avg)}`);
    setSelected(null); setIntakeForm(INTAKE_BLANK); setSearch(""); setMode("log");
  }

  async function saveNewPart() {
    if (!newForm.name.trim()) { toast("Part name required","error"); return; }
    const addedQty   = parseInt(newForm.qty)    || 0;
    const buyInPrice = parseFloat(newForm.buyIn) || 0;
    if (addedQty <= 0)   { toast("Quantity must be > 0","error"); return; }
    if (buyInPrice <= 0) { toast("Buy-in price must be > 0","error"); return; }

    if (newForm.sku.trim()) {
      const dup = catalogue.find(c => c.sku.toLowerCase() === newForm.sku.trim().toLowerCase());
      if (dup) { setSkuError(`SKU already used by "${dup.name}"`); return; }
    }
    setSkuError("");

    const listCost = parseFloat(newForm.cost) || buyInPrice;
    const entry = {
      id: genId("cat"),
      name: newForm.name.trim(), sku: newForm.sku.trim(), supplier: newForm.supplier.trim(),
      part_category: newForm.part_category, cost: listCost, avg_cost: buyInPrice,
      stock_qty: addedQty, min_stock: parseInt(newForm.min_stock) || 1,
      compatible_models: newForm.compatible_models, compatible_categories: newForm.compatible_categories,
    };
    setCatalogue(cs => [...cs, entry]);
    await db.saveCatalogueItem(entry);

    const log = {
      id: genId("il"), catalogue_id: entry.id, part_name: entry.name,
      sku: entry.sku, added_qty: addedQty, buy_in: buyInPrice,
      new_avg: buyInPrice, new_total: addedQty,
      created_at: new Date().toISOString(),
    };
    setIntakeLogs(ls => [log, ...ls]);
    await db.saveIntakeLog(log);
    toast(`✓ "${entry.name}" created and ${addedQty} units received`);
    setNewForm(NEW_BLANK); setMode("log");
  }

  // ── Sort helpers ─────────────────────────────────────────────────────────
  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }
  function Th({ col, label, align }) {
    const active = sortCol === col;
    return (
      <div onClick={() => toggleSort(col)} style={{ padding:"9px 12px", fontSize:10, fontWeight:700, color:active?T.pink:T.text3, textTransform:"uppercase", letterSpacing:".07em", cursor:"pointer", userSelect:"none", display:"flex", alignItems:"center", gap:3, textAlign:align||"left" }}>
        {label} <span style={{ fontSize:9, color:active?T.pink:T.border2 }}>{active?(sortDir==="asc"?"▲":"▼"):"⇅"}</span>
      </div>
    );
  }

  // ── Inventory table data ─────────────────────────────────────────────────
  const q = search.toLowerCase();
  const rows = [...catalogue]
    .filter(c => !q || c.name.toLowerCase().includes(q) || (c.sku||"").toLowerCase().includes(q) || (c.supplier||"").toLowerCase().includes(q))
    .sort((a, b) => {
      let av, bv;
      if      (sortCol === "qty")      { av = a.stock_qty;           bv = b.stock_qty; }
      else if (sortCol === "avg_cost") { av = a.avg_cost ?? a.cost;  bv = b.avg_cost ?? b.cost; }
      else if (sortCol === "cost")     { av = a.cost;                bv = b.cost; }
      else if (sortCol === "category") { av = (a.part_category||"").toLowerCase(); bv = (b.part_category||"").toLowerCase(); }
      else if (sortCol === "supplier") { av = (a.supplier||"").toLowerCase(); bv = (b.supplier||"").toLowerCase(); }
      else if (sortCol === "sku")      { av = (a.sku||"").toLowerCase(); bv = (b.sku||"").toLowerCase(); }
      else                             { av = a.name.toLowerCase();   bv = b.name.toLowerCase(); }
      return av < bv ? (sortDir==="asc"?-1:1) : av > bv ? (sortDir==="asc"?1:-1) : 0;
    });

  const outOfStock = catalogue.filter(c => c.stock_qty === 0).length;
  const totalValue = catalogue.reduce((s, c) => s + c.stock_qty * (c.avg_cost ?? c.cost), 0);

  // ── Search results for item picker ───────────────────────────────────────
  const qPick = search.toLowerCase();
  const pickResults = catalogue.filter(c =>
    qPick && (c.name.toLowerCase().includes(qPick) || (c.sku||"").toLowerCase().includes(qPick))
  ).slice(0, 8);

  // Preview WAC before saving
  const previewQty   = parseInt(intakeForm.qty) || 0;
  const previewBuyIn = parseFloat(intakeForm.buyIn) || 0;
  const previewAvg   = selected && previewQty > 0 && previewBuyIn > 0
    ? calcWAC(selected.stock_qty, selected.avg_cost ?? selected.cost, previewQty, previewBuyIn)
    : null;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding:24 }}>

      {/* ── Page header + action buttons ── */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20 }}>
        <div>
          <h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700, color:T.text }}>↓ Stock Intake</h2>
          <div style={{ fontSize:12, color:T.text3 }}>
            {catalogue.length} parts · {catalogue.reduce((s,c)=>s+c.stock_qty,0)} total units · inventory value {fmtEur(totalValue)} excl. VAT
            {outOfStock > 0 && <span style={{ color:T.red, fontWeight:700 }}> · {outOfStock} out of stock</span>}
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>{setMode("log");setSelected(null);setSearch("");}}
            style={{ fontSize:12, fontWeight:700, padding:"7px 14px", borderRadius:7, border:`1px solid ${mode==="log"?T.blue:T.border}`, background:mode==="log"?T.blueBg:T.surface, color:mode==="log"?T.blue:T.text2 }}>
            📦 Inventory
          </button>
          <button onClick={()=>{setMode("intake");setSelected(null);setSearch("");setIntakeForm(INTAKE_BLANK);}}
            style={{ fontSize:12, fontWeight:700, padding:"7px 14px", borderRadius:7, border:`1px solid ${mode==="intake"?T.pink:T.border}`, background:mode==="intake"?T.pinkBg:T.surface, color:mode==="intake"?T.pink:T.text2 }}>
            + Restock existing
          </button>
          <button onClick={()=>{setMode("new_part");setNewForm(NEW_BLANK);setSkuError("");setModelSearch("");}}
            style={{ fontSize:12, fontWeight:700, padding:"7px 14px", borderRadius:7, border:`1px solid ${mode==="new_part"?T.green:T.border}`, background:mode==="new_part"?T.greenBg:T.surface, color:mode==="new_part"?T.green:T.text2 }}>
            + New part
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          MODE: RESTOCK EXISTING
      ════════════════════════════════════════════════════════ */}
      {mode === "intake" && (
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:24, marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight:700, color:T.pink, marginBottom:16 }}>+ Restock existing part</div>

          {/* Item search / picker */}
          {!selected ? (
            <div style={{ marginBottom:0 }}>
              <div style={{ fontSize:11, color:T.text2, marginBottom:6, fontWeight:600 }}>Search by name or SKU</div>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="e.g. iPhone 15 Battery or APL-IP15-BAT"
                style={{ ...inp(), width:"100%", marginBottom:8 }} autoFocus />
              {pickResults.length > 0 && (
                <div style={{ border:`1px solid ${T.border}`, borderRadius:8, overflow:"hidden" }}>
                  {pickResults.map(c => (
                    <div key={c.id} onClick={()=>{setSelected(c);setSearch("");}}
                      style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", cursor:"pointer", borderBottom:`1px solid ${T.border}`, background:T.surface2 }}
                      onMouseEnter={e=>e.currentTarget.style.background=T.pinkBg}
                      onMouseLeave={e=>e.currentTarget.style.background=T.surface2}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:T.text }}>{c.name}</div>
                        <div style={{ fontSize:10, color:T.text3 }}>{c.sku||"—"} · {c.supplier||"—"}</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:12, fontWeight:700, color:c.stock_qty===0?T.red:T.green }}>{c.stock_qty} in stock</div>
                        <div style={{ fontSize:10, color:T.text3 }}>avg {fmtEur(c.avg_cost??c.cost)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {search.length > 1 && pickResults.length === 0 && (
                <div style={{ fontSize:12, color:T.text3, padding:"10px 0" }}>No matches. Use "New part" to add it.</div>
              )}
            </div>
          ) : (
            /* Intake form — item is selected */
            <div>
              {/* Selected item card */}
              <div style={{ display:"flex", alignItems:"center", gap:12, background:T.pinkBg, border:`1px solid ${T.pink}33`, borderRadius:8, padding:"10px 14px", marginBottom:16 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:T.text }}>{selected.name}</div>
                  <div style={{ fontSize:11, color:T.text3 }}>{selected.sku||"—"} · {selected.supplier||"—"}</div>
                </div>
                <div style={{ textAlign:"right", fontSize:12 }}>
                  <span style={{ color:T.text2 }}>Current: </span>
                  <span style={{ fontWeight:700, color:selected.stock_qty===0?T.red:T.text }}>{selected.stock_qty} units</span>
                  <span style={{ color:T.text3, marginLeft:8 }}>avg {fmtEur(selected.avg_cost??selected.cost)}</span>
                </div>
                <button onClick={()=>{setSelected(null);setIntakeForm(INTAKE_BLANK);}} style={{ background:"none", border:"none", color:T.text3, fontSize:16, cursor:"pointer", padding:"0 4px" }}>✕</button>
              </div>

              {/* Qty + buy-in price */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:11, color:T.text2, marginBottom:5, fontWeight:600 }}>Quantity received *</div>
                  <input type="number" min="1" value={intakeForm.qty} onChange={e=>setIntakeForm(f=>({...f,qty:e.target.value}))}
                    placeholder="e.g. 10" style={{ ...inp(), width:"100%", fontSize:16, fontWeight:700 }} autoFocus />
                </div>
                <div>
                  <div style={{ fontSize:11, color:T.text2, marginBottom:5, fontWeight:600 }}>Unit buy-in price excl. VAT (€) *</div>
                  <input type="number" min="0" step="0.01" value={intakeForm.buyIn} onChange={e=>setIntakeForm(f=>({...f,buyIn:e.target.value}))}
                    placeholder="e.g. 17.50" style={{ ...inp(), width:"100%", fontSize:16, fontWeight:700 }} />
                </div>
              </div>

              {/* WAC preview */}
              {previewAvg !== null && (
                <div style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:8, padding:"12px 16px", marginBottom:16, display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
                  <div style={{ textAlign:"center" }}>
                    <div style={{ fontSize:10, color:T.text3, textTransform:"uppercase", letterSpacing:".07em", marginBottom:3 }}>Current stock</div>
                    <div style={{ fontSize:18, fontWeight:800, color:T.text }}>{selected.stock_qty}</div>
                  </div>
                  <div style={{ textAlign:"center" }}>
                    <div style={{ fontSize:10, color:T.text3, textTransform:"uppercase", letterSpacing:".07em", marginBottom:3 }}>+ Receiving</div>
                    <div style={{ fontSize:18, fontWeight:800, color:T.green }}>+{previewQty}</div>
                  </div>
                  <div style={{ textAlign:"center" }}>
                    <div style={{ fontSize:10, color:T.text3, textTransform:"uppercase", letterSpacing:".07em", marginBottom:3 }}>New total</div>
                    <div style={{ fontSize:18, fontWeight:800, color:T.text }}>{selected.stock_qty + previewQty}</div>
                  </div>
                  <div style={{ textAlign:"center" }}>
                    <div style={{ fontSize:10, color:T.text3, textTransform:"uppercase", letterSpacing:".07em", marginBottom:3 }}>New avg cost</div>
                    <div style={{ fontSize:18, fontWeight:800, color:T.blue }}>{fmtEur(previewAvg)}</div>
                    {Math.abs(previewAvg - (selected.avg_cost??selected.cost)) > 0.001 && (
                      <div style={{ fontSize:10, color:previewAvg > (selected.avg_cost??selected.cost) ? T.red : T.green }}>
                        {previewAvg > (selected.avg_cost??selected.cost) ? "▲" : "▼"} was {fmtEur(selected.avg_cost??selected.cost)}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display:"flex", gap:8 }}>
                <button onClick={saveIntake}
                  style={{ background:T.pink, border:"none", borderRadius:7, padding:"9px 22px", color:"#fff", fontSize:13, fontWeight:700 }}>
                  ✓ Receive stock
                </button>
                <button onClick={()=>{setMode("log");setSelected(null);setIntakeForm(INTAKE_BLANK);setSearch("");}}
                  style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:7, padding:"9px 16px", color:T.text2, fontSize:13 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          MODE: NEW PART (create + first intake)
      ════════════════════════════════════════════════════════ */}
      {mode === "new_part" && (
        <div style={{ background:T.surface, border:`1px solid ${T.green}44`, borderRadius:12, padding:24, marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight:700, color:T.green, marginBottom:16 }}>+ Create new part & receive initial stock</div>

          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:10, marginBottom:10 }}>
            <div>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4, fontWeight:600 }}>Part name *</div>
              <input value={newForm.name} onChange={e=>setNewForm(f=>({...f,name:e.target.value}))}
                placeholder="e.g. Samsung Galaxy A54 Battery" style={{ ...inp(), width:"100%" }} autoFocus />
            </div>
            <div>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4, fontWeight:600 }}>SKU <span style={{ fontWeight:400, color:T.text3 }}>(unique)</span></div>
              <input value={newForm.sku} onChange={e=>{setNewForm(f=>({...f,sku:e.target.value}));setSkuError("");}}
                placeholder="SAM-A54-BAT" style={{ ...inp(), width:"100%", borderColor:skuError?T.red:undefined }} />
              {skuError && <div style={{ fontSize:10, color:T.red, marginTop:3 }}>⚠ {skuError}</div>}
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:10 }}>
            <div>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4, fontWeight:600 }}>Supplier</div>
              <input value={newForm.supplier} onChange={e=>setNewForm(f=>({...f,supplier:e.target.value}))}
                placeholder="iFixit" style={{ ...inp(), width:"100%" }} />
            </div>
            <div>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4, fontWeight:600 }}>Part category</div>
              <select value={newForm.part_category} onChange={e=>setNewForm(f=>({...f,part_category:e.target.value}))}
                style={{ ...inp(), width:"100%" }}>
                <option value="">— None —</option>
                {partCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4, fontWeight:600 }}>List cost excl. VAT (€) <span style={{ fontWeight:400, color:T.text3 }}>optional</span></div>
              <input type="number" value={newForm.cost} onChange={e=>setNewForm(f=>({...f,cost:e.target.value}))}
                placeholder="Leave blank to use buy-in" style={{ ...inp(), width:"100%" }} />
            </div>
          </div>

          {/* Compatible device categories */}
          <div style={{ marginBottom:10 }}>
            <div style={{ fontSize:11, color:T.text2, marginBottom:6, fontWeight:600 }}>Compatible device categories <span style={{ fontWeight:400, color:T.text3 }}>(shows for ALL models in this category)</span></div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {DEVICE_CATEGORIES.map(cat => {
                const on = newForm.compatible_categories.includes(cat);
                return (
                  <button key={cat} type="button" onClick={()=>setNewForm(f=>({ ...f, compatible_categories: on ? f.compatible_categories.filter(c=>c!==cat) : [...f.compatible_categories, cat] }))}
                    style={{ fontSize:11, padding:"4px 14px", borderRadius:5, border:`1px solid ${on?T.blue:T.border}`, background:on?T.blueBg:T.surface2, color:on?T.blue:T.text2, fontWeight:on?700:400 }}>
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Compatible models */}
          <div style={{ marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
              <div style={{ fontSize:11, color:T.text2, fontWeight:600 }}>Compatible models <span style={{ fontWeight:400, color:T.text3 }}>({newForm.compatible_models.length} selected)</span></div>
              {newForm.compatible_models.length > 0 && (
                <button type="button" onClick={()=>setNewForm(f=>({...f,compatible_models:[]}))} style={{ background:"none", border:"none", fontSize:10, color:T.text3, cursor:"pointer", padding:0 }}>Clear all</button>
              )}
            </div>
            <input value={modelSearch} onChange={e=>setModelSearch(e.target.value)}
              placeholder="Filter models…" style={{ ...inp(), width:"100%", fontSize:11, padding:"5px 10px", marginBottom:6 }} />
            <div style={{ maxHeight:180, overflowY:"auto", border:`1px solid ${T.border}`, borderRadius:7, background:T.surface2, padding:8 }}>
              {(allModels||[]).length === 0 && <div style={{ fontSize:11, color:T.text3 }}>Loading models…</div>}
              {(() => {
                const mq = modelSearch.toLowerCase();
                const grouped = (allModels||[]).reduce((acc, m) => { if (!acc[m.brand]) acc[m.brand]=[]; acc[m.brand].push(m); return acc; }, {});
                const filtered = Object.entries(grouped).map(([brand, ms]) => ({
                  brand, ms: ms.filter(m => !mq || m.model_name.toLowerCase().includes(mq) || brand.toLowerCase().includes(mq))
                })).filter(g => g.ms.length > 0);
                if ((allModels||[]).length > 0 && filtered.length === 0) return <div style={{ fontSize:11, color:T.text3 }}>No models match "{modelSearch}"</div>;
                return filtered.map(({ brand, ms }) => (
                  <div key={brand} style={{ marginBottom:8 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:T.text3, textTransform:"uppercase", letterSpacing:".07em", marginBottom:4 }}>{brand}</div>
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                      {ms.map(m => {
                        const on = newForm.compatible_models.includes(m.id);
                        return (
                          <button key={m.id} type="button" onClick={()=>setNewForm(f=>({ ...f, compatible_models: on ? f.compatible_models.filter(x=>x!==m.id) : [...f.compatible_models, m.id] }))}
                            style={{ fontSize:10, padding:"2px 8px", borderRadius:4, border:`1px solid ${on?T.pink:T.border}`, background:on?T.pinkBg:T.surface, color:on?T.pink:T.text2, fontWeight:on?700:400 }}>
                            {m.model_name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>

          <div style={{ borderTop:`1px dashed ${T.border}`, paddingTop:14, marginBottom:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:T.green, marginBottom:10, textTransform:"uppercase", letterSpacing:".07em" }}>Initial stock receipt</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 80px", gap:10 }}>
              <div>
                <div style={{ fontSize:11, color:T.text2, marginBottom:4, fontWeight:600 }}>Quantity received *</div>
                <input type="number" min="1" value={newForm.qty} onChange={e=>setNewForm(f=>({...f,qty:e.target.value}))}
                  placeholder="e.g. 5" style={{ ...inp(), width:"100%", fontSize:15, fontWeight:700 }} />
              </div>
              <div>
                <div style={{ fontSize:11, color:T.text2, marginBottom:4, fontWeight:600 }}>Unit buy-in price excl. VAT (€) *</div>
                <input type="number" min="0" step="0.01" value={newForm.buyIn} onChange={e=>setNewForm(f=>({...f,buyIn:e.target.value}))}
                  placeholder="e.g. 14.00" style={{ ...inp(), width:"100%", fontSize:15, fontWeight:700 }} />
              </div>
              <div>
                <div style={{ fontSize:11, color:T.text2, marginBottom:4, fontWeight:600 }}>Min stock</div>
                <input type="number" min="0" value={newForm.min_stock} onChange={e=>setNewForm(f=>({...f,min_stock:e.target.value}))}
                  placeholder="1" style={{ ...inp(), width:"100%" }} />
              </div>
            </div>
          </div>

          <div style={{ display:"flex", gap:8 }}>
            <button onClick={saveNewPart}
              style={{ background:T.green, border:"none", borderRadius:7, padding:"9px 22px", color:"#fff", fontSize:13, fontWeight:700 }}>
              ✓ Create & receive
            </button>
            <button onClick={()=>{setMode("log");setNewForm(NEW_BLANK);setSkuError("");}}
              style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:7, padding:"9px 16px", color:T.text2, fontSize:13 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          MODE: INVENTORY DASHBOARD
      ════════════════════════════════════════════════════════ */}
      {mode === "log" && (
        <>
          {/* Search */}
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name, SKU or supplier…"
            style={{ ...inp(), width:"100%", marginBottom:14 }} />

          {/* Inventory table */}
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, overflow:"hidden", marginBottom:24 }}>
            {/* Header */}
            <div style={{ display:"grid", gridTemplateColumns:"2fr 110px 120px 100px 100px 90px 80px 130px", background:T.surface2, borderBottom:`1px solid ${T.border}` }}>
              <Th col="name"     label="Part" />
              <Th col="category" label="Category" />
              <Th col="sku"      label="SKU" />
              <Th col="supplier" label="Supplier" />
              <Th col="cost"     label="List cost" />
              <Th col="avg_cost" label="Avg cost" />
              <Th col="qty"      label="Qty" />
              <div style={{ padding:"9px 12px", fontSize:10, fontWeight:700, color:T.text3, textTransform:"uppercase", letterSpacing:".07em" }}>Actions</div>
            </div>

            {rows.length === 0 && <div style={{ padding:32, textAlign:"center", color:T.text3, fontSize:13 }}>No items match</div>}

            {rows.map((c, i) => {
              const zero = c.stock_qty === 0;
              const rowBg = zero ? T.redBg : i%2===1 ? T.surface2 : T.surface;
              return (
                <div key={c.id} style={{ display:"grid", gridTemplateColumns:"2fr 110px 120px 100px 100px 90px 80px 130px", borderTop:`1px solid ${T.border}`, background:rowBg, alignItems:"center", minHeight:44 }}>
                  <div style={{ padding:"8px 12px", display:"flex", alignItems:"center", gap:8 }}>
                    {zero && <span style={{ fontSize:9, fontWeight:800, color:T.red, background:"#fff", border:`1px solid ${T.red}55`, borderRadius:3, padding:"1px 5px", whiteSpace:"nowrap" }}>OUT</span>}
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color:zero?T.red:T.text }}>{c.name}</div>
                      {c.compatible_categories.length>0 && <div style={{ fontSize:10, color:T.text3 }}>{c.compatible_categories.join(", ")}</div>}
                    </div>
                  </div>
                  <div style={{ padding:"6px 8px" }}>
                    {c.part_category
                      ? <span style={{ fontSize:10, fontWeight:600, padding:"2px 7px", borderRadius:10, background:T.surface, border:`1px solid ${T.border}`, color:T.text2 }}>{c.part_category}</span>
                      : <span style={{ fontSize:11, color:T.text3 }}>—</span>}
                  </div>
                  <div style={{ padding:"8px 12px", fontSize:11, color:T.text3, fontFamily:"monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.sku||"—"}</div>
                  <div style={{ padding:"8px 12px", fontSize:11, color:T.text2 }}>{c.supplier||"—"}</div>
                  <div style={{ padding:"8px 12px", fontSize:12, color:T.text2 }}>{fmtEur(c.cost)}</div>
                  <div style={{ padding:"8px 12px", fontSize:13, fontWeight:800, color:T.blue }}>{fmtEur(c.avg_cost??c.cost)}</div>
                  <div style={{ padding:"8px 12px", textAlign:"center" }}>
                    <span style={{ fontSize:15, fontWeight:800, color:zero?T.red:T.text }}>{c.stock_qty}</span>
                  </div>
                  <div style={{ padding:"4px 12px" }}>
                    <button onClick={()=>{setSelected(c);setIntakeForm(INTAKE_BLANK);setSearch("");setMode("intake");}}
                      style={{ fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:6, border:`1px solid ${T.pink}`, background:T.pinkBg, color:T.pink, whiteSpace:"nowrap" }}>
                      + Restock
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Intake history log */}
          {intakeLogs.length > 0 && (
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:T.text2, marginBottom:10, textTransform:"uppercase", letterSpacing:".07em" }}>📋 Intake history</div>
              <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden" }}>
                <div style={{ display:"grid", gridTemplateColumns:"140px 2fr 90px 100px 100px 110px", background:T.surface2, borderBottom:`1px solid ${T.border}` }}>
                  {["Date","Part","SKU","Qty added","Buy-in","New avg"].map(h =>
                    <div key={h} style={{ padding:"7px 12px", fontSize:9, fontWeight:700, color:T.text3, textTransform:"uppercase", letterSpacing:".07em" }}>{h}</div>
                  )}
                </div>
                {intakeLogs.map((l, i) => (
                  <div key={l.id} style={{ display:"grid", gridTemplateColumns:"140px 2fr 90px 100px 100px 110px", borderTop:`1px solid ${T.border}`, background:i%2===1?T.surface2:T.surface, alignItems:"center", minHeight:38 }}>
                    <div style={{ padding:"6px 12px", fontSize:11, color:T.text3 }}>{new Date(l.date).toLocaleDateString("fi-FI")} {new Date(l.date).toLocaleTimeString("fi-FI",{hour:"2-digit",minute:"2-digit"})}</div>
                    <div style={{ padding:"6px 12px", fontSize:12, fontWeight:600, color:T.text }}>{l.part_name}</div>
                    <div style={{ padding:"6px 12px", fontSize:11, color:T.text3, fontFamily:"monospace" }}>{l.sku||"—"}</div>
                    <div style={{ padding:"6px 12px", fontSize:13, fontWeight:700, color:T.green }}>+{l.added_qty}</div>
                    <div style={{ padding:"6px 12px", fontSize:12, color:T.text2 }}>{fmtEur(l.buy_in)}</div>
                    <div style={{ padding:"6px 12px", fontSize:13, fontWeight:700, color:T.blue }}>{fmtEur(l.new_avg)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── SETTINGS (Technicians) ───────────────────────────────────────────────────
const TECH_COLORS = ["#D4175A","#1A5FAB","#1F8A55","#7340AB","#C47A10","#C0252A","#0891B2","#9333EA","#EA580C","#0D9488"];

function SettingsView({ technicians, setTechnicians, toast, partCategories, setPartCategories, catalogue, setCatalogue, db, tickets, customers, parts, intakeLogs, logs }) {
  const blank = { name:"", initials:"", color:TECH_COLORS[0] };
  const [form,    setForm]    = useState(blank);
  const [catInput, setCatInput] = useState("");

  async function removePartCategory(cat) {
    setPartCategories(cs => cs.filter(c => c !== cat));
    setCatalogue(cs => cs.map(c => c.part_category===cat ? {...c, part_category:""} : c));
    await db.deletePartCategory(cat);
    toast(`Category "${cat}" removed`, "warn");
  }
  const [editId,  setEditId]  = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  function autoInitials(name) {
    return name.trim().split(/\s+/).map(w=>w[0]||"").join("").toUpperCase().slice(0,2);
  }

  function startEdit(tech) {
    setEditId(tech.id);
    setForm({ name:tech.name, initials:tech.initials, color:tech.color });
    setShowAdd(true);
  }

  async function save() {
    if (!form.name.trim()) { toast("Name required","error"); return; }
    const initials = form.initials.trim() || autoInitials(form.name);
    if (editId) {
      const updated = { id:editId, name:form.name.trim(), initials, color:form.color };
      setTechnicians(ts => ts.map(t => t.id===editId ? updated : t));
      await db.saveTechnician(updated);
      toast("Technician updated");
    } else {
      const newTech = { id:genId("tech"), name:form.name.trim(), initials, color:form.color };
      setTechnicians(ts => [...ts, newTech]);
      await db.saveTechnician(newTech);
      toast("Technician added");
    }
    setForm(blank); setEditId(null); setShowAdd(false);
  }

  function cancel() { setForm(blank); setEditId(null); setShowAdd(false); }

  async function remove(id) {
    setTechnicians(ts => ts.filter(t => t.id!==id));
    await db.deleteTechnician(id);
    toast("Technician removed","warn");
  }

  return (
    <div style={{ padding:24, maxWidth:640 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
        <div>
          <h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700, color:T.text }}>⚙ Settings</h2>
          <div style={{ fontSize:12, color:T.text3 }}>Manage technicians and shop configuration</div>
        </div>
      </div>

      {/* ── Technicians ── */}
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:20, marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:T.text }}>👨‍🔧 Technicians</div>
            <div style={{ fontSize:11, color:T.text3, marginTop:2 }}>Assign technicians to repair and accessory tickets</div>
          </div>
          {!showAdd && (
            <button onClick={()=>setShowAdd(true)}
              style={{ background:T.pink, border:"none", borderRadius:7, padding:"7px 14px", color:"#fff", fontSize:12, fontWeight:700 }}>
              + Add technician
            </button>
          )}
        </div>

        {/* Add / Edit form */}
        {showAdd && (
          <div style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:8, padding:16, marginBottom:16 }}>
            <div style={{ fontSize:11, fontWeight:700, color:T.pink, textTransform:"uppercase", letterSpacing:".07em", marginBottom:12 }}>
              {editId ? "Edit technician" : "New technician"}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 80px", gap:8, marginBottom:8 }}>
              <div>
                <div style={{ fontSize:11, color:T.text2, marginBottom:4 }}>Full name *</div>
                <input value={form.name} onChange={e => setForm(f=>({...f, name:e.target.value, initials:f.initials||autoInitials(e.target.value)}))}
                  placeholder="e.g. Mikael Lund" style={{ ...inp(), width:"100%" }} />
              </div>
              <div>
                <div style={{ fontSize:11, color:T.text2, marginBottom:4 }}>Initials</div>
                <input value={form.initials} onChange={e => setForm(f=>({...f,initials:e.target.value.toUpperCase().slice(0,2)}))}
                  placeholder="ML" maxLength={2} style={{ ...inp(), width:"100%", textAlign:"center", fontWeight:800, fontSize:15, letterSpacing:".05em" }} />
              </div>
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:T.text2, marginBottom:6 }}>Colour</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {TECH_COLORS.map(c => (
                  <button key={c} onClick={() => setForm(f=>({...f,color:c}))}
                    style={{ width:28, height:28, borderRadius:"50%", background:c, border:form.color===c?`3px solid ${T.text}`:"3px solid transparent", cursor:"pointer", flexShrink:0 }} />
                ))}
              </div>
            </div>
            {/* Preview */}
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, padding:"8px 12px", background:T.surface, borderRadius:7, border:`1px solid ${T.border}` }}>
              <span style={{ width:32, height:32, borderRadius:"50%", background:form.color, color:"#fff", fontSize:12, fontWeight:800, display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
                {form.initials || autoInitials(form.name) || "?"}
              </span>
              <span style={{ fontSize:13, fontWeight:600, color:T.text }}>{form.name || "Name preview"}</span>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={save} style={{ background:T.pink, border:"none", borderRadius:7, padding:"7px 18px", color:"#fff", fontSize:13, fontWeight:700 }}>
                {editId ? "💾 Save" : "Add"}
              </button>
              <button onClick={cancel} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:7, padding:"7px 14px", color:T.text2, fontSize:13 }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Technician list */}
        {technicians.length === 0 && (
          <div style={{ textAlign:"center", padding:"24px 0", color:T.text3, fontSize:13 }}>No technicians yet</div>
        )}
        {technicians.map(tech => (
          <div key={tech.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:`1px solid ${T.border}` }}>
            <span style={{ width:36, height:36, borderRadius:"50%", background:tech.color, color:"#fff", fontSize:13, fontWeight:800, display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              {tech.initials}
            </span>
            <span style={{ flex:1, fontSize:14, fontWeight:600, color:T.text }}>{tech.name}</span>
            <button onClick={() => startEdit(tech)}
              style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:6, padding:"4px 12px", color:T.text2, fontSize:12 }}>
              Edit
            </button>
            <button onClick={() => remove(tech.id)}
              style={{ background:T.redBg, border:`1px solid ${T.red}33`, borderRadius:6, padding:"4px 10px", color:T.red, fontSize:12 }}>
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* ── Part Categories ── */}
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:20 }}>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:14, fontWeight:700, color:T.text }}>🏷 Part categories</div>
          <div style={{ fontSize:11, color:T.text3, marginTop:2 }}>Used to organise the inventory. New categories can be added from the inventory page.</div>
        </div>

        {partCategories.length === 0 && (
          <div style={{ textAlign:"center", padding:"16px 0", color:T.text3, fontSize:13 }}>No categories yet</div>
        )}

        {partCategories.map(cat => {
          const count = catalogue.filter(c => c.part_category === cat).length;
          return (
            <div key={cat} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderBottom:`1px solid ${T.border}` }}>
              <span style={{ flex:1, fontSize:13, fontWeight:600, color:T.text }}>{cat}</span>
              <span style={{ fontSize:11, color:T.text3 }}>{count} part{count!==1?"s":""}</span>
              <button onClick={() => removePartCategory(cat)}
                style={{ background:T.redBg, border:`1px solid ${T.red}33`, borderRadius:6, padding:"4px 10px", color:T.red, fontSize:12 }}>
                ✕ Remove
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Backup & Export ── */}
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:20 }}>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:14, fontWeight:700, color:T.text }}>💾 Backup & Export</div>
          <div style={{ fontSize:11, color:T.text3, marginTop:2 }}>Download a full JSON backup of all your data. Safe to do at any time.</div>
        </div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          <button onClick={() => {
            const backup = {
              exported_at: new Date().toISOString(),
              shop: SHOP_NAME,
              tickets, customers, parts, catalogue, technicians, partCategories, intakeLogs, logs,
            };
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type:"application/json" });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement("a");
            a.href = url;
            a.download = `repairflow-backup-${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast("✓ Backup downloaded");
          }} style={{ background:T.green, color:"#fff", border:"none", borderRadius:8, padding:"9px 18px", fontWeight:700, fontSize:13 }}>
            ⬇ Download full backup (JSON)
          </button>
          <button onClick={() => {
            const rows = [["Ticket ID","Type","Customer","Device","Status","Quote","Created"]];
            tickets.forEach(t => {
              const c = customers.find(x => x.id===t.customer_id);
              rows.push([t.id, t.type, c?.name||"", `${t.device_manufacturer||""} ${t.device_model||""}`.trim(), t.status, t.initial_quote, t.created_at?.slice(0,10)]);
            });
            const csv = rows.map(r => r.map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(",")).join("\n");
            const blob = new Blob([csv], { type:"text/csv" });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement("a");
            a.href = url;
            a.download = `repairflow-tickets-${new Date().toISOString().slice(0,10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast("✓ Tickets CSV downloaded");
          }} style={{ background:T.blue, color:"#fff", border:"none", borderRadius:8, padding:"9px 18px", fontWeight:700, fontSize:13 }}>
            ⬇ Tickets CSV
          </button>
          <button onClick={() => {
            const rows = [["Customer","Email","Phone","SMS opt-in"]];
            customers.forEach(c => rows.push([c.name, c.email||"", c.phone||"", c.sms_opt_in?"Yes":"No"]));
            const csv = rows.map(r => r.map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(",")).join("\n");
            const blob = new Blob([csv], { type:"text/csv" });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement("a");
            a.href = url;
            a.download = `repairflow-customers-${new Date().toISOString().slice(0,10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast("✓ Customers CSV downloaded");
          }} style={{ background:T.purple, color:"#fff", border:"none", borderRadius:8, padding:"9px 18px", fontWeight:700, fontSize:13 }}>
            ⬇ Customers CSV
          </button>
        </div>
        <div style={{ marginTop:10, fontSize:11, color:T.text3 }}>
          Your data is stored in Supabase and is always safe — this is an additional local backup.
        </div>
      </div>
    </div>
  );
}

// ─── TEMPLATES EDITOR ─────────────────────────────────────────────────────────
const TEMPLATE_META = [
  { key:"part_arrived",      label:"Part Arrived",       icon:"📦", desc:"Sent when a repair part arrives in stock and all parts for the ticket are ready." },
  { key:"accessory_arrived", label:"Accessory Arrived",  icon:"🛍", desc:"Sent when an accessory order item is marked as arrived." },
  { key:"ready_for_pickup",  label:"Ready for Pickup",   icon:"✅", desc:"Sent when the ticket status is moved to Ready for Pickup." },
];

function TemplatesView({ msgTemplates, setMsgTemplates, db }) {
  const [active, setActive]   = useState("part_arrived");
  const [draft,  setDraft]    = useState(null);
  const [saved,  setSaved]    = useState(false);

  const tmplKeys = Object.keys(DEFAULT_TEMPLATES);
  const current  = draft || msgTemplates[active];

  function startEdit() { setDraft({ ...msgTemplates[active] }); setSaved(false); }
  function cancelEdit() { setDraft(null); }
  async function saveEdit() {
    const updated = { ...msgTemplates, [active]: draft };
    setMsgTemplates(updated);
    await db.saveSetting("msg_templates", updated);
    setDraft(null); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }
  async function resetToDefault() {
    const updated = { ...msgTemplates, [active]: { ...DEFAULT_TEMPLATES[active] } };
    setMsgTemplates(updated);
    await db.saveSetting("msg_templates", updated);
    setDraft(null); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const editing = draft !== null;
  const meta = TEMPLATE_META.find(m => m.key === active);

  const VARS = ["{name}", "{device}", "{tid}", "{shop}", "{shop_addr}"];

  const fieldStyle = (editable) => ({
    ...inp(), width:"100%", resize:"vertical",
    background: editable ? T.surface : T.surface2,
    color: editable ? T.text : T.text2,
    borderColor: editable ? T.blue : T.border,
    fontFamily:"'IBM Plex Mono', monospace",
    fontSize:12,
  });

  return (
    <div style={{ padding:24, maxWidth:820 }}>
      <div style={{ marginBottom:20 }}>
        <h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700, color:T.text }}>Message Templates</h2>
        <div style={{ fontSize:12, color:T.text3 }}>
          Edit the SMS and email messages sent automatically to customers.
          Use variables: {VARS.map(v => (
            <code key={v} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:3, padding:"1px 5px", fontSize:11, marginLeft:4, fontFamily:"'IBM Plex Mono',monospace", color:T.blue }}>{v}</code>
          ))}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"200px 1fr", gap:16 }}>

        {/* ── Template selector ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {TEMPLATE_META.map(m => (
            <button key={m.key} onClick={() => { setActive(m.key); setDraft(null); setSaved(false); }}
              style={{ padding:"10px 12px", borderRadius:8, textAlign:"left", border:`1px solid ${active===m.key?T.blue:T.border}`,
                background:active===m.key?T.blueBg||"#EFF6FF":T.surface2,
                color:active===m.key?T.blue:T.text2, cursor:"pointer" }}>
              <div style={{ fontSize:18, marginBottom:3 }}>{m.icon}</div>
              <div style={{ fontSize:12, fontWeight:700, color:active===m.key?T.blue:T.text }}>{m.label}</div>
            </button>
          ))}
        </div>

        {/* ── Editor ── */}
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:20 }}>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:14 }}>
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:T.text }}>{meta?.icon} {meta?.label}</div>
              <div style={{ fontSize:11, color:T.text3, marginTop:2 }}>{meta?.desc}</div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              {!editing && (
                <>
                  <button onClick={startEdit}
                    style={{ background:T.blue, border:"none", borderRadius:6, padding:"6px 14px", color:"#fff", fontSize:12, fontWeight:700 }}>
                    ✏ Edit
                  </button>
                  <button onClick={resetToDefault}
                    style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:6, padding:"6px 12px", color:T.text2, fontSize:12 }}>
                    ↺ Reset
                  </button>
                </>
              )}
              {editing && (
                <>
                  <button onClick={saveEdit}
                    style={{ background:T.green, border:"none", borderRadius:6, padding:"6px 14px", color:"#fff", fontSize:12, fontWeight:700 }}>
                    💾 Save
                  </button>
                  <button onClick={cancelEdit}
                    style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:6, padding:"6px 12px", color:T.text2, fontSize:12 }}>
                    Cancel
                  </button>
                </>
              )}
              {saved && !editing && (
                <span style={{ fontSize:11, color:T.green, fontWeight:700, alignSelf:"center" }}>✓ Saved</span>
              )}
            </div>
          </div>

          {/* Email */}
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:10, color:T.text3, textTransform:"uppercase", letterSpacing:".08em", fontWeight:700, marginBottom:6 }}>📧 Email</div>
            <div style={{ marginBottom:8 }}>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4 }}>Subject</div>
              {editing
                ? <input value={draft.email_subject} onChange={e => setDraft(d => ({...d, email_subject:e.target.value}))}
                    style={{ ...fieldStyle(true), height:36, resize:"none" }} />
                : <div style={{ ...fieldStyle(false), padding:"8px 12px", borderRadius:7, minHeight:36 }}>{current.email_subject}</div>
              }
            </div>
            <div>
              <div style={{ fontSize:11, color:T.text2, marginBottom:4 }}>Body</div>
              {editing
                ? <textarea value={draft.email_body} onChange={e => setDraft(d => ({...d, email_body:e.target.value}))}
                    rows={8} style={fieldStyle(true)} />
                : <pre style={{ ...fieldStyle(false), padding:"8px 12px", borderRadius:7, whiteSpace:"pre-wrap", lineHeight:1.6, margin:0 }}>{current.email_body}</pre>
              }
            </div>
          </div>

          {/* SMS */}
          <div>
            <div style={{ fontSize:10, color:T.text3, textTransform:"uppercase", letterSpacing:".08em", fontWeight:700, marginBottom:6 }}>📱 SMS</div>
            {editing
              ? <textarea value={draft.sms} onChange={e => setDraft(d => ({...d, sms:e.target.value}))}
                  rows={3} style={fieldStyle(true)} />
              : <pre style={{ ...fieldStyle(false), padding:"8px 12px", borderRadius:7, whiteSpace:"pre-wrap", lineHeight:1.6, margin:0 }}>{current.sms}</pre>
            }
            {editing && (
              <div style={{ fontSize:10, color:T.text3, marginTop:4 }}>
                Character count: <b style={{ color: draft.sms.length > 160 ? T.amber : T.text2 }}>{draft.sms.length}</b>
                {draft.sms.length > 160 && <span style={{ color:T.amber }}> · Will send as {Math.ceil(draft.sms.length/153)} parts</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({ view, setView, pendingCount }) {
  const nav = [
    { key:"dashboard",   icon:"⌘", label:"Dashboard" },
    { key:"customers",   icon:"◈", label:"Customers"  },
    { key:"parts_order", icon:"◎", label:"Order list", badge:pendingCount },
    { key:"catalogue",   icon:"◑", label:"Inventory" },
    { key:"stock_intake", icon:"↓", label:"Stock intake" },
    { key:"logs",        icon:"✉", label:"Messages" },
    { key:"templates",   icon:"✏", label:"Message templates" },
    { key:"settings",    icon:"⚙", label:"Settings" },
  ];
  return (
    <div style={{ width:218, background:T.surface, borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", flexShrink:0, boxShadow:"1px 0 3px rgba(0,0,0,.04)" }}>
      <div style={{ padding:"18px 20px 14px", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ fontWeight:800, fontSize:18, color:T.pink, letterSpacing:"-.03em", lineHeight:1 }}>Foppo</div>
        <div style={{ fontSize:9, color:T.text3, marginTop:3, letterSpacing:".08em", textTransform:"uppercase" }}>RepairSystem</div>
      </div>
      <nav style={{ padding:"10px", flex:1 }}>
        {nav.map(item => (
          <button key={item.key} onClick={() => setView(item.key)} style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 10px", borderRadius:7, border:"none", background:view===item.key?T.pinkBg:"transparent", color:view===item.key?T.pink:T.text2, fontSize:13, fontWeight:view===item.key?700:400, textAlign:"left", marginBottom:2 }}>
            <span style={{ fontSize:15 }}>{item.icon}</span>
            {item.label}
            {item.badge>0 && <span style={{ marginLeft:"auto", background:T.pink, color:"#fff", borderRadius:10, padding:"0 7px", fontSize:10, fontWeight:700, minWidth:20, textAlign:"center" }}>{item.badge}</span>}
          </button>
        ))}
      </nav>
      <div style={{ padding:"12px 16px 16px", borderTop:`1px solid ${T.border}` }}>
        <div style={{ fontSize:9, color:T.text3, letterSpacing:".1em", textTransform:"uppercase", marginBottom:8 }}>Workflow</div>
        {STATUSES.filter(s => s.key !== "closed").map(s => (
          <div key={s.key} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:s.color, flexShrink:0 }}/>
            <span style={{ fontSize:10, color:T.text2 }}>{s.label}</span>
          </div>
        ))}
        <div style={{ marginTop:10, padding:"6px 10px", background:T.pinkBg, borderRadius:6, border:`1px solid ${T.pinkBd}` }}>
          <div style={{ fontSize:9, color:T.pink, letterSpacing:".08em", textTransform:"uppercase" }}>ALV-kanta</div>
          <div style={{ fontSize:14, color:T.pink, fontWeight:800 }}>{(VAT_RATE*100).toFixed(1)}%</div>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function DashboardView({ tickets, customers, parts, openTicket, filterStatus, setFilterStatus, updateTicketStatus, deleteTicket, technicians, filterTech, setFilterTech }) {
  const [sortBy,  setSortBy]  = useState("date");   // "date" | "ticket"
  const [sortDir, setSortDir] = useState("desc");   // "asc" | "desc"

  const active = tickets.filter(t => t.status !== "closed");
  const stats  = [
    { l:"Open tickets",      v:active.length,                                          c:T.pink  },
    { l:"Parts unordered",   v:parts.filter(p=>p.part_status==="pending").length,       c:T.red   },
    { l:"Ready for pickup",  v:tickets.filter(t=>t.status==="ready_for_pickup").length, c:T.green },
    { l:"Est. billing",      v:fmtEur(active.reduce((s,t)=>s+t.initial_quote,0)),      c:T.blue, mono:true },
  ];

  const sorted = [...tickets].sort((a,b) => {
    let cmp = 0;
    if (sortBy === "date")   cmp = new Date(a.created_at) - new Date(b.created_at);
    if (sortBy === "ticket") cmp = a.id.localeCompare(b.id, undefined, { numeric:true });
    return sortDir === "desc" ? -cmp : cmp;
  });

  function toggleSort(field) {
    if (sortBy === field) setSortDir(d => d==="asc"?"desc":"asc");
    else { setSortBy(field); setSortDir("desc"); }
  }

  const SortBtn = ({ field, label }) => {
    const active = sortBy === field;
    return (
      <button onClick={() => toggleSort(field)}
        style={{ background:active?T.pinkBg:T.surface, border:`1px solid ${active?T.pink:T.border}`, color:active?T.pink:T.text2, borderRadius:6, padding:"4px 10px", fontSize:11, fontWeight:600, display:"flex", alignItems:"center", gap:4 }}>
        {label}
        <span style={{ fontSize:10, opacity:.7 }}>{active ? (sortDir==="desc"?"↓":"↑") : "↕"}</span>
      </button>
    );
  };

  return (
    <div style={{ padding:24 }}>
      {/* Stat cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
        {stats.map(s => (
          <div key={s.l} style={{ background:T.surface, border:`1px solid ${T.border}`, borderTop:`3px solid ${s.c}`, borderRadius:10, padding:"16px 20px", boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}>
            <div style={{ fontSize:24, fontWeight:800, color:s.c, fontFamily:s.mono?"'IBM Plex Mono',monospace":"inherit" }}>{s.v}</div>
            <div style={{ fontSize:11, color:T.text2, marginTop:3 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Tech filter */}
      {technicians.length > 0 && (
        <div style={{ display:"flex", gap:6, marginBottom:10, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:10, color:T.text3, textTransform:"uppercase", letterSpacing:".07em", fontWeight:700 }}>Technician</span>
          <button onClick={()=>setFilterTech("all")} style={{ background:filterTech==="all"?T.pinkBg:T.surface, border:`1px solid ${filterTech==="all"?T.pink:T.border}`, color:filterTech==="all"?T.pink:T.text2, borderRadius:6, padding:"3px 10px", fontSize:11, fontWeight:600 }}>All</button>
          <button onClick={()=>setFilterTech("unassigned")} style={{ background:filterTech==="unassigned"?T.amberBg:T.surface, border:`1px solid ${filterTech==="unassigned"?T.amber:T.border}`, color:filterTech==="unassigned"?T.amber:T.text2, borderRadius:6, padding:"3px 10px", fontSize:11, fontWeight:600 }}>Unassigned</button>
          {technicians.map(t => (
            <button key={t.id} onClick={()=>setFilterTech(t.id)}
              style={{ background:filterTech===t.id?t.color+"22":T.surface, border:`1px solid ${filterTech===t.id?t.color:T.border}`, color:filterTech===t.id?t.color:T.text2, borderRadius:6, padding:"3px 10px", fontSize:11, fontWeight:600, display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ width:16, height:16, borderRadius:"50%", background:t.color, color:"#fff", fontSize:8, fontWeight:800, display:"inline-flex", alignItems:"center", justifyContent:"center" }}>{t.initials.slice(0,2)}</span>
              {t.name.split(" ")[0]}
            </button>
          ))}
        </div>
      )}

      {/* Status filters + sort */}
      <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
        <FBtn active={filterStatus==="all"} onClick={()=>setFilterStatus("all")} label="All" count={tickets.length} />
        {STATUSES.map(s => <FBtn key={s.key} active={filterStatus===s.key} onClick={()=>setFilterStatus(s.key)} label={s.label} color={s.color} bg={s.bg} count={tickets.filter(t=>t.status===s.key).length} />)}
        <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
          <span style={{ fontSize:10, color:T.text3, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em" }}>Sort</span>
          <SortBtn field="date"   label="Date" />
          <SortBtn field="ticket" label="Ticket #" />
        </div>
      </div>

      {/* List table */}
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,.05)" }}>
        {/* Header */}
        <div style={{ display:"grid", gridTemplateColumns:"100px 90px 1fr 140px 110px 160px 90px 80px 40px 36px", background:T.surface2, borderBottom:`1px solid ${T.border}`, padding:"0" }}>
          {["Ticket","Device","Description","Customer","Price","Status","Warranty","Date","Tech",""].map(h => (
            <div key={h} style={{ padding:"9px 12px", fontSize:9, fontWeight:700, color:T.text3, textTransform:"uppercase", letterSpacing:".08em" }}>{h}</div>
          ))}
        </div>

        {!tickets.length && (
          <div style={{ padding:"40px", textAlign:"center", color:T.text3, fontSize:13 }}>No tickets</div>
        )}

        {sorted.map((ticket, i) => (
          <TicketRow
            key={ticket.id}
            ticket={ticket}
            customers={customers}
            parts={parts}
            onOpen={() => openTicket(ticket)}
            onStatusChange={newStatus => updateTicketStatus(ticket.id, newStatus)}
            onDelete={() => deleteTicket(ticket.id)}
            zebra={i%2===1}
            technicians={technicians}
          />
        ))}
      </div>
    </div>
  );
}

function FBtn({ active, onClick, label, color, bg, count }) {
  return <button onClick={onClick} style={{ background:active?(bg||T.pinkBg):T.surface, border:`1px solid ${active?(color||T.pink):T.border}`, color:active?(color||T.pink):T.text2, borderRadius:6, padding:"4px 12px", fontSize:11, fontWeight:600, display:"flex", alignItems:"center", gap:4 }}>
    {label} <span style={{ opacity:.6, fontSize:10 }}>{count}</span>
  </button>;
}

function TicketRow({ ticket, customers, parts, onOpen, onStatusChange, onDelete, zebra, technicians }) {
  const cust     = customers.find(c => c.id===ticket.customer_id);
  const info     = getStatus(ticket.status);
  const tParts   = parts.filter(p => p.ticket_id===ticket.id);
  const pendingP = tParts.filter(p => p.part_status==="pending").length;
  const [confirmDel, setConfirmDel] = useState(false);
  const NOTIFY_STATUSES = ["part_arrived","ready_for_pickup"];
  const isAcc    = ticket.type === "accessory";
  const accentC  = isAcc ? T.purple : T.pink;

  return (
    <div style={{ display:"grid", gridTemplateColumns:"100px 90px 1fr 140px 110px 160px 90px 80px 40px 36px", borderTop:`1px solid ${T.border}`, background: zebra ? T.surface2 : T.surface, alignItems:"center", minHeight:46 }}>

      {/* Ticket ID — clickable */}
      <div onClick={onOpen} style={{ padding:"8px 12px", cursor:"pointer" }}>
        <div style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, color:accentC }}>{ticket.id}</div>
        <div style={{ fontSize:9, color:T.text3, marginTop:1 }}>
          {isAcc
            ? <span style={{ color:T.purple, fontWeight:700 }}>📦 ACC</span>
            : <>{CAT_ICON[ticket.device_category]} {ticket.device_manufacturer}</>
          }
        </div>
      </div>

      {/* Model / Item */}
      <div onClick={onOpen} style={{ padding:"8px 12px", cursor:"pointer" }}>
        <div style={{ fontSize:12, fontWeight:600, color:T.text, lineHeight:1.3 }}>
          {isAcc ? (ticket.acc_items?.[0]?.item || "—") : ticket.device_model}
        </div>
        {isAcc && ticket.acc_items?.[0]?.color && (
          <div style={{ fontSize:10, color:T.text3 }}>{ticket.acc_items[0].color}</div>
        )}
      </div>

      {/* Description / Issue */}
      <div onClick={onOpen} style={{ padding:"8px 12px", cursor:"pointer" }}>
        <div style={{ fontSize:12, color:T.text2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {isAcc
            ? (ticket.acc_items?.length > 1 ? `${ticket.acc_items.length} items` : ticket.acc_items?.[0]?.item || "—")
            : ticket.issue_desc
          }
        </div>
        {pendingP > 0 && <div style={{ fontSize:9, color:T.red, marginTop:1 }}>⚠ {pendingP} part{pendingP>1?"s":""} unordered</div>}
      </div>

      {/* Customer */}
      <div style={{ padding:"8px 12px" }}>
        <div style={{ fontSize:12, color:T.text, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{cust?.name}</div>
        <div style={{ fontSize:10, color:T.text3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{cust?.email}</div>
      </div>

      {/* Price */}
      <div style={{ padding:"8px 12px" }}>
        <div style={{ fontSize:13, fontWeight:800, color:T.pink }}>{fmtEur(ticket.initial_quote)}</div>
        <div style={{ fontSize:9, color:T.text3 }}>{fmtEur(exVat(ticket.initial_quote))} ALV0</div>
      </div>

      {/* Status dropdown — inline change */}
      <div style={{ padding:"6px 8px" }}>
        <div style={{ position:"relative" }}>
          <select
            value={ticket.status}
            onChange={e => { e.stopPropagation(); onStatusChange(e.target.value); }}
            onClick={e => e.stopPropagation()}
            style={{ width:"100%", background:info.bg, border:`1px solid ${info.color}44`, borderRadius:6, color:info.color, fontSize:10, fontWeight:700, padding:"4px 6px", cursor:"pointer", appearance:"auto" }}
          >
            {STATUSES.map(s => (
              <option key={s.key} value={s.key}>{s.key==="part_arrived"||s.key==="ready_for_pickup" ? "📬 "+s.label : s.label}</option>
            ))}
          </select>
          {NOTIFY_STATUSES.includes(ticket.status) && (
            <div style={{ fontSize:8, color:T.green, marginTop:2, fontWeight:600 }}>✓ Notification sent</div>
          )}
        </div>
      </div>

      {/* Warranty */}
      <div style={{ padding:"8px 12px" }}>
        {ticket.warranty_months
          ? <span style={{ fontSize:11, color:T.green, fontWeight:600 }}>{ticket.warranty_months} kk</span>
          : <span style={{ fontSize:11, color:T.text3 }}>—</span>}
      </div>

      {/* Date */}
      <div style={{ padding:"8px 12px" }}>
        <div style={{ fontSize:10, color:T.text3 }}>{fmtDate(ticket.created_at)}</div>
      </div>

      {/* Tech avatar */}
      <div style={{ padding:"4px 6px", display:"flex", alignItems:"center", justifyContent:"center" }}>
        {(() => {
          const tech = (technicians||[]).find(t => t.id===ticket.technician_id);
          return tech
            ? <span title={tech.name} style={{ width:24, height:24, borderRadius:"50%", background:tech.color, color:"#fff", fontSize:9, fontWeight:800, display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{tech.initials}</span>
            : <span style={{ width:24, height:24, borderRadius:"50%", background:T.surface2, border:`1px dashed ${T.border2}`, display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:9, color:T.text3 }}>—</span>;
        })()}
      </div>

      {/* Delete */}
      <div style={{ padding:"4px 6px", display:"flex", alignItems:"center", justifyContent:"center" }}>
        {confirmDel ? (
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            title="Confirm delete"
            style={{ background:T.red, border:"none", borderRadius:5, padding:"3px 6px", color:"#fff", fontSize:10, fontWeight:700 }}
          >✕</button>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); setConfirmDel(true); setTimeout(()=>setConfirmDel(false),3000); }}
            title="Delete ticket"
            style={{ background:"transparent", border:`1px solid ${T.border}`, borderRadius:5, padding:"3px 6px", color:T.text3, fontSize:11 }}
          >🗑</button>
        )}
      </div>
    </div>
  );
}

// ─── TICKET DETAIL ────────────────────────────────────────────────────────────
function TicketView({ ticketId, tickets, customers, parts, logs, setTickets, setParts, updateTicketStatus, updatePartStatus, deleteTicket, toast, technicians, catalogue, setCatalogue, allModels, setAllModels, db }) {
  const ticket = tickets.find(t => t.id===ticketId);
  const cust   = ticket ? customers.find(c => c.id===ticket.customer_id) : null;
  const tParts = parts.filter(p => p.ticket_id===ticketId);
  const tLogs  = logs.filter(l => l.ticket_id===ticketId);
  const [newNote,     setNewNote]     = useState("");
  const [showAddPart, setShowAddPart] = useState(false);
  const [addPartMode, setAddPartMode] = useState("catalogue"); // "catalogue" | "custom"
  const [catSearch,   setCatSearch]   = useState("");
  const [newPart,     setNewPart]     = useState({ part_name:"", supplier_sku:"", qty:1, cost:"", is_accessory:false });

  const [showPrint,   setShowPrint]   = useState(false);

  const [confirmDel, setConfirmDel] = useState(false);
  if (!ticket) return <div style={{ padding:40, color:T.text2 }}>Ticket not found.</div>;
  const si = STATUSES.findIndex(s => s.key===ticket.status);

  async function addNote() {
    if (!newNote.trim()) return;
    const updated = tickets.map(t => t.id===ticketId ? { ...t, technician_notes:t.technician_notes+(t.technician_notes?"\n":"")+`[${new Date().toLocaleTimeString("fi-FI")}] ${newNote}` } : t);
    setTickets(updated);
    const t = updated.find(t => t.id===ticketId);
    await db.saveTicket(t);
    setNewNote(""); toast("Note added");
  }
  async function addPartFromCatalogue(catPart, qty) {
    const q = parseInt(qty) || 1;
    const alreadyReserved = (parts||[]).filter(p => p.catalogue_id===catPart.id && (p.part_status==="pending"||p.part_status==="ordered")).reduce((s,p)=>s+(p.qty||1),0);
    const availableNow = catPart.stock_qty - alreadyReserved;
    const inStock = availableNow >= q;
    const partStatus = inStock ? "arrived" : "pending";
    const newP = {
      id: genId("p"), ticket_id: ticketId,
      part_name: catPart.name, supplier_sku: catPart.sku,
      qty: q, cost: catPart.avg_cost ?? catPart.cost, part_status: partStatus,
      is_accessory: false, catalogue_id: catPart.id,
    };
    setParts(ps => [...ps, newP]);
    await db.savePart(newP);
    if (inStock) {
      const updatedCat = { ...catPart, stock_qty: catPart.stock_qty - q };
      setCatalogue(cs => cs.map(c => c.id===catPart.id ? updatedCat : c));
      await db.saveCatalogueItem(updatedCat);
      toast(`✓ ${catPart.name} — pulled from stock (${availableNow - q} left)`);
    } else {
      toast(`${catPart.name} added — needs ordering (available: ${availableNow})`);
    }
    setCatSearch(""); setShowAddPart(false);
  }

  async function addPart() {
    if (!newPart.part_name.trim()) return;
    const newP = { id:genId("p"), ticket_id:ticketId, ...newPart, qty:parseInt(newPart.qty)||1, cost:parseFloat(newPart.cost)||0, part_status:"pending" };
    setParts(ps => [...ps, newP]);
    await db.savePart(newP);
    setNewPart({ part_name:"", supplier_sku:"", qty:1, cost:"", is_accessory:false });
    setShowAddPart(false); toast("Part added");
  }

  async function save(field, val) {
    setTickets(ts => ts.map(t => t.id===ticketId ? { ...t, [field]:val } : t));
    await supabase.from("tickets").update({ [field]: val }).eq("id", ticketId);
  }

  const isAcc     = ticket.type === "accessory";
  const accentC   = isAcc ? T.purple : T.pink;
  const typeBadge = isAcc
    ? <span style={{ fontSize:10, fontWeight:700, color:T.purple, background:T.purpleBg, border:`1px solid ${T.purple}44`, borderRadius:4, padding:"2px 8px" }}>📦 Accessory Order</span>
    : <span style={{ fontSize:10, fontWeight:700, color:T.pink, background:T.pinkBg, border:`1px solid ${T.pinkBd}`, borderRadius:4, padding:"2px 8px" }}>🔧 Device Repair</span>;

  return (
    <div style={{ padding:24, maxWidth:1100 }}>
      {/* Print modal */}
      {showPrint && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.35)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={() => setShowPrint(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:28, width:360, boxShadow:"0 12px 40px rgba(0,0,0,.15)" }}>
            <div style={{ fontSize:15, fontWeight:700, color:T.text, marginBottom:4 }}>🖨 Tulosta kuitti</div>
            <div style={{ fontSize:12, color:T.text2, marginBottom:6 }}>Valitse kuitin muoto</div>
            <div style={{ fontSize:11, color:T.amber, background:T.amberBg, border:`1px solid ${T.amber}33`, borderRadius:6, padding:"7px 10px", marginBottom:18 }}>
              ⚠ Tulostus avaa erillisen ikkunan. Salli ponnahdusikkunat selaimessa.
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {[["📄","A4 receipt","For customer / archive","a4"],["🧾","Thermal receipt","58-80mm till receipt","thermal"]].map(([ic,lab,desc,mode]) => (
                <button key={mode} onClick={() => { printReceipt(ticket, cust, tParts, mode); setShowPrint(false); }} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:8, padding:"14px 8px", color:T.text, fontSize:13, fontWeight:600, display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:24 }}>{ic}</span><span>{lab}</span>
                  <span style={{ fontSize:10, color:T.text3 }}>{desc}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setShowPrint(false)} style={{ marginTop:12, width:"100%", background:"transparent", border:`1px solid ${T.border}`, borderRadius:7, padding:"8px", color:T.text2, fontSize:12 }}>Peruuta</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", gap:16, marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4, flexWrap:"wrap" }}>
            <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:18, fontWeight:700, color:accentC }}>{ticket.id}</span>
            {typeBadge}
            <StatusBadge status={ticket.status} />
            {!isAcc && <span style={{ fontSize:12, color:T.text3 }}>{CAT_ICON[ticket.device_category]} {ticket.device_category} · {ticket.device_manufacturer}</span>}
          </div>
          <div style={{ fontSize:22, fontWeight:700, color:T.text }}>
            {isAcc ? (ticket.acc_items?.[0]?.item || ticket.issue_desc) : ticket.device_model}
          </div>
          {isAcc && ticket.acc_items?.length > 1 && (
            <div style={{ fontSize:13, color:T.purple, marginTop:2 }}>+ {ticket.acc_items.length - 1} more item{ticket.acc_items.length > 2 ? "s" : ""}</div>
          )}
          {isAcc && ticket.device_model && (
            <div style={{ fontSize:12, color:T.text3, marginTop:2 }}>For: {ticket.device_manufacturer} {ticket.device_model}</div>
          )}
        </div>
        <div style={{ display:"flex", gap:8, flexShrink:0, flexWrap:"wrap", justifyContent:"flex-end", alignItems:"center" }}>
          <button onClick={() => setShowPrint(true)} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:7, padding:"7px 14px", color:T.text2, fontSize:12, display:"flex", alignItems:"center", gap:5 }}>🖨 Print</button>
          {/* Technician assignee */}
          {(() => {
            const tech = (technicians||[]).find(t => t.id===ticket.technician_id);
            return (
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                {tech && <span style={{ width:26, height:26, borderRadius:"50%", background:tech.color, color:"#fff", fontSize:10, fontWeight:800, display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{tech.initials}</span>}
                <select value={ticket.technician_id||""} onChange={async e => { const val = e.target.value||null; setTickets(ts => ts.map(t => t.id===ticketId ? {...t, technician_id:val} : t)); await supabase.from("tickets").update({ technician_id: val }).eq("id", ticketId); }}
                  style={{ background:tech?tech.color+"18":T.surface2, border:`1px solid ${tech?tech.color+"66":T.border}`, borderRadius:7, color:tech?tech.color:T.text2, fontSize:12, fontWeight:600, padding:"5px 8px", cursor:"pointer" }}>
                  <option value="">Unassigned</option>
                  {(technicians||[]).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            );
          })()}
          <select value={ticket.status} onChange={e => updateTicketStatus(ticketId, e.target.value)}
            style={{ background:getStatus(ticket.status).bg, border:`1px solid ${getStatus(ticket.status).color}55`, borderRadius:7, color:getStatus(ticket.status).color, fontSize:12, fontWeight:700, padding:"7px 10px", cursor:"pointer" }}>
            {STATUSES.map(s => <option key={s.key} value={s.key}>{["part_arrived","ready_for_pickup"].includes(s.key)?"📬 "+s.label:s.label}</option>)}
          </select>
          {confirmDel
            ? <button onClick={() => deleteTicket(ticketId)} style={{ background:T.red, border:"none", borderRadius:7, padding:"7px 14px", color:"#fff", fontSize:12, fontWeight:700 }}>Confirm delete</button>
            : <button onClick={() => { setConfirmDel(true); setTimeout(()=>setConfirmDel(false),3500); }} style={{ background:T.redBg, border:`1px solid ${T.red}33`, borderRadius:7, padding:"7px 12px", color:T.red, fontSize:12 }}>🗑 Delete</button>
          }
        </div>
      </div>

      {/* Pipeline */}
      <div style={{ display:"flex", marginBottom:24, borderRadius:8, overflow:"hidden", border:`1px solid ${T.border}` }}>
        {STATUSES.filter(s => s.key!=="closed").map((s,i) => {
          const cur = s.key===ticket.status, past = si > i;
          return <div key={s.key} style={{ flex:1, padding:"7px 2px", textAlign:"center", fontSize:8, fontWeight:cur?700:400, background:cur?s.bg:past?T.surface2:T.surface, borderRight:`1px solid ${T.border}`, color:cur?s.color:past?T.text3:T.border2, letterSpacing:".04em", textTransform:"uppercase", transition:"all .2s" }}>
            {cur && "▶ "}{s.label}
          </div>;
        })}
      </div>

      {/* ── ACCESSORY ORDER DETAIL GRID ── */}
      {ticket.type === "accessory" && (
        <AccOrderDetail
          ticket={ticket} ticketId={ticketId} cust={cust} tLogs={tLogs}
          setTickets={setTickets} newNote={newNote} setNewNote={setNewNote}
          addNote={addNote} save={save}
        />
      )}

      {/* ── REPAIR DETAIL GRID ── */}
      {ticket.type !== "accessory" && (
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        {/* Customer + Device */}
        <Sec title="Customer + Device">
          <IR l="Customer"    v={cust?.name} />
          <IR l="Email" v={cust?.email} />
          <IR l="Phone"    v={cust?.phone} />
          <IR l="SMS opt-in"   v={cust?.sms_opt_in?"✓ Yes":"✗ No"} />
          <IR l="Category"  v={`${ticket.device_category} · ${ticket.device_manufacturer}`} />
          <IR l="Model"      v={ticket.device_model} />
          <IR l="IMEI/S/N"   v={ticket.serial_imei} mono />

          {/* Access code */}
          <div style={{ marginTop:10, paddingTop:8, borderTop:`1px solid ${T.border}` }}>
            <div style={{ fontSize:10, color:T.text3, letterSpacing:".07em", textTransform:"uppercase", marginBottom:4 }}>🔐 Access code / Pattern</div>
            <input value={ticket.access_code||""} onChange={e => save("access_code", e.target.value)} placeholder="PIN, password or pattern…" style={{ ...inp(), fontFamily:"'IBM Plex Mono',monospace", borderColor:ticket.access_code?T.pink:T.border }} />
          </div>

          {/* Warranty */}
          <div style={{ marginTop:10 }}>
            <div style={{ fontSize:10, color:T.text3, letterSpacing:".07em", textTransform:"uppercase", marginBottom:6 }}>🛡 Warranty</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {WARRANTY_OPTIONS.map(w => (
                <button key={w.value} type="button" onClick={() => save("warranty_months", w.value)} style={{ padding:"5px 14px", borderRadius:6, border:`1px solid ${ticket.warranty_months===w.value?T.pink:T.border}`, background:ticket.warranty_months===w.value?T.pinkBg:T.surface2, color:ticket.warranty_months===w.value?T.pink:T.text2, fontSize:12, fontWeight:600 }}>
                  {w.label}
                </button>
              ))}
            </div>
            {ticket.warranty_months && <div style={{ fontSize:11, color:T.green, marginTop:5 }}>✓ Warranty: {WARRANTY_OPTIONS.find(w=>w.value===ticket.warranty_months)?.label}</div>}
          </div>

          <div style={{ marginTop:12 }}>
            <PriceEditor ticket={ticket} save={save} />
          </div>
        </Sec>

        {/* Parts */}
        <Sec title={`Parts (${tParts.length})`} action={<button onClick={() => { setShowAddPart(!showAddPart); setCatSearch(""); setAddPartMode("catalogue"); }} style={{ fontSize:11, background:showAddPart?T.pinkBg:T.surface2, border:`1px solid ${showAddPart?T.pink:T.border}`, borderRadius:5, padding:"3px 10px", color:showAddPart?T.pink:T.text2, fontWeight:700 }}>+ Add part</button>}>
          {showAddPart && (() => {
            // Determine compatible parts for this ticket model
            const modelId   = (allModels||[]).find(m => m.model_name === ticket.device_model)?.id;
            const cat       = ticket.device_category;
            const compatible = (catalogue||[]).filter(c =>
              c.compatible_models.includes(modelId) ||
              (c.compatible_categories.includes(cat)) ||
              (c.compatible_categories.length === 0 && c.compatible_models.length === 0)
            );
            const others = (catalogue||[]).filter(c => !compatible.find(x=>x.id===c.id));
            const q = catSearch.toLowerCase();
            const filterParts = list => list.filter(c => !q || c.name.toLowerCase().includes(q) || c.sku.toLowerCase().includes(q));
            const filtComp  = filterParts(compatible);
            const filtOther = filterParts(others);
            // Compute reserved qty per catalogue part (pending/ordered on ANY ticket)
            const reservedMap = {};
            (parts||[]).forEach(p => {
              if (p.catalogue_id && (p.part_status==="pending" || p.part_status==="ordered")) {
                reservedMap[p.catalogue_id] = (reservedMap[p.catalogue_id]||0) + (p.qty||1);
              }
            });
            const avail = c => c.stock_qty - (reservedMap[c.id]||0);

            return (
              <div style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:8, padding:12, marginBottom:12 }}>
                {/* Mode tabs */}
                <div style={{ display:"flex", gap:4, marginBottom:10 }}>
                  {[["catalogue","📦 From catalogue"],["custom","✏ Custom part"]].map(([k,l]) => (
                    <button key={k} onClick={()=>setAddPartMode(k)}
                      style={{ fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:5, border:`1px solid ${addPartMode===k?T.pink:T.border}`, background:addPartMode===k?T.pinkBg:T.surface, color:addPartMode===k?T.pink:T.text2 }}>
                      {l}
                    </button>
                  ))}
                </div>

                {addPartMode === "catalogue" && (
                  <div>
                    <input autoFocus placeholder="Search parts by name or SKU…" value={catSearch} onChange={e=>setCatSearch(e.target.value)}
                      style={{ ...inp(), width:"100%", marginBottom:8 }} />

                    {/* Compatible parts */}
                    {filtComp.length > 0 && (
                      <div style={{ marginBottom:8 }}>
                        <div style={{ fontSize:9, color:T.green, fontWeight:700, textTransform:"uppercase", letterSpacing:".08em", marginBottom:4 }}>
                          ✓ Compatible with {ticket.device_model || ticket.device_category}
                        </div>
                        {filtComp.map(c => <CatPartRow key={c.id} part={c} available={avail(c)} onAdd={(qty)=>addPartFromCatalogue(c,qty)} />)}
                      </div>
                    )}

                    {/* Other catalogue parts */}
                    {filtOther.length > 0 && (
                      <div>
                        {(filtComp.length > 0 || catSearch) && (
                          <div style={{ fontSize:9, color:T.text3, fontWeight:700, textTransform:"uppercase", letterSpacing:".08em", marginBottom:4, marginTop:8 }}>
                            All other parts
                          </div>
                        )}
                        {filtOther.map(c => <CatPartRow key={c.id} part={c} available={avail(c)} onAdd={(qty)=>addPartFromCatalogue(c,qty)} />)}
                      </div>
                    )}

                    {filtComp.length === 0 && filtOther.length === 0 && (
                      <div style={{ fontSize:12, color:T.text3, textAlign:"center", padding:"12px 0" }}>No parts found</div>
                    )}
                  </div>
                )}

                {addPartMode === "custom" && (
                  <div>
                    <input placeholder="Part name *" value={newPart.part_name} onChange={e => setNewPart(p => ({...p,part_name:e.target.value}))} style={{ ...inp(), marginBottom:6, width:"100%" }} />
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
                      <input placeholder="Supplier SKU" value={newPart.supplier_sku} onChange={e => setNewPart(p => ({...p,supplier_sku:e.target.value}))} style={inp()} />
                      <input placeholder="Price excl. VAT (€)" type="number" value={newPart.cost} onChange={e => setNewPart(p => ({...p,cost:e.target.value}))} style={inp()} />
                    </div>
                    {parseFloat(newPart.cost) > 0 && (
                      <div style={{ fontSize:11, color:T.text2, background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"5px 10px", marginBottom:8, display:"flex", gap:16 }}>
                        <span>Ex. VAT: <b style={{color:T.text}}>{fmtEur(parseFloat(newPart.cost))}</b></span>
                        <span>VAT {(VAT_RATE*100).toFixed(1)}%: <b style={{color:T.amber}}>{fmtEur(parseFloat(newPart.cost)*VAT_RATE)}</b></span>
                        <span>Incl. VAT: <b style={{color:T.pink}}>{fmtEur(parseFloat(newPart.cost)*(1+VAT_RATE))}</b></span>
                      </div>
                    )}
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <label style={{ fontSize:12, color:T.text2, display:"flex", alignItems:"center", gap:5, cursor:"pointer" }}>
                        <input type="checkbox" checked={newPart.is_accessory} onChange={e => setNewPart(p => ({...p,is_accessory:e.target.checked}))} /> Accessory
                      </label>
                      <button onClick={addPart} style={{ marginLeft:"auto", background:T.pink, border:"none", borderRadius:5, padding:"5px 16px", color:"#fff", fontSize:12, fontWeight:700 }}>Add</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          {!tParts.length && <div style={{ fontSize:12, color:T.text3, padding:"10px 0" }}>No parts added</div>}
          {tParts.map(p => (
            <div key={p.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0", borderBottom:`1px solid ${T.border}` }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, color:T.text, marginBottom:1 }}>
                  {p.part_name}
                  {p.is_accessory && <span style={{ fontSize:9, color:T.purple, background:T.purpleBg, border:`1px solid ${T.purple}33`, borderRadius:3, padding:"1px 5px", marginLeft:5 }}>ACC.</span>}
                </div>
                <div style={{ fontSize:10, color:T.text3, fontFamily:"'IBM Plex Mono',monospace" }}>{p.supplier_sku||"—"} · {p.qty}× · <span title="excl. VAT">{fmtEur(p.cost)}</span> <span style={{color:T.text2}}>→</span> <span style={{color:T.pink}} title="incl. VAT">{fmtEur(p.cost*(1+VAT_RATE))}</span> <span style={{color:T.text3,fontSize:9}}>incl. VAT</span></div>
              </div>
              <select value={p.part_status} onChange={e => updatePartStatus(p.id, e.target.value)} style={{ ...inp(), width:"auto", fontSize:11 }}>
                {PART_STATUS_ORDER.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
              </select>
              <PartBadge status={p.part_status} />
              <button
                onClick={async () => {
                  if (p.catalogue_id && p.part_status === "arrived") {
                    setCatalogue(cs => cs.map(c => c.id===p.catalogue_id ? {...c, stock_qty: c.stock_qty + (p.qty||1)} : c));
                    toast(`Part removed — ${p.qty||1}× returned to stock`, "warn");
                  } else {
                    toast("Part removed", "warn");
                  }
                  setParts(ps => ps.filter(x => x.id !== p.id));
                  await db.deletePart(p.id);
                }}
                title="Remove part"
                style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:5, padding:"3px 7px", color:T.red, fontSize:11, flexShrink:0 }}>✕</button>
            </div>
          ))}
          {tParts.length > 0 && <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${T.border}` }}><VatBox total={tParts.reduce((s,p)=>s+p.cost*p.qty,0)*(1+VAT_RATE)} /></div>}
        </Sec>

        {/* Notes */}
        <Sec title="Technician notes">
          <pre style={{ fontSize:12, color:T.text2, whiteSpace:"pre-wrap", margin:"0 0 10px", lineHeight:1.7, minHeight:40, fontFamily:"'IBM Plex Mono',monospace" }}>{ticket.technician_notes||"No notes."}</pre>
          <div style={{ display:"flex", gap:8 }}>
            <input value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={e => e.key==="Enter" && addNote()} placeholder="Add note…" style={{ ...inp(), flex:1 }} />
            <button onClick={addNote} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:6, padding:"5px 12px", color:T.pink, fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>+ Add</button>
          </div>
        </Sec>

        {/* Log */}
        <Sec title={`Notification log (${tLogs.length})`}>
          {!tLogs.length && <div style={{ fontSize:12, color:T.text3 }}>No notifications sent yet</div>}
          {tLogs.map(l => {
            const TMPL = { part_arrived:"Part arrived", accessory_arrived:"Accessory arrived", ready_for_pickup:"Ready for pickup" };
            const isEmail = l.channel==="email";
            const msg = l.message;
            return (
              <div key={l.id} style={{ padding:"8px 10px", borderBottom:`1px solid ${T.border}`, background:T.surface2, borderRadius:6, marginBottom:6 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <span style={{ fontSize:16 }}>{isEmail?"📧":"📱"}</span>
                    <div>
                      <div style={{ fontSize:12, fontWeight:600, color:T.text }}>{TMPL[l.template_key]||l.template_key}</div>
                      <div style={{ fontSize:10, color:T.text3 }}>{fmtDate(l.sent_at, true)} · {isEmail?"Email":"SMS"}</div>
                    </div>
                  </div>
                  <span style={{ fontSize:10, color:T.green, fontWeight:700 }}>✓ Sent</span>
                </div>
                {msg && (
                  <div style={{ marginTop:6, fontSize:11, color:T.text2, background:T.surface, border:`1px solid ${T.border}`, borderRadius:5, padding:"6px 10px", fontFamily:isEmail?"'IBM Plex Sans',sans-serif":"'IBM Plex Mono',monospace", whiteSpace:"pre-wrap", lineHeight:1.5, maxHeight:80, overflow:"hidden" }}>
                    {isEmail ? (msg.body||"").slice(0,180)+"…" : msg}
                  </div>
                )}
              </div>
            );
          })}
        </Sec>
      </div>
      )}
    </div>
  );
}

// ─── PARTS ORDER ──────────────────────────────────────────────────────────────
function PartsOrderView({ tickets, setTickets, customers, parts, updatePartStatus, manualOrders, setManualOrders, toast, catalogue, setCatalogue, db, sendNotification }) {
  const [showForm, setShowForm] = useState(false);
  const [mf, setMf] = useState({ item_name:"", supplier_sku:"", qty:1, cost:"", note:"" });

  // ── repair parts ──────────────────────────────────────────────────────────
  const pending  = parts.filter(p => p.part_status==="pending");
  const ordered  = parts.filter(p => p.part_status==="ordered");

  // ── accessory order items (flat list across all acc tickets) ──────────────
  const accTickets = tickets.filter(t => t.type === "accessory");
  const accPending = [], accOrdered = [];
  accTickets.forEach(t => (t.acc_items || []).forEach(i => {
    const row = { ...i, _ticketId: t.id, _customer: customers.find(c => c.id === t.customer_id), _device: t.device_model };
    if (i.status === "pending")  accPending.push(row);
    if (i.status === "ordered")  accOrdered.push(row);
  }));

  async function updateAccItemStatus(ticketId, itemId, status) {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return;

    const updatedAccItems = (ticket.acc_items || []).map(i => i.id === itemId ? { ...i, status } : i);
    const updatedTicket = { ...ticket, acc_items: updatedAccItems };

    setTickets(ts => ts.map(t => t.id === ticketId ? updatedTicket : t));
    await supabase.from("tickets").update({ acc_items: updatedAccItems }).eq("id", ticketId);

    // If all items are now arrived → advance ticket + notify customer
    if (status === "arrived") {
      const allArrived = updatedAccItems.every(i => i.status === "arrived");
      if (allArrived) {
        const cust = customers.find(c => c.id === ticket.customer_id);
        setTickets(ts => ts.map(t => t.id === ticketId ? { ...t, status: "part_arrived", acc_items: updatedAccItems } : t));
        await supabase.from("tickets").update({ status: "part_arrived" }).eq("id", ticketId);
        if (cust) {
          const { icons } = await sendNotification("accessory_arrived", cust, ticket);
          toast(`${icons} All items arrived — notified ${cust.name}`, "success");
        } else {
          toast("All items arrived — ticket moved to Part Arrived", "success");
        }
      } else {
        const remaining = updatedAccItems.filter(i => i.status !== "arrived").length;
        toast(`Item marked arrived · ${remaining} item${remaining !== 1 ? "s" : ""} still pending`);
      }
    }
  }

  // ── manual orders ─────────────────────────────────────────────────────────
  const mPending = manualOrders.filter(m => m.status==="pending");
  const mOrdered = manualOrders.filter(m => m.status==="ordered");

  function addManual() {
    if (!mf.item_name.trim()) { toast("Item name required", "error"); return; }
    setManualOrders(mo => [...mo, { id:genId("mo"), ...mf, qty:parseInt(mf.qty)||1, cost:parseFloat(mf.cost)||0, status:"pending", created_at:new Date().toISOString() }]);
    setMf({ item_name:"", supplier_sku:"", qty:1, cost:"", note:"" });
    setShowForm(false); toast("Manual order added");
  }
  function markM(id, status) { setManualOrders(mo => mo.map(m => m.id===id ? {...m,status} : m)); }
  function delM(id)           { setManualOrders(mo => mo.filter(m => m.id!==id)); toast("Deleted","warn"); }

  // ── stats ─────────────────────────────────────────────────────────────────
  const totalPending    = pending.length + accPending.length + mPending.length;
  const totalAwaiting   = ordered.length + accOrdered.length + mOrdered.length;
  const repairCostEx    = pending.reduce((s,p)=>s+p.cost*p.qty,0);
  const manualCostEx    = mPending.reduce((s,m)=>s+(parseFloat(m.cost)||0)*m.qty,0);
  const accCostIncl     = accPending.reduce((s,i)=>s+(i.price_incl_vat||0)*(i.qty||1),0);
  const totalCostIncl   = (repairCostEx + manualCostEx) * (1+VAT_RATE) + accCostIncl;

  // ── low-stock catalogue parts (below min) that have no pending order ──────
  const lowStockParts = (catalogue||[]).filter(c => c.stock_qty < c.min_stock);

  function markAllOrdered() {
    pending.forEach(p => updatePartStatus(p.id,"ordered"));
    accPending.forEach(i => updateAccItemStatus(i._ticketId, i.id, "ordered"));
    mPending.forEach(m => markM(m.id,"ordered"));
  }

  function exportCSV() {
    const H = ["Type","Ticket","Customer","Device","Item","SKU","Qty","Price ex.VAT","VAT 25.5%","Total incl.VAT","Notes"];
    const repairRows = pending.map(p => {
      const t=tickets.find(t=>t.id===p.ticket_id), c=customers.find(c=>c.id===t?.customer_id);
      return ["Repair part",t?.id,c?.name,t?.device_model,p.part_name,p.supplier_sku||"—",p.qty,p.cost.toFixed(2),(p.cost*VAT_RATE).toFixed(2),(p.cost*(1+VAT_RATE)).toFixed(2),""];
    });
    const accRows = accPending.map(i => {
      const p = i.price_incl_vat||0;
      return ["Accessory",i._ticketId,i._customer?.name||"—",i._device||"—",i.item+(i.color?` (${i.color})`:""),"—",i.qty,exVat(p).toFixed(2),vatAmt(p).toFixed(2),(p*(i.qty||1)).toFixed(2),""];
    });
    const mRows = mPending.map(m => { const mc=parseFloat(m.cost)||0; return ["Manual","—","—","—",m.item_name,m.supplier_sku||"—",m.qty,mc.toFixed(2),(mc*VAT_RATE).toFixed(2),(mc*(1+VAT_RATE)).toFixed(2),m.note||""]; });
    const csv = [H,...repairRows,...accRows,...mRows].map(r=>r.join(";")).join("\n");
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"})); a.download=`order-list-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    toast("CSV exported!");
  }

  return (
    <div style={{ padding:24 }}>

      {/* ── Header ── */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
        <div>
          <h2 style={{ margin:0, fontSize:20, fontWeight:700, color:T.text }}>Order List</h2>
          <div style={{ fontSize:12, color:T.text3, marginTop:2 }}>{new Date().toLocaleDateString("en-GB",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
          <button onClick={() => setShowForm(!showForm)} style={{ background:showForm?T.pinkBg:T.surface, border:`1px solid ${showForm?T.pink:T.border}`, borderRadius:7, padding:"7px 14px", color:showForm?T.pink:T.text2, fontSize:12, fontWeight:700 }}>+ Manual</button>
          <button onClick={markAllOrdered} disabled={!totalPending} style={{ background:T.blue, border:"none", borderRadius:7, padding:"7px 14px", color:"#fff", fontSize:12, fontWeight:700, opacity:totalPending?1:.4, cursor:totalPending?"pointer":"default" }}>Mark all ordered</button>
          <button onClick={exportCSV} disabled={!totalPending} style={{ background:T.green, border:"none", borderRadius:7, padding:"7px 14px", color:"#fff", fontSize:12, fontWeight:700, opacity:totalPending?1:.4, cursor:totalPending?"pointer":"default" }}>↓ Export CSV</button>
        </div>
      </div>

      {/* ── Manual form ── */}
      {showForm && (
        <div style={{ background:T.surface, border:`1px solid ${T.pinkBd}`, borderRadius:10, padding:16, marginBottom:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:T.pink, marginBottom:12, textTransform:"uppercase", letterSpacing:".07em" }}>Add manual order item</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 120px 70px 120px", gap:8, marginBottom:8 }}>
            <input placeholder="Item name *" value={mf.item_name} onChange={e=>setMf(f=>({...f,item_name:e.target.value}))} style={inp()} />
            <input placeholder="SKU" value={mf.supplier_sku} onChange={e=>setMf(f=>({...f,supplier_sku:e.target.value}))} style={inp()} />
            <input placeholder="Qty" type="number" min="1" value={mf.qty} onChange={e=>setMf(f=>({...f,qty:e.target.value}))} style={inp()} />
            <input placeholder="Price excl. VAT (€)" type="number" step="0.01" value={mf.cost} onChange={e=>setMf(f=>({...f,cost:e.target.value}))} style={inp()} />
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <input placeholder="Notes (optional)" value={mf.note} onChange={e=>setMf(f=>({...f,note:e.target.value}))} style={{ ...inp(), flex:1 }} />
            <button onClick={addManual} style={{ background:T.pink, border:"none", borderRadius:7, padding:"8px 18px", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer" }}>Add to list</button>
          </div>
        </div>
      )}

      {/* ── Stats ── */}
      <div style={{ display:"flex", gap:12, marginBottom:20, flexWrap:"wrap" }}>
        {[
          ["Pending to order", totalPending,    T.red  ],
          ["Ordered/awaiting", totalAwaiting,   T.blue ],
          ["Total incl. VAT",  fmtEur(totalCostIncl), T.purple],
          ["Low stock items",  lowStockParts.length, T.amber],
        ].map(([l,v,c]) => (
          <div key={l} style={{ background:T.surface, border:`1px solid ${T.border}`, borderTop:`3px solid ${c}`, borderRadius:10, padding:"12px 18px", minWidth:130 }}>
            <div style={{ fontSize:18, fontWeight:800, color:c }}>{v}</div>
            <div style={{ fontSize:10, color:T.text3, marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* ── Low stock catalogue parts ── */}
      {lowStockParts.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, color:T.amber, letterSpacing:".08em", textTransform:"uppercase", marginBottom:8, fontWeight:700 }}>⚠️ Low stock — reorder suggested ({lowStockParts.length})</div>
          <div style={{ background:T.surface, border:`1px solid ${T.amber}55`, borderRadius:10, overflow:"hidden" }}>
            <PH cols={["Part","SKU","Supplier","Cost ex.VAT","In stock","Min stock","Action"]} sizes="2fr 110px 120px 90px 80px 80px 120px" />
            {lowStockParts.map(c => (
              <div key={c.id} style={{ display:"grid", gridTemplateColumns:"2fr 110px 120px 90px 80px 80px 120px", borderTop:`1px solid ${T.border}`, alignItems:"center", background:T.surface }}>
                <PC>{c.name}</PC>
                <PC mono small>{c.sku||"—"}</PC>
                <PC small>{c.supplier||"—"}</PC>
                <PC mono small pink>{fmtEur(c.cost)}</PC>
                <PC center><span style={{ color:c.stock_qty===0?T.red:T.amber, fontWeight:800 }}>{c.stock_qty}</span></PC>
                <PC center>{c.min_stock}</PC>
                <PC>
                  <button onClick={()=>{
                    const qty = c.min_stock - c.stock_qty;
                    setManualOrders(mo=>[...mo,{ id:genId("mo"), item_name:`Restock: ${c.name}`, supplier_sku:c.sku||"", qty, cost:c.cost, note:`Restock to min (${c.min_stock})`, status:"pending", created_at:new Date().toISOString() }]);
                    toast(`Added restock order for ${c.name}`);
                  }} style={{ background:T.amber, border:"none", borderRadius:5, padding:"4px 10px", color:"#fff", fontSize:10, fontWeight:700, cursor:"pointer" }}>
                    + Restock order
                  </button>
                </PC>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Repair parts pending ── */}
      {pending.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, color:T.text2, letterSpacing:".08em", textTransform:"uppercase", marginBottom:8, fontWeight:700 }}>🔧 Repair parts — pending ({pending.length})</div>
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden" }}>
            <PH cols={["Ticket","Customer","Device","Part","SKU","Qty","Ex.VAT","Incl.VAT","Action"]} sizes="80px 110px 130px 1fr 90px 36px 80px 80px 110px" />
            {pending.map(p => {
              const t=tickets.find(t=>t.id===p.ticket_id), c=customers.find(c=>c.id===t?.customer_id);
              return (
                <div key={p.id} style={{ display:"grid", gridTemplateColumns:"80px 110px 130px 1fr 90px 36px 80px 80px 110px", borderTop:`1px solid ${T.border}`, alignItems:"center" }}>
                  <PC pink mono>{t?.id?.slice(-6)}</PC><PC small>{c?.name}</PC><PC small>{t?.device_model}</PC>
                  <PC>{p.part_name}</PC><PC mono small>{p.supplier_sku||"—"}</PC><PC center>{p.qty}</PC>
                  <PC mono small>{fmtEur(p.cost)}</PC><PC mono small pink>{fmtEur(p.cost*(1+VAT_RATE))}</PC>
                  <PC><button onClick={()=>updatePartStatus(p.id,"ordered")} style={{ background:T.blue, border:"none", borderRadius:5, padding:"4px 10px", color:"#fff", fontSize:10, fontWeight:700, cursor:"pointer" }}>→ Ordered</button></PC>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Accessory items pending ── */}
      {accPending.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, color:T.purple, letterSpacing:".08em", textTransform:"uppercase", marginBottom:8, fontWeight:700 }}>📦 Accessory items — pending ({accPending.length})</div>
          <div style={{ background:T.surface, border:`1px solid ${T.purple}44`, borderRadius:10, overflow:"hidden" }}>
            <PH cols={["Ticket","Customer","Item","Variant","Qty","Incl.VAT","Action"]} sizes="80px 120px 1fr 120px 40px 90px 120px" purple />
            {accPending.map(i => (
              <div key={i.id} style={{ display:"grid", gridTemplateColumns:"80px 120px 1fr 120px 40px 90px 120px", borderTop:`1px solid ${T.border}`, alignItems:"center" }}>
                <PC purple mono>{i._ticketId?.slice(-6)}</PC>
                <PC small>{i._customer?.name}</PC>
                <PC>{i.item}</PC>
                <PC small>{i.color||"—"}</PC>
                <PC center>{i.qty}</PC>
                <PC mono small purple>{fmtEur((i.price_incl_vat||0)*(i.qty||1))}</PC>
                <PC>
                  <button onClick={()=>updateAccItemStatus(i._ticketId,i.id,"ordered")}
                    style={{ background:T.blue, border:"none", borderRadius:5, padding:"4px 10px", color:"#fff", fontSize:10, fontWeight:700, cursor:"pointer" }}>→ Ordered</button>
                </PC>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Manual orders pending ── */}
      {mPending.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, color:T.pink, letterSpacing:".08em", textTransform:"uppercase", marginBottom:8, fontWeight:700 }}>✏️ Manual orders ({mPending.length})</div>
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden" }}>
            <PH cols={["Item","SKU","Qty","Price excl.VAT","Notes","Action"]} sizes="1fr 120px 50px 110px 1fr 150px" />
            {mPending.map(m => (
              <div key={m.id} style={{ display:"grid", gridTemplateColumns:"1fr 120px 50px 110px 1fr 150px", borderTop:`1px solid ${T.border}`, alignItems:"center" }}>
                <PC>{m.item_name}</PC><PC mono small>{m.supplier_sku||"—"}</PC><PC center>{m.qty}</PC>
                <PC pink mono small>{fmtEur(m.cost)}</PC><PC small>{m.note||"—"}</PC>
                <PC>
                  <div style={{ display:"flex", gap:5 }}>
                    <button onClick={()=>markM(m.id,"ordered")} style={{ background:T.blue, border:"none", borderRadius:5, padding:"4px 10px", color:"#fff", fontSize:10, fontWeight:700, cursor:"pointer" }}>→ Ordered</button>
                    <button onClick={()=>delM(m.id)} style={{ background:T.redBg, border:"none", borderRadius:5, padding:"4px 8px", color:T.red, fontSize:10, cursor:"pointer" }}>✕</button>
                  </div>
                </PC>
              </div>
            ))}
          </div>
        </div>
      )}

      {totalPending===0 && (
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:"40px", textAlign:"center", color:T.text3, fontSize:13 }}>
          ✓ Nothing pending — all items have been ordered
        </div>
      )}

      {/* ── Awaiting arrival ── */}
      {(ordered.length > 0 || accOrdered.length > 0 || mOrdered.length > 0) && (
        <div style={{ marginTop:24 }}>
          <div style={{ fontSize:10, color:T.blue, letterSpacing:".08em", textTransform:"uppercase", marginBottom:10, fontWeight:700 }}>◎ Awaiting arrival ({ordered.length+accOrdered.length+mOrdered.length})</div>
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden" }}>
            <PH cols={["Type","Ticket / Ref","Item","Qty","Price","Action"]} sizes="100px 160px 1fr 44px 90px 140px" />
            {ordered.map(p => {
              const t=tickets.find(t=>t.id===p.ticket_id);
              return (
                <div key={p.id} style={{ display:"grid", gridTemplateColumns:"100px 160px 1fr 44px 90px 140px", borderTop:`1px solid ${T.border}`, alignItems:"center" }}>
                  <PC><span style={{ fontSize:9, color:T.text3, textTransform:"uppercase", letterSpacing:".06em" }}>🔧 Repair</span></PC>
                  <PC mono small pink>{t?.id?.slice(-6)} · {t?.device_model?.slice(0,12)}</PC>
                  <PC>{p.part_name}</PC><PC center>{p.qty}</PC>
                  <PC mono small>{fmtEur(p.cost*(1+VAT_RATE))}</PC>
                  <PC><button onClick={()=>updatePartStatus(p.id,"arrived")} style={{ background:T.green, border:"none", borderRadius:5, padding:"4px 10px", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer" }}>✓ Arrived</button></PC>
                </div>
              );
            })}
            {accOrdered.map(i => (
              <div key={i.id} style={{ display:"grid", gridTemplateColumns:"100px 160px 1fr 44px 90px 140px", borderTop:`1px solid ${T.border}`, alignItems:"center" }}>
                <PC><span style={{ fontSize:9, color:T.purple, textTransform:"uppercase", letterSpacing:".06em" }}>📦 Acc.</span></PC>
                <PC mono small purple>{i._ticketId?.slice(-6)} · {i._customer?.name?.slice(0,12)}</PC>
                <PC>{i.item}{i.color ? <span style={{ color:T.text3, fontSize:11 }}> — {i.color}</span> : ""}</PC>
                <PC center>{i.qty}</PC>
                <PC mono small purple>{fmtEur((i.price_incl_vat||0)*(i.qty||1))}</PC>
                <PC><button onClick={()=>updateAccItemStatus(i._ticketId,i.id,"arrived")} style={{ background:T.green, border:"none", borderRadius:5, padding:"4px 10px", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer" }}>✓ Arrived</button></PC>
              </div>
            ))}
            {mOrdered.map(m => (
              <div key={m.id} style={{ display:"grid", gridTemplateColumns:"100px 160px 1fr 44px 90px 140px", borderTop:`1px solid ${T.border}`, alignItems:"center" }}>
                <PC><span style={{ fontSize:9, color:T.pink, textTransform:"uppercase", letterSpacing:".06em" }}>✏️ Manual</span></PC>
                <PC small>{m.note||"—"}</PC><PC>{m.item_name}</PC><PC center>{m.qty}</PC>
                <PC mono small>{fmtEur((parseFloat(m.cost)||0)*(1+VAT_RATE))}</PC>
                <PC><button onClick={()=>markM(m.id,"arrived")} style={{ background:T.green, border:"none", borderRadius:5, padding:"4px 10px", color:"#fff", fontSize:11, fontWeight:700, cursor:"pointer" }}>✓ Arrived</button></PC>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CUSTOMERS ────────────────────────────────────────────────────────────────
function CustomersView({ customers, setCustomers, tickets, openTicket, db, toast }) {
  const [q,        setQ]        = useState("");
  const [selected, setSelected] = useState(null); // customer id
  const [editing,  setEditing]  = useState(false);
  const [draft,    setDraft]    = useState(null);
  const [saving,   setSaving]   = useState(false);

  const filtered = customers
    .filter(c => {
      const s = q.toLowerCase();
      return !s || c.name.toLowerCase().includes(s) || (c.email||"").toLowerCase().includes(s) || (c.phone||"").includes(s);
    })
    .sort((a,b) => a.name.localeCompare(b.name));

  const cust   = customers.find(c => c.id === selected);
  const cTickets = cust ? tickets.filter(t => t.customer_id === cust.id).sort((a,b) => new Date(b.created_at)-new Date(a.created_at)) : [];

  function selectCustomer(c) {
    setSelected(c.id);
    setEditing(false);
    setDraft(null);
  }

  function startEdit() {
    setDraft({ ...cust });
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(null);
    setEditing(false);
  }

  async function saveEdit() {
    if (!draft.name.trim()) { toast("Name is required", "error"); return; }
    setSaving(true);
    const updated = { ...draft };
    setCustomers(cs => cs.map(c => c.id === updated.id ? updated : c));
    await db.saveCustomer(updated);
    setSaving(false);
    setEditing(false);
    setDraft(null);
    toast("Customer saved");
  }

  const totalSpend = cTickets.reduce((s,t) => s + (t.initial_quote||0), 0);

  return (
    <div style={{ display:"flex", height:"calc(100vh - 56px)", overflow:"hidden" }}>

      {/* ── Left: customer list ── */}
      <div style={{ width:320, flexShrink:0, borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", background:T.surface }}>
        <div style={{ padding:"14px 14px 10px", borderBottom:`1px solid ${T.border}` }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <span style={{ fontSize:15, fontWeight:700, color:T.text }}>Customers</span>
            <span style={{ fontSize:11, color:T.text3 }}>{customers.length} total</span>
          </div>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, email, phone…"
            style={{ ...inp(), width:"100%", fontSize:12 }} />
        </div>

        <div style={{ flex:1, overflowY:"auto" }}>
          {filtered.map(c => {
            const ct = tickets.filter(t => t.customer_id===c.id);
            const op = ct.filter(t => t.status!=="closed").length;
            const isActive = selected === c.id;
            return (
              <div key={c.id} onClick={() => selectCustomer(c)}
                style={{ padding:"11px 14px", borderBottom:`1px solid ${T.border}`, cursor:"pointer",
                  background: isActive ? T.pinkBg : "transparent",
                  borderLeft: isActive ? `3px solid ${T.pink}` : "3px solid transparent" }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background=T.surface2; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background="transparent"; }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:32, height:32, borderRadius:"50%", background:isActive?T.pink:T.surface2, border:`1px solid ${isActive?T.pink:T.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:isActive?"#fff":T.text2, flexShrink:0 }}>
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:isActive?T.pink:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.name}</div>
                    <div style={{ fontSize:11, color:T.text3 }}>{c.phone || c.email || "—"}</div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    {op > 0 && <div style={{ fontSize:10, fontWeight:700, color:T.amber, background:T.amberBg, borderRadius:4, padding:"1px 5px" }}>{op} open</div>}
                    <div style={{ fontSize:10, color:T.text3, marginTop:2 }}>{ct.length} ticket{ct.length!==1?"s":""}</div>
                  </div>
                </div>
              </div>
            );
          })}
          {!filtered.length && (
            <div style={{ padding:40, textAlign:"center", color:T.text3, fontSize:13 }}>
              {q ? `No results for "${q}"` : "No customers yet"}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: detail panel ── */}
      {!cust ? (
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:T.text3, fontSize:13 }}>
          Select a customer to view details
        </div>
      ) : (
        <div style={{ flex:1, overflowY:"auto", padding:24, background:T.bg }}>

          {/* Header */}
          <div style={{ display:"flex", alignItems:"flex-start", gap:14, marginBottom:20 }}>
            <div style={{ width:52, height:52, borderRadius:"50%", background:T.pinkBg, border:`2px solid ${T.pinkBd}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, fontWeight:800, color:T.pink, flexShrink:0 }}>
              {cust.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex:1 }}>
              <h2 style={{ margin:"0 0 2px", fontSize:20, fontWeight:800, color:T.text }}>{cust.name}</h2>
              <div style={{ fontSize:12, color:T.text3 }}>Customer since {cust.created_at ? new Date(cust.created_at).toLocaleDateString("fi-FI") : "—"}</div>
            </div>
            {!editing && (
              <button onClick={startEdit}
                style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"7px 16px", fontSize:13, fontWeight:600, color:T.text, cursor:"pointer" }}>
                ✏ Edit
              </button>
            )}
          </div>

          {/* Stats row */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:20 }}>
            {[
              { l:"Total tickets", v:cTickets.length, c:T.blue },
              { l:"Open tickets",  v:cTickets.filter(t=>t.status!=="closed").length, c:T.amber },
              { l:"Total spend",   v:fmtEur(totalSpend), c:T.green },
            ].map(s => (
              <div key={s.l} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 16px" }}>
                <div style={{ fontSize:18, fontWeight:800, color:s.c, fontFamily:"'IBM Plex Mono',monospace" }}>{s.v}</div>
                <div style={{ fontSize:11, color:T.text2, marginTop:2 }}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* Contact details / edit form */}
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:20, marginBottom:20 }}>
            <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:14 }}>Contact details</div>

            {editing ? (
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {[
                  { label:"Full name",    key:"name",  type:"text",  req:true  },
                  { label:"Email",        key:"email", type:"email", req:false },
                  { label:"Phone",        key:"phone", type:"tel",   req:false },
                  { label:"Address",      key:"address",type:"text", req:false },
                  { label:"Notes",        key:"notes", type:"textarea",req:false },
                ].map(f => (
                  <div key={f.key}>
                    <div style={{ fontSize:11, fontWeight:600, color:T.text2, marginBottom:4 }}>{f.label}{f.req&&<span style={{color:T.pink}}> *</span>}</div>
                    {f.type==="textarea"
                      ? <textarea value={draft[f.key]||""} onChange={e=>setDraft(d=>({...d,[f.key]:e.target.value}))}
                          rows={3} style={{ ...inp(), width:"100%", resize:"vertical", fontSize:13 }} />
                      : <input type={f.type} value={draft[f.key]||""} onChange={e=>setDraft(d=>({...d,[f.key]:e.target.value}))}
                          style={{ ...inp(), width:"100%", fontSize:13 }} />
                    }
                  </div>
                ))}
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:T.text, cursor:"pointer" }}>
                    <input type="checkbox" checked={!!draft.sms_opt_in} onChange={e=>setDraft(d=>({...d,sms_opt_in:e.target.checked}))} />
                    SMS notifications
                  </label>
                </div>
                <div style={{ display:"flex", gap:8, marginTop:4 }}>
                  <button onClick={saveEdit} disabled={saving}
                    style={{ background:T.pink, color:"#fff", border:"none", borderRadius:8, padding:"8px 20px", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                  <button onClick={cancelEdit}
                    style={{ background:T.surface2, color:T.text2, border:`1px solid ${T.border}`, borderRadius:8, padding:"8px 16px", fontSize:13, cursor:"pointer" }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {[
                  { l:"Email",   v:cust.email   || "—" },
                  { l:"Phone",   v:cust.phone   || "—" },
                  { l:"Address", v:cust.address || "—" },
                  { l:"SMS opt-in", v:cust.sms_opt_in ? "✓ Yes" : "No" },
                  ...(cust.notes ? [{ l:"Notes", v:cust.notes }] : []),
                ].map(r => (
                  <div key={r.l} style={{ gridColumn: r.l==="Notes"?"1/-1":"auto" }}>
                    <div style={{ fontSize:10, fontWeight:700, color:T.text3, textTransform:"uppercase", letterSpacing:".06em", marginBottom:3 }}>{r.l}</div>
                    <div style={{ fontSize:13, color:T.text }}>{r.v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ticket history */}
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:20 }}>
            <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:14 }}>Ticket history</div>
            {!cTickets.length && (
              <div style={{ textAlign:"center", padding:"20px 0", color:T.text3, fontSize:13 }}>No tickets yet</div>
            )}
            {cTickets.map(t => {
              const st = getStatus(t.status);
              const isAcc = t.type === "accessory";
              return (
                <div key={t.id} onClick={() => openTicket(t)}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px", borderRadius:8, marginBottom:6, border:`1px solid ${T.border}`, background:T.bg, cursor:"pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background=T.surface2}
                  onMouseLeave={e => e.currentTarget.style.background=T.bg}>
                  <div style={{ fontSize:16 }}>{isAcc ? "📦" : "🔧"}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
                      <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, color:isAcc?T.purple:T.pink }}>{t.id}</span>
                      <span style={{ fontSize:11, color:T.text2 }}>{t.device_manufacturer} {t.device_model}</span>
                    </div>
                    <div style={{ fontSize:11, color:T.text3 }}>{t.issue_desc?.slice(0,60)}{t.issue_desc?.length>60?"…":""}</div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <StatusBadge status={t.status} small />
                    <div style={{ fontSize:10, color:T.text3, marginTop:3 }}>{t.created_at ? new Date(t.created_at).toLocaleDateString("fi-FI") : ""}</div>
                  </div>
                  <span style={{ fontSize:12, color:T.text3 }}>›</span>
                </div>
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
}

// ─── NEW TICKET ───────────────────────────────────────────────────────────────
// Accent colours per ticket type
const TYPE_THEME = {
  repair:    { color: T.pink,   bg: T.pinkBg,   border: T.pinkBd,   icon: "🔧", label: "Device Repair"    },
  accessory: { color: T.purple, bg: T.purpleBg, border: T.purple+"55", icon: "📦", label: "Accessory Order"  },
};

// Accessory-specific workflow presets (simpler than the full repair flow)
const ACC_PRESETS = [
  { key:"intake",           label:"Intake",             icon:"📥", desc:"Item received, not yet ordered"   },
  { key:"part_ordered",     label:"Ordered",            icon:"📦", desc:"Item ordered from supplier"       },
  { key:"part_arrived",     label:"Arrived",            icon:"✅", desc:"Item in stock, ready to hand out" },
  { key:"ready_for_pickup", label:"Ready for pickup",   icon:"🛍", desc:"Customer can collect now"         },
];

function NewTicketView({ customers, setCustomers, tickets, setTickets, toast, setView, setActiveTicket, allModels, setAllModels, db }) {
  // ── shared state ──────────────────────────────────────────────────────────
  const [ticketType,  setTicketType]  = useState("");       // "repair" | "accessory"
  const [isNew,       setIsNew]       = useState(false);
  const [custId,      setCustId]      = useState("");
  const [nc,          setNc]          = useState({ name:"", email:"", phone:"", sms_opt_in:true });
  const [device,      setDevice]      = useState({ category:"", manufacturer:"", model:"", customModel:"" });
  const [initStatus,  setInitStatus]  = useState("intake");

  // ── repair-only state ─────────────────────────────────────────────────────
  const [serial,      setSerial]      = useState("");
  const [accessCode,  setAccessCode]  = useState("");
  const [repairType,  setRepairType]  = useState("");
  const [issue,       setIssue]       = useState("");
  const [quote,       setQuote]       = useState("");
  const [warranty,    setWarranty]    = useState(12);

  // ── accessory-only state ──────────────────────────────────────────────────
  const [accItem,     setAccItem]     = useState("");       // Item description
  const [accColor,    setAccColor]    = useState("");       // Color / variant
  const [accQty,      setAccQty]      = useState(1);        // Quantity
  const [accPrice,    setAccPrice]    = useState("");       // Price incl. VAT
  const [accNotes,    setAccNotes]    = useState("");       // Order notes

  const TT   = ticketType ? TYPE_THEME[ticketType] : null;
  const q    = parseFloat(quote) || 0;
  const ap   = parseFloat(accPrice) || 0;
  const selectedRepair = REPAIR_TYPES.find(r => r.value === repairType);

  // ── helpers ───────────────────────────────────────────────────────────────
  async function resolveCustomer() {
    let fid = custId;
    if (isNew) {
      if (!nc.name.trim()) { toast("Customer name is required", "error"); return null; }
      const n = { id:genId("c"), ...nc };
      setCustomers(cs => [...cs, n]);
      await db.saveCustomer(n);
      fid = n.id;
    }
    if (!fid) { toast("Select a customer", "error"); return null; }
    return fid;
  }

  async function submitRepair() {
    const model = device.model || device.customModel;
    if (!device.category)  { toast("Select a device category", "error"); return; }
    if (!model)            { toast("Select or enter a device model", "error"); return; }
    if (!repairType)       { toast("Select a repair type", "error"); return; }
    const fid = await resolveCustomer(); if (!fid) return;
    const resolvedMfr = device.manufacturer === "__other__" ? (device.customBrand || "Other") : (device.manufacturer || "Other");
    const finalIssue  = issue.trim() || REPAIR_TYPES.find(r=>r.value===repairType)?.label || "";
    const maxNum = tickets.reduce((max, t) => { const n = parseInt(t.id?.replace("TKT-","")) || 0; return n > max ? n : max; }, 0);
    const tid = `TKT-${String(maxNum + 1).padStart(4,"0")}`;
    const nt = {
      id: tid, type: "repair",
      customer_id: fid,
      device_category: device.category, device_manufacturer: resolvedMfr, device_model: model,
      serial_imei: serial, access_code: accessCode,
      repair_type: repairType, issue_desc: finalIssue,
      initial_quote: parseFloat(quote) || 0,
      warranty_months: warranty,
      status: initStatus, technician_notes: "", created_at: new Date().toISOString(),
    };
    setTickets(ts => [...ts, nt]); setActiveTicket(tid);
    await db.saveTicket(nt);
    toast(`Ticket ${tid} created! (${getStatus(initStatus).label})`); setView("ticket");
  }

  async function submitAccessory() {
    if (!accItem.trim()) { toast("Item description is required", "error"); return; }
    const model = device.model || device.customModel;
    const fid = await resolveCustomer(); if (!fid) return;
    const resolvedMfr = device.manufacturer === "__other__" ? (device.customBrand || "Other") : device.manufacturer;
    const maxNum = tickets.reduce((max, t) => { const n = parseInt(t.id?.replace("TKT-","")) || 0; return n > max ? n : max; }, 0);
    const tid = `TKT-${String(maxNum + 1).padStart(4,"0")}`;
    const firstItem = { id: genId("ai"), item: accItem.trim(), color: accColor.trim(), qty: parseInt(accQty)||1, price_incl_vat: ap, status: "pending" };
    const nt = {
      id: tid, type: "accessory",
      customer_id: fid,
      device_category: device.category || "",
      device_manufacturer: resolvedMfr || "",
      device_model: model || "",
      acc_items: [firstItem],
      acc_notes: accNotes.trim(),
      initial_quote: ap * (parseInt(accQty)||1),
      warranty_months: 0,
      issue_desc: accItem.trim(),
      serial_imei: "", access_code: "", repair_type: "",
      status: initStatus, technician_notes: "", created_at: new Date().toISOString(),
    };
    setTickets(ts => [...ts, nt]); setActiveTicket(tid);
    await db.saveTicket(nt);
    toast(`Accessory order ${tid} created!`); setView("ticket");
  }

  // ── accent helper: btn style for a given type's theme ─────────────────────
  function accentBtn(active, theme) {
    return {
      border: `1px solid ${active ? theme.color : T.border}`,
      background: active ? theme.bg : T.surface2,
      color: active ? theme.color : T.text2,
    };
  }

  // ── Section header accent bar ─────────────────────────────────────────────
  const accentBar = TT ? { borderLeft:`3px solid ${TT.color}`, paddingLeft:10 } : {};

  return (
    <div style={{ padding:24, maxWidth:660 }}>

      {/* ── Page title ── */}
      <h2 style={{ margin:"0 0 20px", fontSize:20, fontWeight:700, color:T.text }}>
        New ticket
      </h2>

      {/* ════════════════════════════════════════════════════
          STEP 1 — CUSTOMER
          ════════════════════════════════════════════════════ */}
      <Sec title="Customer">
        <div style={{ display:"flex", gap:6, marginBottom:12 }}>
          {[false,true].map(v => (
            <button key={String(v)} type="button" onClick={() => setIsNew(v)}
              style={{ flex:1, padding:"8px", borderRadius:7, fontSize:12, fontWeight:700,
                border:`1px solid ${isNew===v?T.pink:T.border}`,
                background:isNew===v?T.pinkBg:T.surface2,
                color:isNew===v?T.pink:T.text2 }}>
              {v ? "+ New customer" : "Existing customer"}
            </button>
          ))}
        </div>
        {!isNew ? (
          <CustomerSearch customers={customers} value={custId} onChange={setCustId} />
        ) : (
          <div style={{ display:"grid", gap:8 }}>
            <input placeholder="Full name *" value={nc.name}
              onChange={e=>setNc(c=>({...c,name:e.target.value}))} style={{ ...inp(), width:"100%" }} />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              <input placeholder="Email" value={nc.email}
                onChange={e=>setNc(c=>({...c,email:e.target.value}))} style={inp()} />
              <input placeholder="Phone" value={nc.phone}
                onChange={e=>setNc(c=>({...c,phone:e.target.value}))} style={inp()} />
            </div>
            <label style={{ fontSize:12, color:T.text2, display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
              <input type="checkbox" checked={nc.sms_opt_in}
                onChange={e=>setNc(c=>({...c,sms_opt_in:e.target.checked}))} /> Allow SMS notifications
            </label>
          </div>
        )}
      </Sec>

      {/* ════════════════════════════════════════════════════
          STEP 2 — TICKET TYPE
          ════════════════════════════════════════════════════ */}
      <Sec title="Ticket type">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {Object.entries(TYPE_THEME).map(([key, tt]) => (
            <button key={key} type="button" onClick={() => { setTicketType(key); setInitStatus("intake"); }}
              style={{ padding:"16px 14px", borderRadius:10, textAlign:"left", cursor:"pointer",
                border:`2px solid ${ticketType===key ? tt.color : T.border}`,
                background:ticketType===key ? tt.bg : T.surface2,
                color:ticketType===key ? tt.color : T.text2,
                transition:"all .15s" }}>
              <div style={{ fontSize:22, marginBottom:6 }}>{tt.icon}</div>
              <div style={{ fontSize:13, fontWeight:700 }}>{tt.label}</div>
              <div style={{ fontSize:11, marginTop:3, opacity:.75, lineHeight:1.4 }}>
                {key === "repair"
                  ? "Device brought in for diagnosis or repair"
                  : "Order a case, screen protector, or other accessory"}
              </div>
            </button>
          ))}
        </div>
      </Sec>

      {/* ════════════════════════════════════════════════════
          REPAIR FLOW
          ════════════════════════════════════════════════════ */}
      {ticketType === "repair" && (<>

        <Sec title={<span style={accentBar}>Device</span>}>
          <DeviceSelector value={device} onChange={setDevice} allModels={allModels} setAllModels={setAllModels} />
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:10 }}>
            <input placeholder="IMEI / Serial number" value={serial}
              onChange={e=>setSerial(e.target.value)}
              style={{ ...inp(), fontFamily:"'IBM Plex Mono',monospace" }} />
            <input placeholder="🔐 Access code / Pattern" value={accessCode}
              onChange={e=>setAccessCode(e.target.value)}
              style={{ ...inp(), fontFamily:"'IBM Plex Mono',monospace", borderColor:accessCode?T.pink:T.border }} />
          </div>
        </Sec>

        <Sec title={<span style={accentBar}>Repair type + Description</span>}>
          <FL>Repair type *</FL>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:12 }}>
            {REPAIR_TYPES.map(r => (
              <button key={r.value} type="button" onClick={() => setRepairType(r.value)}
                style={{ padding:"8px 10px", borderRadius:7, fontSize:12, textAlign:"left", cursor:"pointer",
                  fontWeight:repairType===r.value?700:400,
                  ...accentBtn(repairType===r.value, TYPE_THEME.repair) }}>
                {r.label}
              </button>
            ))}
          </div>
          <FL>Description {repairType && repairType !== "other" ? "(auto-filled, edit if needed)" : "*"}</FL>
          <textarea
            placeholder={selectedRepair ? selectedRepair.label : "Describe the fault in detail…"}
            value={issue} onChange={e => setIssue(e.target.value)}
            onFocus={() => { if (!issue && selectedRepair && repairType !== "other") setIssue(selectedRepair.label); }}
            rows={3} style={{ ...inp(), width:"100%", resize:"vertical", marginBottom:8 }} />
          <input placeholder="Estimated price (€ incl. 25.5% VAT)" type="number" step="0.01"
            value={quote} onChange={e=>setQuote(e.target.value)}
            style={{ ...inp(), width:"100%", marginBottom:q>0?8:0 }} />
          {q > 0 && <VatBox total={q} />}
        </Sec>

        <Sec title={<span style={accentBar}>🛡 Warranty</span>}>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {WARRANTY_OPTIONS.map(w => (
              <button key={w.value} type="button" onClick={()=>setWarranty(w.value)}
                style={{ padding:"7px 20px", borderRadius:7, fontSize:13, fontWeight:700, minWidth:80,
                  ...accentBtn(warranty===w.value, TYPE_THEME.repair) }}>
                {w.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize:11, color:T.green, marginTop:6 }}>
            ✓ Default 12 months — selected: {WARRANTY_OPTIONS.find(w=>w.value===warranty)?.label}
          </div>
        </Sec>

        <Sec title={<span style={accentBar}>⚡ Starting status</span>}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {WORKFLOW_PRESETS.map(p => {
              const s = getStatus(p.key);
              return (
                <button key={p.key} type="button" onClick={() => setInitStatus(p.key)}
                  style={{ padding:"10px 12px", borderRadius:8, textAlign:"left", display:"flex", alignItems:"flex-start", gap:8, cursor:"pointer",
                    border:`1px solid ${initStatus===p.key?s.color:T.border}`,
                    background:initStatus===p.key?s.bg:T.surface2,
                    color:initStatus===p.key?s.color:T.text2 }}>
                  <span style={{ fontSize:18, flexShrink:0 }}>{p.icon}</span>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700 }}>{p.label}</div>
                    <div style={{ fontSize:10, marginTop:2, opacity:.8, lineHeight:1.4 }}>{p.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
          {initStatus && (
            <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:8, padding:"6px 10px",
              background:getStatus(initStatus).bg, border:`1px solid ${getStatus(initStatus).color}33`, borderRadius:6 }}>
              <StatusBadge status={initStatus} small />
              <span style={{ fontSize:11, color:T.text2 }}>Ticket will be created in this status</span>
            </div>
          )}
        </Sec>

        <button onClick={submitRepair}
          style={{ width:"100%", background:T.pink, border:"none", borderRadius:8, padding:"13px",
            color:"#fff", fontSize:14, fontWeight:700, marginTop:4, letterSpacing:".02em", cursor:"pointer" }}>
          🔧 Create repair ticket →
        </button>
      </>)}

      {/* ════════════════════════════════════════════════════
          ACCESSORY ORDER FLOW
          ════════════════════════════════════════════════════ */}
      {ticketType === "accessory" && (<>

        <Sec title={<span style={accentBar}>For device (optional)</span>}>
          <div style={{ fontSize:11, color:T.text3, marginBottom:10 }}>
            Associate this order with a specific device model, or leave blank.
          </div>
          <DeviceSelector value={device} onChange={setDevice} allModels={allModels} setAllModels={setAllModels} />
        </Sec>

        <Sec title={<span style={accentBar}>📦 Items</span>}>
          {/* Add item row */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 110px 60px 90px", gap:6, marginBottom:6 }}>
            <input placeholder="Item description *" value={accItem} onChange={e=>setAccItem(e.target.value)}
              style={{ ...inp(), borderColor:accItem?T.purple:T.border }} />
            <input placeholder="Color/Variant" value={accColor} onChange={e=>setAccColor(e.target.value)} style={inp()} />
            <input placeholder="Qty" type="number" min="1" value={accQty} onChange={e=>setAccQty(e.target.value)} style={inp()} />
            <input placeholder="Price incl. VAT" type="number" step="0.01" value={accPrice} onChange={e=>setAccPrice(e.target.value)} style={inp()} />
          </div>
          {ap > 0 && (
            <div style={{ fontSize:11, color:T.text2, background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"5px 10px", marginBottom:8, display:"flex", gap:16 }}>
              <span>Ex. VAT: <b style={{color:T.text}}>{fmtEur(exVat(ap))}</b></span>
              <span>VAT {(VAT_RATE*100).toFixed(1)}%: <b style={{color:T.amber}}>{fmtEur(vatAmt(ap))}</b></span>
              <span>Incl. VAT: <b style={{color:T.purple}}>{fmtEur(ap)}</b></span>
            </div>
          )}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ fontSize:11, color:T.text3 }}>First item — add more after creating the order</div>
          </div>
          <div>
            <FL>Order notes (optional)</FL>
            <textarea placeholder="Supplier notes, special requests…" value={""} readOnly rows={2}
              style={{ ...inp(), width:"100%", resize:"vertical", display:"none" }} />
          </div>
        </Sec>

        <Sec title={<span style={accentBar}>⚡ Starting status</span>}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {ACC_PRESETS.map(p => {
              const s = getStatus(p.key);
              return (
                <button key={p.key} type="button" onClick={() => setInitStatus(p.key)}
                  style={{ padding:"10px 12px", borderRadius:8, textAlign:"left", display:"flex", alignItems:"flex-start", gap:8, cursor:"pointer",
                    border:`1px solid ${initStatus===p.key?T.purple:T.border}`,
                    background:initStatus===p.key?T.purpleBg:T.surface2,
                    color:initStatus===p.key?T.purple:T.text2 }}>
                  <span style={{ fontSize:18, flexShrink:0 }}>{p.icon}</span>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700 }}>{p.label}</div>
                    <div style={{ fontSize:10, marginTop:2, opacity:.8, lineHeight:1.4 }}>{p.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
          {initStatus && (
            <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:8, padding:"6px 10px",
              background:T.purpleBg, border:`1px solid ${T.purple}33`, borderRadius:6 }}>
              <span style={{ fontSize:11, color:T.purple, fontWeight:700 }}>
                📦 {ACC_PRESETS.find(p=>p.key===initStatus)?.label || getStatus(initStatus).label}
              </span>
              <span style={{ fontSize:11, color:T.text2 }}>Order will start in this status</span>
            </div>
          )}
        </Sec>

        <button onClick={submitAccessory}
          style={{ width:"100%", background:T.purple, border:"none", borderRadius:8, padding:"13px",
            color:"#fff", fontSize:14, fontWeight:700, marginTop:4, letterSpacing:".02em", cursor:"pointer" }}>
          📦 Create accessory order →
        </button>
      </>)}

    </div>
  );
}

// ─── LOGS ─────────────────────────────────────────────────────────────────────
function LogsView({ logs, tickets, customers }) {
  const [expanded, setExpanded] = useState(null);
  const sorted = [...logs].reverse();

  const TMPL_LABEL = {
    part_arrived:       { label:"Part arrived",       color:T.purple,  bg:T.purpleBg },
    accessory_arrived:  { label:"Accessory arrived",color:T.blue,    bg:T.blueBg   },
    ready_for_pickup:   { label:"Ready for pickup",       color:T.green,   bg:T.greenBg  },
  };

  const stats = [
    { l:"Total messages", v:logs.length,                                    c:T.pink  },
    { l:"Emails",          v:logs.filter(l=>l.channel==="email").length,      c:T.blue  },
    { l:"SMS messages",          v:logs.filter(l=>l.channel==="sms").length,        c:T.green },
    { l:"Sent today",     v:logs.filter(l=>l.sent_at?.slice(0,10)===new Date().toISOString().slice(0,10)).length, c:T.amber },
  ];

  return (
    <div style={{ padding:24, maxWidth:900 }}>
      <h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700, color:T.text }}>Message history</h2>
      <div style={{ fontSize:12, color:T.text3, marginBottom:20 }}>All customer notifications in chronological order</div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
        {stats.map(s => (
          <div key={s.l} style={{ background:T.surface, border:`1px solid ${T.border}`, borderTop:`3px solid ${s.c}`, borderRadius:10, padding:"12px 16px" }}>
            <div style={{ fontSize:22, fontWeight:800, color:s.c }}>{s.v}</div>
            <div style={{ fontSize:11, color:T.text2, marginTop:2 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {!sorted.length && (
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:"48px", textAlign:"center", color:T.text3, fontSize:13 }}>
          No notifications sent yet
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {sorted.map(l => {
          const ticket  = tickets.find(t => t.id===l.ticket_id);
          const cust    = customers.find(c => c.id===l.customer_id);
          const tmplCfg = TMPL_LABEL[l.template_key] || { label:l.template_key, color:T.text3, bg:T.surface2 };
          const isOpen  = expanded === l.id;
          const msg     = l.message;
          const isEmail = l.channel === "email";

          return (
            <div key={l.id} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,.04)" }}>
              {/* Row */}
              <div
                onClick={() => setExpanded(isOpen ? null : l.id)}
                style={{ display:"grid", gridTemplateColumns:"44px 160px 1fr 140px 160px 80px 32px", alignItems:"center", padding:"10px 0", cursor:"pointer" }}
                onMouseEnter={e => e.currentTarget.style.background=T.surface2}
                onMouseLeave={e => e.currentTarget.style.background="transparent"}
              >
                {/* Channel icon */}
                <div style={{ textAlign:"center", fontSize:18 }}>{isEmail ? "📧" : "📱"}</div>

                {/* Timestamp */}
                <div style={{ padding:"0 12px" }}>
                  <div style={{ fontSize:12, fontWeight:600, color:T.text }}>{new Date(l.sent_at).toLocaleDateString("fi-FI", { day:"numeric", month:"short", year:"numeric" })}</div>
                  <div style={{ fontSize:11, color:T.text3 }}>{new Date(l.sent_at).toLocaleTimeString("fi-FI", { hour:"2-digit", minute:"2-digit" })}</div>
                </div>

                {/* Customer + ticket */}
                <div style={{ padding:"0 12px" }}>
                  <div style={{ fontSize:13, fontWeight:600, color:T.text }}>{cust?.name}</div>
                  <div style={{ fontSize:11, color:T.text3 }}>{isEmail ? cust?.email : cust?.phone} · <span style={{ fontFamily:"'IBM Plex Mono',monospace", color:T.pink }}>{l.ticket_id}</span></div>
                </div>

                {/* Device */}
                <div style={{ padding:"0 12px" }}>
                  <div style={{ fontSize:11, color:T.text2 }}>{ticket?.device_manufacturer}</div>
                  <div style={{ fontSize:11, color:T.text2, fontWeight:500 }}>{ticket?.device_model}</div>
                </div>

                {/* Template */}
                <div style={{ padding:"0 12px" }}>
                  <span style={{ background:tmplCfg.bg, color:tmplCfg.color, border:`1px solid ${tmplCfg.color}33`, borderRadius:5, padding:"2px 8px", fontSize:10, fontWeight:700, display:"inline-block" }}>
                    {tmplCfg.label}
                  </span>
                </div>

                {/* Status */}
                <div style={{ padding:"0 12px" }}>
                  <span style={{ color:T.green, fontSize:11, fontWeight:700 }}>✓ Sent</span>
                </div>

                {/* Expand chevron */}
                <div style={{ padding:"0 10px", color:T.text3, fontSize:12 }}>{isOpen ? "▲" : "▼"}</div>
              </div>

              {/* Expanded message */}
              {isOpen && msg && (
                <div style={{ borderTop:`1px solid ${T.border}`, background:T.surface2, padding:"16px 20px" }}>
                  {isEmail && msg.subject && (
                    <div style={{ marginBottom:10 }}>
                      <span style={{ fontSize:10, color:T.text3, textTransform:"uppercase", letterSpacing:".07em", fontWeight:700 }}>Aihe: </span>
                      <span style={{ fontSize:13, fontWeight:600, color:T.text }}>{msg.subject}</span>
                    </div>
                  )}
                  <div style={{ fontSize:12, color:T.text2, whiteSpace:"pre-wrap", lineHeight:1.7, fontFamily: isEmail ? "'IBM Plex Sans',sans-serif" : "'IBM Plex Mono',monospace", background:T.surface, border:`1px solid ${T.border}`, borderRadius:7, padding:"12px 16px" }}>
                    {isEmail ? msg.body : msg}
                  </div>
                  <div style={{ marginTop:8, fontSize:10, color:T.text3 }}>
                    {isEmail ? "📧 Email" : "📱 SMS"} · Sent {new Date(l.sent_at).toLocaleString("fi-FI")} · Ticket {l.ticket_id}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────
function Sec({ title, children, action }) {
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:16, marginBottom:12, boxShadow:"0 1px 4px rgba(0,0,0,.04)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, paddingBottom:8, borderBottom:`1px solid ${T.border}` }}>
        <span style={{ fontSize:10, color:T.text3, letterSpacing:".1em", fontWeight:700, textTransform:"uppercase" }}>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}
function FL({ children }) {
  return <div style={{ fontSize:10, color:T.text3, letterSpacing:".06em", textTransform:"uppercase", marginBottom:5 }}>{children}</div>;
}
function IR({ l, v, mono }) {
  return <div style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:`1px solid ${T.border}` }}>
    <span style={{ fontSize:11, color:T.text3 }}>{l}</span>
    <span style={{ fontSize:12, color:T.text, fontFamily:mono?"'IBM Plex Mono',monospace":"inherit" }}>{v||"—"}</span>
  </div>;
}
function PH({ cols, sizes, purple }) {
  return <div style={{ display:"grid", gridTemplateColumns:sizes, background:purple?T.purpleBg:T.surface2, padding:"8px 0", borderBottom:`1px solid ${purple?T.purple+"33":T.border}` }}>
    {cols.map(c => <div key={c} style={{ fontSize:8, color:purple?T.purple:T.text3, letterSpacing:".1em", fontWeight:700, textTransform:"uppercase", padding:"0 12px" }}>{c}</div>)}
  </div>;
}
function PC({ children, mono, pink, purple, small, center }) {
  const color = pink ? T.pink : purple ? T.purple : T.text;
  return <div style={{ padding:"8px 12px", fontSize:small?10:12, color, fontFamily:mono?"'IBM Plex Mono',monospace":"inherit", textAlign:center?"center":"left", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{children}</div>;
}
function inp() {
  return { background:T.surface, border:`1px solid ${T.border}`, borderRadius:7, padding:"8px 12px", color:T.text, fontSize:13, fontFamily:"'IBM Plex Sans',sans-serif", width:"100%" };
}
// ─── ACCESSORY ORDER DETAIL ───────────────────────────────────────────────────
function AccOrderDetail({ ticket, ticketId, cust, tLogs, setTickets, newNote, setNewNote, addNote, save }) {
  const accItems = ticket.acc_items || [];
  const [showAddAcc, setShowAddAcc] = useState(false);
  const [newAcc, setNewAcc] = useState({ item:"", color:"", qty:1, price_incl_vat:"" });

  const totalInclVat = accItems.reduce((s,i) => s + (i.price_incl_vat||0)*(i.qty||1), 0);

  function saveItems(updated) {
    const total = updated.reduce((s,i) => s + (i.price_incl_vat||0)*(i.qty||1), 0);
    setTickets(ts => ts.map(t => t.id===ticketId ? { ...t, acc_items: updated, initial_quote: total } : t));
  }
  function addAccItem() {
    if (!newAcc.item.trim()) return;
    saveItems([...accItems, { id:genId("ai"), item:newAcc.item.trim(), color:newAcc.color.trim(), qty:parseInt(newAcc.qty)||1, price_incl_vat:parseFloat(newAcc.price_incl_vat)||0, status:"pending" }]);
    setNewAcc({ item:"", color:"", qty:1, price_incl_vat:"" });
    setShowAddAcc(false);
  }
  function updateAccItemStatus(id, status) {
    saveItems(accItems.map(i => i.id===id ? {...i, status} : i));
  }
  function deleteAccItem(id) {
    saveItems(accItems.filter(i => i.id!==id));
  }

  return (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>

            {/* Left: Items list */}
            <Sec title={<span style={{ borderLeft:`3px solid ${T.purple}`, paddingLeft:8 }}>📦 Items ({accItems.length})</span>}
              action={<button onClick={()=>setShowAddAcc(v=>!v)} style={{ fontSize:11, background:showAddAcc?T.purpleBg:T.surface2, border:`1px solid ${showAddAcc?T.purple:T.border}`, borderRadius:5, padding:"3px 10px", color:showAddAcc?T.purple:T.text2, fontWeight:700 }}>+ Add item</button>}>

              {showAddAcc && (
                <div style={{ background:T.surface2, border:`1px solid ${T.purple}44`, borderRadius:8, padding:12, marginBottom:12 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 90px", gap:6, marginBottom:6 }}>
                    <input placeholder="Item description *" value={newAcc.item} onChange={e=>setNewAcc(a=>({...a,item:e.target.value}))}
                      style={{ ...inp(), borderColor:newAcc.item?T.purple:T.border }} />
                    <input placeholder="Color/Variant" value={newAcc.color} onChange={e=>setNewAcc(a=>({...a,color:e.target.value}))} style={inp()} />
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"60px 1fr", gap:6, marginBottom:8 }}>
                    <input placeholder="Qty" type="number" min="1" value={newAcc.qty} onChange={e=>setNewAcc(a=>({...a,qty:e.target.value}))} style={inp()} />
                    <input placeholder="Price incl. VAT (€)" type="number" step="0.01" value={newAcc.price_incl_vat} onChange={e=>setNewAcc(a=>({...a,price_incl_vat:e.target.value}))} style={inp()} />
                  </div>
                  {parseFloat(newAcc.price_incl_vat) > 0 && (
                    <div style={{ fontSize:11, color:T.text2, background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:"4px 8px", marginBottom:8, display:"flex", gap:12 }}>
                      <span>Ex. VAT: <b>{fmtEur(exVat(parseFloat(newAcc.price_incl_vat)))}</b></span>
                      <span>VAT: <b style={{color:T.amber}}>{fmtEur(vatAmt(parseFloat(newAcc.price_incl_vat)))}</b></span>
                      <span>×{parseInt(newAcc.qty)||1} = <b style={{color:T.purple}}>{fmtEur(parseFloat(newAcc.price_incl_vat)*(parseInt(newAcc.qty)||1))}</b></span>
                    </div>
                  )}
                  <div style={{ display:"flex", justifyContent:"flex-end" }}>
                    <button onClick={addAccItem} style={{ background:T.purple, border:"none", borderRadius:6, padding:"5px 16px", color:"#fff", fontSize:12, fontWeight:700 }}>Add</button>
                  </div>
                </div>
              )}

              {!accItems.length && <div style={{ fontSize:12, color:T.text3, padding:"10px 0" }}>No items yet</div>}
              {accItems.map(i => (
                <div key={i.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0", borderBottom:`1px solid ${T.border}` }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, color:T.text, fontWeight:500 }}>{i.item}</div>
                    <div style={{ fontSize:10, color:T.text3, fontFamily:"'IBM Plex Mono',monospace" }}>
                      {i.color && <span style={{marginRight:6}}>{i.color} ·</span>}
                      {i.qty}× · {fmtEur(exVat(i.price_incl_vat))} ex. VAT → <span style={{color:T.purple}}>{fmtEur(i.price_incl_vat * (i.qty||1))} incl. VAT</span>
                    </div>
                  </div>
                  <select value={i.status} onChange={e=>updateAccItemStatus(i.id,e.target.value)}
                    style={{ ...inp(), width:"auto", fontSize:11 }}>
                    {["pending","ordered","arrived"].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                  </select>
                  <button onClick={()=>deleteAccItem(i.id)} style={{ background:"none", border:"none", color:T.red, cursor:"pointer", fontSize:12, padding:"0 2px" }}>✕</button>
                </div>
              ))}

              {accItems.length > 0 && (
                <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${T.border}` }}>
                  <VatBox total={totalInclVat} />
                </div>
              )}
            </Sec>

            {/* Right: Customer + notes + log */}
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              <Sec title="Customer">
                <IR l="Customer"   v={cust?.name} />
                <IR l="Email"      v={cust?.email} />
                <IR l="Phone"      v={cust?.phone} />
                <IR l="SMS opt-in" v={cust?.sms_opt_in?"✓ Yes":"✗ No"} />
                {ticket.device_model && <IR l="For device" v={`${ticket.device_manufacturer} ${ticket.device_model}`} />}
              </Sec>

              <Sec title="Notes">
                <textarea value={ticket.acc_notes||""} onChange={e => save("acc_notes", e.target.value)}
                  rows={3} placeholder="Supplier notes, special requests…"
                  style={{ ...inp(), width:"100%", resize:"vertical", marginBottom:8 }} />
                <pre style={{ fontSize:12, color:T.text2, whiteSpace:"pre-wrap", margin:"0 0 8px", lineHeight:1.7, fontFamily:"'IBM Plex Mono',monospace" }}>
                  {ticket.technician_notes||"No internal notes."}
                </pre>
                <div style={{ display:"flex", gap:8 }}>
                  <input value={newNote} onChange={e => setNewNote(e.target.value)}
                    onKeyDown={e => e.key==="Enter" && addNote()}
                    placeholder="Add internal note…" style={{ ...inp(), flex:1 }} />
                  <button onClick={addNote} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:6, padding:"5px 12px", color:T.purple, fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>+ Add</button>
                </div>
              </Sec>

              <Sec title={`Notification log (${tLogs.length})`}>
                {!tLogs.length && <div style={{ fontSize:12, color:T.text3 }}>No notifications sent yet</div>}
                {tLogs.map(l => (
                  <div key={l.id} style={{ padding:"8px 10px", borderBottom:`1px solid ${T.border}`, background:T.surface2, borderRadius:6, marginBottom:6 }}>
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      <span style={{ fontSize:16 }}>{l.channel==="email"?"📧":"📱"}</span>
                      <div>
                        <div style={{ fontSize:12, fontWeight:600, color:T.text }}>{l.template_key}</div>
                        <div style={{ fontSize:10, color:T.text3 }}>{fmtDate(l.sent_at, true)} · {l.channel==="email"?"Email":"SMS"}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </Sec>
            </div>
          </div>
  );
}


