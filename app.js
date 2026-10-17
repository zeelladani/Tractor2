// app.js
import {
  signInWithGoogle, signOutUser, watchAuth,
  saveDoc, watchCollection, deleteRecord,
  setMeta, watchMeta
} from "./firebase.js";

/* ================= SHORTCUTS ================= */
const $  = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

/* ================= STATE ================= */
const state = {
  user: null,
  fuel: [],
  jobs: [],
  clients: [],
  maintenance: [],
  payments: [],
  unsubPay: null,
  tractor: null,
  editingFuelId: null,
  editingJobId: null,
  editingClientId: null,
  editingMaintId: null,
  jobFilter: "all",
  clientSort: "az",
  summaryRange: "all",
  summaryFrom: "",
  summaryTo: "",
  summaryClientIds: new Set(),
  summaryWorkTypes: new Set(),
  summaryView: "client",
  summaryExpandedClient: null,
  summaryExpandedWork: null,
  msSearch: { client: "", work: "" },
  statModalKey: null,
  loading: { fuel: true, jobs: true, clients: true, maintenance: true },
  unsubFuel: null, unsubJobs: null, unsubClients: null, unsubMaint: null, unsubMeta: null,
  mainChart: null,
  deferredPrompt: null,
  hisabAge: "all",
  dashAllTime: false // Default to false (shows current month)
};

/* ================= CONSTANTS ================= */
const WORK_TYPES = [
  "દાતી", "રાપ", "રોટીવેટર", "વાવણી", "સવળા", "થ્રેસર", "સાહ પાડવા", "માઢ"
];

const WORK_TYPE_LATIN = {
  "દાતી": "Daati", "રાપ": "Raap", "રોટીવેટર": "Rotavator", "વાવણી": "Vaavni",
  "સવળા": "Savla", "થ્રેસર": "Thresher", "સાહ પાડવા": "Saah Paadva", "માઢ": "Maadh"
};

function toLatin(text) {
  if (!text) return "";
  const s = String(text);
  return WORK_TYPE_LATIN[s] || s;
}

/* ================= SOUND ================= */
function playSaved() {
  try {
    const el = $("saveSound");
    if (!el) return;
    el.currentTime = 0;
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_) {}
}

/* ================= DATE & TIME FORMATTERS ================= */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const monthISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
};

function fmtDate(iso) {
  if (!iso || typeof iso !== "string") return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function gujTime(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return "";
  const parts = hhmm.split(":");
  if (parts.length < 2) return "";
  const h = parseInt(parts[0], 10);
  const m = parts[1];
  if (!isFinite(h)) return "";
  const isAm = h < 12;
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  const label = isAm ? "સવાર" : "સાંજ";
  return `${label} ${h12}:${m}`;
}

function gujTimeRange(startTime, endTime) {
  if (!startTime && !endTime) return "";
  if (!startTime) return gujTime(endTime);
  if (!endTime) return gujTime(startTime);
  const crosses = endTime < startTime;
  return `${gujTime(startTime)} → ${gujTime(endTime)}${crosses ? " (next day)" : ""}`;
}

function toMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (!isFinite(h) || !isFinite(m)) return null;
  return h * 60 + m;
}

function timesOverlap(aStart, aEnd, bStart, bEnd) {
  const aS = toMinutes(aStart), aE = toMinutes(aEnd);
  const bS = toMinutes(bStart), bE = toMinutes(bEnd);
  if ([aS, aE, bS, bE].some(v => v === null)) return false;
  const aCross = aE < aS, bCross = bE < bS;
  const rangeA = aCross ? [[aS, 1440], [0, aE]] : [[aS, aE]];
  const rangeB = bCross ? [[bS, 1440], [0, bE]] : [[bS, bE]];
  for (const [s1, e1] of rangeA) {
    for (const [s2, e2] of rangeB) {
      if (Math.max(s1, s2) < Math.min(e1, e2)) return true;
    }
  }
  return false;
}

function findConflict({ date, startTime, endTime, excludeId }) {
  if (!date || !startTime || !endTime) return null;
  return state.jobs.find(j => {
    if (j.id === excludeId) return false;
    if (j.date !== date) return false;
    if (!j.startTime || !j.endTime) return false;
    return timesOverlap(startTime, endTime, j.startTime, j.endTime);
  }) || null;
}

function describeJobForConflict(j) {
  const who = j.clientName ? `${j.clientName} — ` : "";
  const what = CALC.jobTitle(j);
  const range = gujTimeRange(j.startTime, j.endTime);
  return `${range}  (${who}${what})`;
}

/* ================= PAGE TABS ================= */
const PAGES = ["dash", "jobs", "clients", "hisab", "fuel"];
function showPage(name) {
  if (!PAGES.includes(name)) name = "dash";
  PAGES.forEach(p => {
    $$(`.page[data-page="${p}"]`).forEach(el => el.hidden = p !== name);
  });
  $$(".tab, .nav-btn").forEach(b => {
    b.setAttribute("aria-selected", String(b.dataset.page === name));
  });
  if (name === "dash") renderDashboard();
  if (name === "jobs") renderJobs();
  if (name === "clients") renderClients();
  if (name === "hisab") renderHisab();
  if (name === "fuel") renderFuel();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function initTabs() {
  $$(".tab, .nav-btn").forEach(b => {
    b.addEventListener("click", () => showPage(b.dataset.page));
  });
  showPage("dash");
}

/* ================= CALC ENGINE ================= */
const CALC = {
  dieselExpense: (l, p) => (+l || 0) * (+p || 0),
  engineHours: (s, e) => { const v = (+e || 0) - (+s || 0); return v > 0 ? v : 0; },
  wallClockHours: (startTime, endTime) => {
    if (!startTime || !endTime) return 0;
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if ([sh, sm, eh, em].some(n => !isFinite(n))) return 0;
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins < 0) mins += 24 * 60;
    return mins / 60;
  },
  fuelConsumption: (l, h) => h > 0 ? l / h : null,
  fuelCostPerHour: (c, h) => h > 0 ? c / h : null,
  jobVigha: (job) => {
    if (!job) return 0;
    if (job.vigha != null) return +job.vigha || 0;
    if (job.acres != null) return +job.acres || 0;
    return 0;
  },
  jobBillAmount: (job) => {
    if (!job) return 0;
    const mode = job.priceMode || "hour";
    if (mode === "hour")   return (+job.actualHours || 0) * (+job.ratePerHour || 0);
    if (mode === "vigha")  return CALC.jobVigha(job) * (+job.ratePerVigha || 0);
    if (mode === "fixed")  return +job.fixedAmount || 0;
    return 0;
  },
  jobTitle: (job) => {
    if (!job) return "Untitled job";
    return job.workType || job.description || "Untitled job";
  },
  jobPending: (job) => {
    const bill = CALC.jobBillAmount(job);
    const received = +job.amountReceived || 0;
    return Math.max(0, bill - received);
  },
  intervals(fuelRows) {
    const fulls = fuelRows.filter(r => r.isFullTank).sort((a, b) => (+a.hourMeter || 0) - (+b.hourMeter || 0));
    const out = [];
    for (let i = 1; i < fulls.length; i++) {
      const prev = fulls[i - 1], cur = fulls[i];
      const hours = CALC.engineHours(prev.hourMeter, cur.hourMeter);
      const between = fuelRows.filter(r => (+r.hourMeter > +prev.hourMeter) && (+r.hourMeter <= +cur.hourMeter));
      const litres = between.reduce((s, r) => s + (+r.litres || 0), 0);
      const cost   = between.reduce((s, r) => s + (+r.totalCost || 0), 0);
      out.push({
        fromHour: +prev.hourMeter, toHour: +cur.hourMeter, hours, litres,
        lPerHour: CALC.fuelConsumption(litres, hours),
        costPerHour: CALC.fuelCostPerHour(cost, hours)
      });
    }
    return out;
  }
};

/* ================= DOM HELPERS ================= */
function setMsg(el, text, type = "") {
  el.textContent = text || "";
  el.className = "form-msg" + (type ? " " + type : "");
}
function announce(text) {
  const r = $("liveRegion");
  r.textContent = "";
  requestAnimationFrame(() => { r.textContent = text; });
}
const money = (n) => (isFinite(n) ? (+n).toFixed(2) : "—");
const num   = (n, d = 2) => (isFinite(n) ? (+n).toFixed(d) : "—");
const moneyL = (n, loading) => loading ? "…" : money(n);
const numL   = (n, d, loading) => loading ? "…" : num(n, d);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const stat = (label, val, cls = "", key = "") =>
  `<div class="stat" ${key ? `data-stat="${key}" role="button" tabindex="0"` : ""}><div class="lbl">${label}</div><div class="val ${cls}">${val}</div></div>`;
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (m) =>
  ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));

function priceModeLabel(j) {
  const mode = j.priceMode || "hour";
  if (mode === "hour")   return `Per hour · ${money(+j.ratePerHour || 0)}/h`;
  if (mode === "vigha")  return `Per vigha · ${money(+j.ratePerVigha || 0)}/vigha`;
  if (mode === "fixed")  return `Fixed ${money(+j.fixedAmount || 0)}`;
  return "";
}

/* ================= STAT POPUPS (MODALS) ================= */
const STAT_POPUPS = {
  "total-diesel": {
    title: "Fuel spend", goTo: "fuel",
    build() {
      const rows = getFilteredFuel().slice().sort((a,b) => (b.date||"").localeCompare(a.date||""));
      if (!rows.length) return `<p class="empty">No fuel records for this period.</p>`;
      const totalL = rows.reduce((s,r) => s + (+r.litres || 0), 0);
      const totalC = rows.reduce((s,r) => s + (+r.totalCost || 0), 0);
      const fulls = rows.filter(r => r.isFullTank).length;
      return `
        <div class="modal-list">
          ${rows.map(r => `
            <div class="modal-row">
              <div>
                <div class="who">${escapeHtml(fmtDate(r.date))}</div>
                <div class="what">${num(+r.litres || 0, 2)} L @ ${money(+r.pricePerLitre || 0)} · meter ${num(+r.hourMeter || 0, 1)} ${r.isFullTank ? ' · <span class="pill ok">FULL</span>' : ""}</div>
              </div>
              <div class="money fuel">${money(+r.totalCost || 0)}</div>
            </div>`).join("")}
        </div>
        <div class="modal-summary">
          <span>Records: ${rows.length}</span><span>Litres: ${num(totalL, 1)}</span>
          <span>Spend: ${money(totalC)}</span><span>Full tanks: ${fulls}</span>
        </div>`;
    }
  },
  "profit": {
    title: "Profit Breakdown", goTo: "dash",
    build() {
      const fJobs = getFilteredJobs();
      const fFuel = getFilteredFuel();
      const fMaint = getFilteredMaint();
      const billed = fJobs.reduce((s,j) => s + CALC.jobBillAmount(j), 0);
      const diesel = fFuel.reduce((s,r) => s + (+r.totalCost || 0), 0);
      const maint = fMaint.reduce((s,m) => s + (+m.cost || 0), 0);
      const profit = billed - diesel - maint;
      return `
        <div class="modal-list">
          <div class="modal-row"><div><div class="who">Total Work Billed (Revenue)</div></div><div class="money total">${money(billed)}</div></div>
          <div class="modal-row"><div><div class="who">Diesel Expense</div></div><div class="money danger">-${money(diesel)}</div></div>
          <div class="modal-row"><div><div class="who">Maintenance Expense</div></div><div class="money danger">-${money(maint)}</div></div>
          <div class="modal-row" style="border-top:2px solid var(--border); margin-top:8px; padding-top:8px;">
            <div><div class="who" style="font-size:16px">Net Profit</div></div>
            <div class="money ${profit >= 0 ? 'success' : 'danger'}" style="font-size:18px">${money(profit)}</div>
          </div>
        </div>`;
    }
  },
  "total-billed": {
    title: "Billed to clients", goTo: "jobs",
    build() {
      const rows = getFilteredJobs().slice().sort((a,b) => (b.date||"").localeCompare(a.date||""));
      if (!rows.length) return `<p class="empty">No jobs for this period.</p>`;
      const total = rows.reduce((s,j) => s + CALC.jobBillAmount(j), 0);
      return `
        <div class="modal-list">
          ${rows.map(j => {
            const pend = CALC.jobPending(j);
            return `
              <div class="modal-row">
                <div><div class="who">${escapeHtml(j.clientName || "—")}</div><div class="what">${escapeHtml(fmtDate(j.date))} · ${escapeHtml(CALC.jobTitle(j))} · <span class="pill ${pend === 0 ? "ok" : "warn"}">${pend === 0 ? "PAID" : "PENDING"}</span></div></div>
                <div class="money">${money(CALC.jobBillAmount(j))}</div>
              </div>`;
          }).join("")}
        </div>
        <div class="modal-summary"><span>Jobs: ${rows.length}</span><span>Total: ${money(total)}</span></div>`;
    }
  },
  "pending-payments": {
    title: "Pending payments", goTo: "hisab",
    build() {
      const rows = getFilteredJobs().filter(j => CALC.jobPending(j) > 0).sort((a,b) => (b.date||"").localeCompare(a.date||""));
      if (!rows.length) return `<p class="empty">Nothing pending for this period. 🎉</p>`;
      const total = rows.reduce((s,j) => s + CALC.jobPending(j), 0);
      return `
        <div class="modal-list">
          ${rows.map(j => `
            <div class="modal-row">
              <div><div class="who">${escapeHtml(j.clientName || "—")}</div><div class="what">${escapeHtml(fmtDate(j.date))} · ${escapeHtml(CALC.jobTitle(j))}</div></div>
              <div class="money danger">${money(CALC.jobPending(j))}</div>
            </div>`).join("")}
        </div>
        <div class="modal-summary"><span>Pending jobs: ${rows.length}</span><span>Pending: ${money(total)}</span></div>`;
    }
  },
  "latest-lph": {
    title: "Fuel consumption (per meter hour)", goTo: "dash",
    build() {
      const iv = CALC.intervals(getFilteredFuel());
      if (!iv.length) return `<p class="empty">Need two full-tank records to compute consumption.</p>`;
      const sorted = iv.slice().reverse();
      const totL = iv.reduce((s,x) => s + x.litres, 0);
      const totH = iv.reduce((s,x) => s + x.hours, 0);
      const wAvg = totH > 0 ? totL / totH : null;
      return `
        <div class="modal-list">
          ${sorted.map(x => `
            <div class="modal-row">
              <div><div class="who">${num(x.fromHour,1)} → ${num(x.toHour,1)} mtr</div><div class="what">${num(x.litres,1)} L · ${num(x.hours,2)} h · Rs.${x.costPerHour == null ? "—" : num(x.costPerHour, 2)}/h</div></div>
              <div class="money">${x.lPerHour == null ? "—" : num(x.lPerHour, 2)} L/h</div>
            </div>`).join("")}
        </div>
        <div class="modal-summary"><span>Intervals: ${iv.length}</span><span>Weighted avg: ${wAvg == null ? "—" : num(wAvg, 2)} L/h</span></div>`;
    }
  },
  "total-job-cost": {
    title: "Job bill (from pricing)", goTo: "jobs",
    build() {
      const rows = getFilteredJobs().slice().sort((a,b) => (b.date||"").localeCompare(a.date||""));
      if (!rows.length) return `<p class="empty">No jobs for this period.</p>`;
      const total = rows.reduce((s,j) => s + CALC.jobBillAmount(j), 0);
      return `
        <div class="modal-list">
          ${rows.map(j => `
            <div class="modal-row">
              <div><div class="who">${escapeHtml(j.clientName || "—")}</div><div class="what">${escapeHtml(fmtDate(j.date))} · ${escapeHtml(CALC.jobTitle(j))} · ${escapeHtml(priceModeLabel(j))}</div></div>
              <div class="money total">${money(CALC.jobBillAmount(j))}</div>
            </div>`).join("")}
        </div>
        <div class="modal-summary"><span>Jobs: ${rows.length}</span><span>Total: ${money(total)}</span></div>`;
    }
  },
  "total-maint": {
    title: "Maintenance spend", goTo: "fuel",
    build() {
      const rows = getFilteredMaint().slice().sort((a,b) => (b.date||"").localeCompare(a.date||""));
      if (!rows.length) return `<p class="empty">No maintenance entries for this period.</p>`;
      const total = rows.reduce((s,m) => s + (+m.cost || 0), 0);
      return `
        <div class="modal-list">
          ${rows.map(m => `
            <div class="modal-row">
              <div><div class="who">${escapeHtml(m.description || "—")}</div><div class="what">${escapeHtml(fmtDate(m.date))}${m.parts ? " · " + escapeHtml(m.parts) : ""}${m.meterReading ? " · meter " + num(+m.meterReading, 1) : ""}</div></div>
              <div class="money maint">${money(+m.cost || 0)}</div>
            </div>`).join("")}
        </div>
        <div class="modal-summary"><span>Entries: ${rows.length}</span><span>Cost: ${money(total)}</span></div>`;
    }
  },
  "total-cost": {
    title: "Total cost breakdown", goTo: "dash",
    build() {
      const diesel = getFilteredFuel().reduce((s,r) => s + (+r.totalCost || 0), 0);
      const maint  = getFilteredMaint().reduce((s,m) => s + (+m.cost || 0), 0);
      const total  = diesel + maint;
      return `
        <div class="modal-list">
          <div class="modal-row"><div><div class="who">Diesel</div><div class="what">Total fuel spend</div></div><div class="money fuel">${money(diesel)}</div></div>
          <div class="modal-row"><div><div class="who">Maintenance</div><div class="what">Parts + service</div></div><div class="money maint">${money(maint)}</div></div>
        </div>
        <div class="modal-summary"><span>Total: ${money(total)}</span></div>`;
    }
  },
  "latest-cph": {
    title: "Fuel cost per meter hour", goTo: "dash",
    build() {
      const iv = CALC.intervals(getFilteredFuel());
      if (!iv.length) return `<p class="empty">Need two full-tank records to compute cost per hour.</p>`;
      const sorted = iv.slice().reverse();
      const totC = iv.reduce((s,x) => s + (x.costPerHour || 0) * x.hours, 0);
      const totH = iv.reduce((s,x) => s + x.hours, 0);
      const wAvg = totH > 0 ? totC / totH : null;
      return `
        <div class="modal-list">
          ${sorted.map(x => `
            <div class="modal-row">
              <div><div class="who">${num(x.fromHour,1)} → ${num(x.toHour,1)} mtr</div><div class="what">${num(x.litres,1)} L · ${num(x.hours,2)} h · ${x.lPerHour == null ? "—" : num(x.lPerHour, 2)} L/h</div></div>
              <div class="money success">${x.costPerHour == null ? "—" : money(x.costPerHour)}</div>
            </div>`).join("")}
        </div>
        <div class="modal-summary"><span>Intervals: ${iv.length}</span><span>Weighted avg: ${wAvg == null ? "—" : money(wAvg)}</span></div>`;
    }
  },
  "meter-hours": {
    title: "Meter hours (engine)", goTo: "jobs",
    build() {
      const rows = getFilteredJobs().slice().sort((a,b) => (b.date||"").localeCompare(a.date||""));
      if (!rows.length) return `<p class="empty">No jobs for this period.</p>`;
      const total = rows.reduce((s,j) => s + (+j.meterHours || +j.engineHours || 0), 0);
      return `
        <div class="modal-list">
          ${rows.map(j => `
            <div class="modal-row">
              <div><div class="who">${escapeHtml(j.clientName || "—")}</div><div class="what">${escapeHtml(fmtDate(j.date))} · ${escapeHtml(CALC.jobTitle(j))}</div></div>
              <div class="money distance">${num(+j.meterHours || +j.engineHours || 0, 2)} h</div>
            </div>`).join("")}
        </div>
        <div class="modal-summary"><span>Total meter hours: ${num(total, 2)}</span></div>`;
    }
  },
  "actual-hours": {
    title: "Actual hours (clock)", goTo: "jobs",
    build() {
      const rows = getFilteredJobs().slice().sort((a,b) => (b.date||"").localeCompare(a.date||""));
      if (!rows.length) return `<p class="empty">No jobs for this period.</p>`;
      const total = rows.reduce((s,j) => s + (+j.actualHours || 0), 0);
      return `
        <div class="modal-list">
          ${rows.map(j => `
            <div class="modal-row">
              <div><div class="who">${escapeHtml(j.clientName || "—")}</div><div class="what">${escapeHtml(fmtDate(j.date))} · ${escapeHtml(CALC.jobTitle(j))}${(j.startTime || j.endTime) ? " · " + escapeHtml(gujTimeRange(j.startTime, j.endTime)) : ""}</div></div>
              <div class="money mileage">${num(+j.actualHours || 0, 2)} h</div>
            </div>`).join("")}
        </div>
        <div class="modal-summary"><span>Total actual hours: ${num(total, 2)}</span></div>`;
    }
  },
  "jobs": {
    title: "All jobs", goTo: "jobs",
    build() {
      const rows = getFilteredJobs().slice().sort((a,b) => (b.date||"").localeCompare(a.date||""));
      if (!rows.length) return `<p class="empty">No jobs for this period.</p>`;
      const totalBill = rows.reduce((s,j) => s + CALC.jobBillAmount(j), 0);
      const totalVigha = rows.reduce((s,j) => s + CALC.jobVigha(j), 0);
      return `
        <div class="modal-list">
          ${rows.map(j => {
            const pend = CALC.jobPending(j);
            return `
              <div class="modal-row">
                <div><div class="who">${escapeHtml(j.clientName || "—")}</div><div class="what">${escapeHtml(fmtDate(j.date))} · ${escapeHtml(CALC.jobTitle(j))} · ${num(CALC.jobVigha(j), 2)} vgh · ${num(+j.meterHours || +j.engineHours || 0, 1)} mh · <span class="pill ${pend === 0 ? "ok" : "warn"}">${pend === 0 ? "PAID" : "PENDING"}</span></div></div>
                <div class="money">${money(CALC.jobBillAmount(j))}</div>
              </div>`;
          }).join("")}
        </div>
        <div class="modal-summary"><span>Jobs: ${rows.length}</span><span>Vigha: ${num(totalVigha, 2)}</span><span>Billed: ${money(totalBill)}</span></div>`;
    }
  },
  "clients": {
    title: "Clients", goTo: "clients",
    build() {
      const rows = state.clients.slice().sort((a,b) => (a.name||"").localeCompare(b.name||""));
      if (!rows.length) return `<p class="empty">No clients yet.</p>`;
      return `
        <div class="modal-list">
          ${rows.map(c => {
            const s = clientSummaryFor(c.id, c.name);
            return `
              <div class="modal-row">
                <div><div class="who">${escapeHtml(c.name || "—")}</div><div class="what">${c.village ? escapeHtml(c.village) + " · " : ""}${s.jobs.length} job${s.jobs.length === 1 ? "" : "s"} · ${num(s.vigha, 2)} vigha</div></div>
                <div class="money ${s.pending > 0 ? "danger" : "success"}">${money(s.pending)}</div>
              </div>`;
          }).join("")}
        </div>
        <div class="modal-summary"><span>Clients: ${rows.length}</span></div>`;
    }
  },
  
  "job-detail": {
    title: "Job Details", goTo: "jobs",
    build() {
      const jobId = state.statModalKey.substring("job-detail-".length);
      const j = state.jobs.find(x => x.id === jobId);
      if (!j) return `<p class="empty">Job not found.</p>`;
      const client = state.clients.find(c => c.id === j.clientId);
      const bill = CALC.jobBillAmount(j), pending = CALC.jobPending(j), recv = +j.amountReceived || 0;
      
      return `
        <div class="modal-list">
          <div class="modal-row"><div><div class="who">Work</div></div><div class="money total">${escapeHtml(CALC.jobTitle(j))}</div></div>
          <div class="modal-row"><div><div class="who">Client</div></div><div class="money">${escapeHtml(client ? client.name : j.clientName || "—")}</div></div>
          <div class="modal-row"><div><div class="who">Date</div></div><div class="money">${escapeHtml(fmtDate(j.date))}</div></div>
          <div class="modal-row"><div><div class="who">Vigha</div></div><div class="money">${num(CALC.jobVigha(j), 2)}</div></div>
          
          <div style="height:10px"></div>
          <div class="modal-row"><div><div class="who">Meter start</div></div><div class="money">${num(j.startHourMeter, 1)}</div></div>
          <div class="modal-row"><div><div class="who">Meter end</div></div><div class="money">${num(j.endHourMeter, 1)}</div></div>
          <div class="modal-row"><div><div class="who">Meter hours</div></div><div class="money">${num(j.meterHours, 2)} h</div></div>
          <div class="modal-row"><div><div class="who">Time in</div></div><div class="money">${escapeHtml(gujTime(j.startTime))}</div></div>
          <div class="modal-row"><div><div class="who">Time out</div></div><div class="money">${escapeHtml(gujTime(j.endTime))}</div></div>
          <div class="modal-row"><div><div class="who">Actual hours</div></div><div class="money">${num(j.actualHours, 2)} h</div></div>
          
          <div style="height:10px"></div>
          <div class="modal-row"><div><div class="who">Pricing</div></div><div class="money">${escapeHtml(priceModeLabel(j))}</div></div>
          <div class="modal-row"><div><div class="who">Total Bill</div></div><div class="money total" style="font-size:16px">${money(bill)}</div></div>
          <div class="modal-row"><div><div class="who">Received</div></div><div class="money success">${money(recv)}</div></div>
          <div class="modal-row"><div><div class="who">Pending Balance</div></div><div class="money danger">${money(pending)}</div></div>
          <div class="modal-row"><div><div class="who">Fuel share (estimate)</div><div class="what">All diesel spread by meter hours</div></div><div class="money">${money(jobFuelShare(j))}</div></div>
          <div class="modal-row"><div><div class="who">Profit after fuel</div></div><div class="money ${bill - jobFuelShare(j) >= 0 ? "success" : "danger"}">${money(bill - jobFuelShare(j))}</div></div>
        </div>
      `;
    }
  }
};

function openStatModal(key) {
  let cfg;
  if (key.startsWith("job-detail-")) {
    cfg = STAT_POPUPS["job-detail"];
  } else if (key.startsWith("client-detail-")) {
    const cId = key.replace("client-detail-", "");
    const c = state.clients.find(x => x.id === cId);
    const jobs = state.jobs.filter(j => j.clientId === cId);
    const pend = jobs.reduce((s,j) => s + CALC.jobPending(j), 0);
    $("statModalTitle").textContent = c ? c.name : "Client Details";
    $("statModalContent").innerHTML = `
      <div class="modal-list">
        <div class="modal-row"><div><div class="who">Name</div></div><div class="money">${escapeHtml(c?.name || "—")}</div></div>
        <div class="modal-row"><div><div class="who">Total Jobs</div></div><div class="money">${jobs.length}</div></div>
        <div class="modal-row"><div><div class="who">Total Pending</div></div><div class="money danger">${money(pend)}</div></div>
      </div>`;
    const goWrap = $("statModalGoWrap"); goWrap.innerHTML = "";
    const mk = (txt, cls, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn small " + cls; b.textContent = txt; b.onclick = fn; goWrap.appendChild(b); };
    mk("Edit", "btn-primary", () => { closeStatModal(); startEditClient(cId); });
    mk("WhatsApp balance", "btn-ghost", () => whatsappBalance(cId));
    mk("Statement PDF", "btn-ghost", () => exportClientStatement(cId));
    mk("Delete", "btn-danger", () => { closeStatModal(); deleteClient(cId); });
    $("statModalContent").insertAdjacentHTML("beforeend", clientHistoryHtml(cId));
    $("statModal").hidden = false;
    return;
  } else {
    cfg = STAT_POPUPS[key];
  }

  if (!cfg) return;
  state.statModalKey = key;
  $("statModalTitle").textContent = cfg.title;
  $("statModalContent").innerHTML = cfg.build();

  const goWrap = $("statModalGoWrap");
  goWrap.innerHTML = "";
  
  if (key.startsWith("job-detail-")) {
    const jobId = key.substring("job-detail-".length);
    
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-primary small";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => { closeStatModal(); startEditJob(jobId); });
    goWrap.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-danger small";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => {
      if (confirm("Delete this job?")) {
        deleteRecord(state.user.uid, "jobs", jobId).then(() => { closeStatModal(); playSaved(); });
      }
    });
    goWrap.appendChild(delBtn);
    const dupBtn = document.createElement("button");
    dupBtn.type = "button"; dupBtn.className = "btn btn-ghost small"; dupBtn.textContent = "Duplicate";
    dupBtn.addEventListener("click", () => { closeStatModal(); duplicateJob(jobId); });
    goWrap.appendChild(dupBtn);
  } else if (cfg.goTo) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost small";
    btn.textContent = `Go to ${cfg.goTo === "dash" ? "Dashboard" : cfg.goTo.charAt(0).toUpperCase() + cfg.goTo.slice(1)}`;
    btn.addEventListener("click", () => { closeStatModal(); showPage(cfg.goTo); });
    goWrap.appendChild(btn);
  }

  $("statModal").hidden = false;
  $("statModal").setAttribute("aria-hidden", "false");
}

function closeStatModal() {
  state.statModalKey = null;
  $("statModal").hidden = true;
  $("statModal").setAttribute("aria-hidden", "true");
}

function bindStatTiles() {
  $$("#dashHeroStats .stat[data-stat]").forEach(el => {
    el.addEventListener("click", () => openStatModal(el.dataset.stat));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openStatModal(el.dataset.stat); }
    });
  });
}

function initStatModal() {
  $("statModalClose").addEventListener("click", closeStatModal);
  $("statModalBackdrop").addEventListener("click", closeStatModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("statModal").hidden) closeStatModal();
  });
}

/* ================= PAYMENT MODAL (HISAB / FIFO) ================= */
function openPaymentModal(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  const pendingJobs = state.jobs
    .filter(j => j.clientId === clientId && CALC.jobPending(j) > 0)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  if (!pendingJobs.length) { alert("No pending jobs for this client."); return; }

  const totalPending = pendingJobs.reduce((s,j) => s + CALC.jobPending(j), 0);

  let html = `
    <form id="paymentForm">
      <div class="kv-grid" style="margin-bottom:12px; background:var(--panel-2); padding:10px; border-radius:8px;">
        <label class="kv kv-full"><span class="kv-lbl">Date</span><input type="date" id="payDate" required value="${todayISO()}" /></label>
        <label class="kv kv-full"><span class="kv-lbl">Amount ₹</span><input type="number" id="payAmount" inputmode="decimal" min="0" step="0.01" max="${totalPending}" required placeholder="Total: ₹${money(totalPending)}" /></label>
      </div>
      <label class="kv kv-full" style="margin-bottom:12px"><span class="kv-lbl">Method</span><select id="payMethod"><option>Cash</option><option>UPI</option><option>Bank</option><option>Cheque</option></select></label>
      <div style="font-size:12px; font-weight:800; margin-bottom:8px; color:var(--primary)">Payment will be applied oldest to newest (FIFO)</div>
      <div style="max-height: 120px; overflow-y:auto; border:1px solid var(--border); border-radius:8px; padding:8px; background:var(--panel);">
        ${pendingJobs.map(j => `
          <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed var(--border);">
            <div>
              <div style="font-weight:700; font-size:12px;">${fmtDate(j.date)} · ${escapeHtml(CALC.jobTitle(j))}</div>
              <div style="font-size:11px; color:var(--text-dim);">Bill: ₹${money(CALC.jobBillAmount(j))}</div>
            </div>
            <div style="font-weight:700; color:var(--danger); font-size:12px;">Pending: ₹${money(CALC.jobPending(j))}</div>
          </div>
        `).join("")}
      </div>
    </form>
  `;

  $("statModalTitle").textContent = "Record Payment: " + (client?.name || "—");
  $("statModalContent").innerHTML = html;

  const goWrap = $("statModalGoWrap");
  goWrap.innerHTML = "";
  const submitBtn = document.createElement("button");
  submitBtn.className = "btn btn-primary";
  submitBtn.textContent = "Save Payment";
  submitBtn.onclick = async (e) => {
    e.preventDefault();
    const date = $("payDate").value;
    let amt = +$("payAmount").value; const amt0 = amt;

    if (!date || !(amt > 0)) return alert("Please enter a valid date and amount.");

    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";

    try {
      for (const j of pendingJobs) {
        if (amt <= 0) break;
        const currentPending = CALC.jobPending(j);
        const amountToApply = Math.min(amt, currentPending);
        const newReceived = (+j.amountReceived || 0) + amountToApply;
        
        await saveDoc(state.user.uid, "jobs", { 
          amountReceived: newReceived,
          paymentStatus: newReceived >= CALC.jobBillAmount(j) ? "done" : "pending"
        }, j.id);
        
        amt -= amountToApply;
      }
      
      await saveDoc(state.user.uid, "payments", { clientId, clientName: client?.name || "", date, amount: amt0 - Math.max(amt, 0), method: $("payMethod").value }, null);
      closeStatModal();
      playSaved();
      renderHisab();
      renderDashboard();
    } catch (err) {
      console.error(err);
      alert("Failed to save payment.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Save Payment";
    }
  };
  goWrap.appendChild(submitBtn);

  $("statModal").hidden = false;
  $("statModal").setAttribute("aria-hidden", "false");
}

/* ================= PDF EXPORT ================= */
function getFilterDescription() {
  const clientNames = Array.from(state.summaryClientIds).map(id => {
    if (id === "__none__") return "— no client —";
    const c = state.clients.find(x => x.id === id);
    return c ? c.name : "?";
  });
  const workNames = Array.from(state.summaryWorkTypes);
  const clientPart = clientNames.length === 0 ? "All clients" : (clientNames.length <= 3 ? clientNames.join(", ") : `${clientNames.length} clients`);
  const workPart = workNames.length === 0 ? "All work types" : (workNames.length <= 3 ? workNames.join(", ") : `${workNames.length} work types`);
  return `${clientPart} · ${workPart}`;
}

function pdfMoney(n) { return `Rs. ${(+n || 0).toFixed(2)}`; }

function pdfText(doc, text, x, y, opts = {}) {
  const { align = "left", size = 10, style = "normal", color = [40, 40, 40] } = opts;
  doc.setTextColor(color[0], color[1], color[2]);
  doc.setFontSize(size);
  doc.setFont("helvetica", style === "bold" ? "bold" : "normal");
  doc.text(String(text ?? ""), x, y, { align });
}

function exportSummaryPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) { alert("PDF library not loaded. Please refresh."); return; }
  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40, CW = W - M * 2;
  const GREEN = [14, 74, 43], GOLD = [242, 176, 30], INK = [30, 38, 33], DIM = [105, 116, 108], RULE = [215, 222, 213], PANEL = [238, 243, 236], RED = [179, 50, 31], OK = [31, 122, 71], PALE = [205, 228, 214];
  const fmt = (n) => (+n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const T = (t, x, yy, o = {}) => { t = String(t ?? ""); if (/[^\u0000-\u00ff]/.test(t)) gujText(doc, t, x, yy, o); else pdfText(doc, t, x, yy, o); };
  const { from, to } = computeRangeBounds();
  const rangeTxt = `${from ? fmtDate(from) : "All time"} to ${to ? fmtDate(to) : "today"}`;
  const one = state.summaryClientIds.size === 1 ? state.clients.find(c => c.id === Array.from(state.summaryClientIds)[0]) : null;
  const title = one ? "Client statement" : "Summary report";
  const MAIN = [{ h: "Date", x: 0, w: 56 }, { h: "Work", x: 56, w: 118 }, { h: "Vigha", x: 174, w: 46, r: 1 }, { h: "Meter h", x: 220, w: 50, r: 1 }, { h: "Billed", x: 270, w: 76, r: 1 }, { h: "Received", x: 346, w: 76, r: 1 }, { h: "Pending", x: 422, w: CW - 422, r: 1 }];
  const WORK = [{ h: "Work type", x: 0, w: 130 }, { h: "Jobs", x: 130, w: 44, r: 1 }, ...MAIN.slice(2)];
  let y = 0, cols = null;

  const header = (first) => {
    if (first) {
      doc.setFillColor(...GREEN); doc.rect(0, 0, W, 86, "F"); doc.setFillColor(...GOLD); doc.rect(0, 86, W, 4, "F");
      let tx = M;
      if (PDF_LOGO) {
        const LB = 60, k = Math.min(48 / PDF_LOGO.w, 48 / PDF_LOGO.h), lw = PDF_LOGO.w * k, lh = PDF_LOGO.h * k;
        doc.setFillColor(255, 255, 255); doc.roundedRect(M, 13, LB, LB, 8, 8, "F");
        doc.addImage(PDF_LOGO.data, "PNG", M + (LB - lw) / 2, 13 + (LB - lh) / 2, lw, lh);
        tx = M + LB + 14;
      }
      T("ZM Tractor", tx, 42, { size: 24, style: "bold", color: [255, 255, 255] });
      T(one ? `${title} · ${one.name}` : title, tx, 66, { size: 12, color: PALE });
      T(rangeTxt, W - M, 42, { size: 11, color: [255, 255, 255], align: "right" });
      T("Amounts in Rs.", W - M, 66, { size: 9, color: PALE, align: "right" });
      y = 114;
    } else {
      T(`ZM Tractor · ${title} · ${rangeTxt}`, M, 32, { size: 9, color: DIM });
      doc.setDrawColor(...RULE); doc.setLineWidth(0.7); doc.line(M, 40, W - M, 40); y = 62;
    }
  };
  const th = () => {
    doc.setFillColor(...PANEL); doc.rect(M, y - 11, CW, 17, "F");
    cols.forEach(c => T(c.h, c.r ? M + c.x + c.w - 4 : M + c.x + 4, y, { size: 8.5, style: "bold", color: DIM, align: c.r ? "right" : "left" }));
    y += 17;
  };
  const space = (n) => { if (y + n > H - 48) { doc.addPage(); header(false); if (cols) th(); return true; } return false; };
  const row = (cells, o = {}) => {
    space(18);
    if (o.top) { doc.setDrawColor(...INK); doc.setLineWidth(0.8); doc.line(M, y - 11, W - M, y - 11); }
    cells.forEach((v, i) => { const c = cols[i]; T(v, c.r ? M + c.x + c.w - 4 : M + c.x + 4, y, { size: 9, style: o.bold ? "bold" : "normal", color: (o.colors && o.colors[i]) || INK, align: c.r ? "right" : "left" }); });
    if (!o.top) { doc.setDrawColor(...RULE); doc.setLineWidth(0.4); doc.line(M, y + 5, W - M, y + 5); }
    y += 17;
  };
  const pendCell = (p) => p > 0 ? fmt(p) : "Paid";
  const pendCol = (p) => p > 0 ? RED : OK;

  header(true);
  T("Filter:", M, y, { size: 10, style: "bold", color: INK }); T(getFilterDescription(), M + 40, y, { size: 10, color: INK });
  y += 22;

  const jobs = getFilteredJobs();
  const gB = jobs.reduce((s, j) => s + CALC.jobBillAmount(j), 0), gP = jobs.reduce((s, j) => s + CALC.jobPending(j), 0), gR = gB - gP;
  const gV = jobs.reduce((s, j) => s + CALC.jobVigha(j), 0);
  [["Total billed", "Rs. " + fmt(gB), INK], ["Received", "Rs. " + fmt(gR), OK], ["Pending", "Rs. " + fmt(gP), gP > 0 ? RED : OK], ["Work done", `${jobs.length} jobs · ${num(gV, 1)} vigha`, INK]].forEach(([l, v, c], i) => {
    const bw = (CW - 24) / 4, x = M + i * (bw + 8);
    doc.setFillColor(...PANEL); doc.roundedRect(x, y, bw, 46, 6, 6, "F");
    T(l, x + 10, y + 17, { size: 8.5, color: DIM }); T(v, x + 10, y + 36, { size: i === 3 ? 10.5 : 12, style: "bold", color: c });
  });
  y += 72;

  const groups = new Map();
  jobs.forEach(j => { const k = j.clientId || "__none__"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(j); });
  const clientList = Array.from(groups.entries()).map(([id, list]) => {
    const c = state.clients.find(x => x.id === id);
    return { name: (c && c.name) || list[0].clientName || "— no client —", sub: [c && c.village, c && c.phone].filter(Boolean).join("  ·  "), jobs: list.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")) };
  }).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  if (!clientList.length) T("No jobs match these filters.", M, y, { size: 11, color: DIM });
  clientList.forEach(cl => {
    space(96);
    T(cl.name, M, y, { size: 14, style: "bold", color: GREEN }); y += cl.sub ? 14 : 8;
    if (cl.sub) { T(cl.sub, M, y, { size: 9, color: DIM }); y += 16; }
    cols = MAIN; th();
    let v = 0, m = 0, b = 0, r = 0, p = 0;
    cl.jobs.forEach(j => {
      const bill = CALC.jobBillAmount(j), recv = +j.amountReceived || 0, pend = CALC.jobPending(j), mh = +j.meterHours || +j.engineHours || 0;
      v += CALC.jobVigha(j); m += mh; b += bill; r += recv; p += pend;
      row([fmtDate(j.date), CALC.jobTitle(j), num(CALC.jobVigha(j), 2), num(mh, 1), fmt(bill), fmt(recv), pendCell(pend)], { colors: { 6: pendCol(pend) } });
    });
    row(["Total", `${cl.jobs.length} jobs`, num(v, 2), num(m, 1), fmt(b), fmt(r), pendCell(p)], { bold: true, top: true, colors: { 6: pendCol(p) } });
    cols = null; y += 18;
  });

  if (jobs.length) {
    space(96);
    T("By work type", M, y, { size: 14, style: "bold", color: GREEN }); y += 16;
    cols = WORK; th();
    aggregateRows(jobs, "work").forEach(a => row([a.name, String(a.totalJobs), num(a.vigha, 2), num(a.meter, 1), fmt(a.billed), fmt(a.received), pendCell(a.pending)], { colors: { 6: pendCol(a.pending) } }));
    cols = null; y += 16;
  }

  space(70);
  doc.setFillColor(...GREEN); doc.roundedRect(M, y, CW, 52, 8, 8, "F");
  [["Total billed", gB], ["Received", gR], ["Pending", gP]].forEach(([l, v], i) => {
    const x = M + 16 + i * (CW / 3);
    T(l, x, y + 20, { size: 9, color: PALE }); T("Rs. " + fmt(v), x, y + 40, { size: 13, style: "bold", color: [255, 255, 255] });
  });

  const stamp = new Date(), pad = (n) => String(n).padStart(2, "0"), pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RULE); doc.setLineWidth(0.5); doc.line(M, H - 34, W - M, H - 34);
    T(`Generated ${pad(stamp.getDate())}/${pad(stamp.getMonth() + 1)}/${stamp.getFullYear()} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`, M, H - 20, { size: 8.5, color: DIM });
    T(`Page ${i} of ${pages}`, W - M, H - 20, { size: 8.5, color: DIM, align: "right" });
    T("Developed by Zeel M. Ladani  ·  9824864965  ·  info@zeelladani.in  ·  tractor.zeeladani.in", W / 2, H - 8, { size: 8, style: "bold", color: GREEN, align: "center" });
  }
  const slug = one ? (one.name || "client").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "client" : "";
  doc.save(one ? `zm-statement-${slug}-${todayISO()}.pdf` : `zm-summary-${todayISO()}.pdf`);
}

/* ================= AUTH ================= */
function initAuth() {
  $("signInBtn").addEventListener("click", async () => {
    try { await signInWithGoogle(); }
    catch (e) { console.error("sign-in failed:", e.code); announce("Sign-in failed."); }
  });
  $("signOutBtn").addEventListener("click", async () => {
    try { await signOutUser(); } catch (e) { console.error(e.code); }
  });

  watchAuth((user) => {
    state.user = user;
    if (user) {
      $("signInBtn").hidden = true;
      $("userChip").hidden = false;
      $("userAvatar").src = user.photoURL || "https://placehold.co/64x64/05060a/2f7bff/png?text=U";
      $("userAvatar").alt = user.displayName || "User";
      $("userName").textContent = user.displayName || "";
      state.loading = { fuel: true, jobs: true, clients: true, maintenance: true };
      attachUserListeners(user.uid);
      if (!$("fDate").value) $("fDate").value = todayISO();
      if (!$("jDate").value) $("jDate").value = todayISO();
      if (!$("mDate").value) $("mDate").value = todayISO();
      renderDashboard();
    } else {
      $("signInBtn").hidden = false;
      $("userChip").hidden = true;
      detachUserListeners();
      state.fuel = []; state.jobs = []; state.clients = []; state.maintenance = []; state.payments = [];
      state.tractor = null; state.summaryExpandedClient = null; state.summaryExpandedWork = null;
      state.loading = { fuel: true, jobs: true, clients: true, maintenance: true };
      renderFuel(); renderJobs(); renderClients(); renderHisab();
    }
  });
}

function detachUserListeners() {
  if (state.unsubFuel) state.unsubFuel();
  if (state.unsubJobs) state.unsubJobs();
  if (state.unsubClients) state.unsubClients();
  if (state.unsubMaint) state.unsubMaint();
  if (state.unsubMeta) state.unsubMeta();
  if (state.unsubPay) state.unsubPay(); state.unsubPay = null;
  state.unsubFuel = state.unsubJobs = state.unsubClients = state.unsubMaint = state.unsubMeta = null;
}

function attachUserListeners(uid) {
  detachUserListeners();
  let fuelFirst = true, jobsFirst = true, clientsFirst = true, maintFirst = true;
  
  state.unsubFuel = watchCollection(uid, "fuel", "date", (rows) => {
    state.fuel = rows; 
    if (fuelFirst) { fuelFirst = false; state.loading.fuel = false; }
    if (!$(".page[data-page='dash']")?.hidden) renderDashboard();
    if (!$(".page[data-page='fuel']")?.hidden) renderFuel();
    if (!$(".page[data-page='hisab']")?.hidden) renderHisab();
  });
  
  state.unsubJobs = watchCollection(uid, "jobs", "date", (rows) => {
    state.jobs = rows; 
    if (jobsFirst) { jobsFirst = false; state.loading.jobs = false; }
    if (!$(".page[data-page='dash']")?.hidden) renderDashboard();
    if (!$(".page[data-page='jobs']")?.hidden) renderJobs();
    if (!$(".page[data-page='clients']")?.hidden) renderClients();
    if (!$(".page[data-page='hisab']")?.hidden) renderHisab();
  });
  
  state.unsubClients = watchCollection(uid, "clients", "name", (rows) => {
    state.clients = rows.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const validIds = new Set(state.clients.map(c => c.id));
    for (const id of Array.from(state.summaryClientIds)) { if (!validIds.has(id)) state.summaryClientIds.delete(id); }
    if (clientsFirst) { clientsFirst = false; state.loading.clients = false; }
    if (!$(".page[data-page='dash']")?.hidden) renderDashboard();
    if (!$(".page[data-page='clients']")?.hidden) renderClients();
    if (!$(".page[data-page='jobs']")?.hidden) refreshJobClientSelect();
    if (!$(".page[data-page='hisab']")?.hidden) renderHisab();
  });
  
  state.unsubMaint = watchCollection(uid, "maintenance", "date", (rows) => {
    state.maintenance = rows; 
    if (maintFirst) { maintFirst = false; state.loading.maintenance = false; }
    if (!$(".page[data-page='dash']")?.hidden) renderDashboard();
    if (!$(".page[data-page='fuel']")?.hidden) renderMaintenance();
  });
  
  state.unsubPay = watchCollection(uid, "payments", "date", (rows) => { state.payments = rows; });
  state.unsubMeta = watchMeta(uid, "tractor", (data) => {
    state.tractor = data || null; fillTractorForm();
  });
}

/* ================= SUMMARY HELPERS ================= */
function computeRangeBounds() {
  if (state.dashAllTime) return { from: "", to: "" };
  const y = $("dashYear").value || new Date().getFullYear();
  const m = $("dashMonth").value;
  if (m === "all") return { from: `${y}-01-01`, to: `${y}-12-31` };
  const lastDay = new Date(+y, +m, 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(lastDay).padStart(2,"0")}` };
}

function getFilteredJobs() {
  const { from, to } = computeRangeBounds();
  return state.jobs.filter(j => {
    const d = j.date || "";
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (state.summaryClientIds.size > 0 && !state.summaryClientIds.has(j.clientId || "")) return false;
    if (state.summaryWorkTypes.size > 0) {
      const wt = j.workType || j.description || "";
      if (!state.summaryWorkTypes.has(wt)) return false;
    }
    return true;
  });
}

function getFilteredFuel() {
  const { from, to } = computeRangeBounds();
  return state.fuel.filter(r => {
    const d = r.date || "";
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function getFilteredMaint() {
  const { from, to } = computeRangeBounds();
  return state.maintenance.filter(m => {
    const d = m.date || "";
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function aggregateRows(jobs, mode) {
  const groups = new Map();
  if (mode === "client") {
    jobs.forEach(j => {
      const key = j.clientId || "__none__";
      if (!groups.has(key)) {
        if (key === "__none__") groups.set(key, { key, name: j.clientName || "— no client —", sub: "", jobs: [] });
        else {
          const c = state.clients.find(x => x.id === key) || null;
          groups.set(key, { key, name: (c && c.name) || j.clientName || "—", sub: (c && c.village) || "", jobs: [] });
        }
      }
      groups.get(key).jobs.push(j);
    });
  } else {
    jobs.forEach(j => {
      const key = j.workType || j.description || "—";
      if (!groups.has(key)) groups.set(key, { key, name: key || "— no work type —", sub: "", jobs: [] });
      groups.get(key).jobs.push(j);
    });
  }

  const rows = [];
  for (const g of groups.values()) {
    if (g.jobs.length === 0) continue;
    const totalJobs = g.jobs.length;
    const vigha  = g.jobs.reduce((s, j) => s + CALC.jobVigha(j), 0);
    const meter  = g.jobs.reduce((s, j) => s + (+j.meterHours || +j.engineHours || 0), 0);
    const actual = g.jobs.reduce((s, j) => s + (+j.actualHours || 0), 0);
    const billed = g.jobs.reduce((s, j) => s + CALC.jobBillAmount(j), 0);
    const pending = g.jobs.reduce((s, j) => s + CALC.jobPending(j), 0);
    const received = billed - pending;
    rows.push({ ...g, totalJobs, vigha, meter, actual, billed, received, pending });
  }
  rows.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return rows;
}

function updateMsLabel(kind) {
  const labelEl = kind === "client" ? $("msClientLabel") : $("msWorkLabel");
  const set = kind === "client" ? state.summaryClientIds : state.summaryWorkTypes;
  if (set.size === 0) { labelEl.textContent = kind === "client" ? "All clients" : "All work types"; return; }
  if (set.size === 1) {
    const id = Array.from(set)[0];
    if (kind === "client") { const c = state.clients.find(x => x.id === id); labelEl.textContent = c ? c.name : "1 selected"; }
    else { labelEl.textContent = id; }
    return;
  }
  const first = Array.from(set)[0]; let firstName = first;
  if (kind === "client") { const c = state.clients.find(x => x.id === first); firstName = c ? c.name : "…"; }
  labelEl.textContent = `${firstName} +${set.size - 1}`;
}

function renderMsList(kind) {
  const listEl = kind === "client" ? $("msClientList") : $("msWorkList");
  const allEl  = kind === "client" ? $("msClientAll") : $("msWorkAll");
  const set    = kind === "client" ? state.summaryClientIds : state.summaryWorkTypes;
  const search = (state.msSearch[kind] || "").toLowerCase();
  const items = [];
  if (kind === "client") {
    state.clients.forEach(c => { items.push({ id: c.id, label: c.name + (c.village ? ` — ${c.village}` : "") }); });
    items.push({ id: "__none__", label: "— no client —" });
  } else {
    WORK_TYPES.forEach(w => items.push({ id: w, label: w }));
  }
  const filtered = search ? items.filter(it => (it.label || "").toLowerCase().includes(search)) : items;
  listEl.innerHTML = filtered.length
    ? filtered.map(it => `<label class="ms-row"><input type="checkbox" data-id="${escapeHtml(it.id)}" ${set.has(it.id) ? "checked" : ""} /><span>${escapeHtml(it.label)}</span></label>`).join("")
    : `<div class="ms-empty">No matches</div>`;

  const allIds = items.map(i => i.id);
  allEl.checked = allIds.length > 0 && allIds.every(id => set.has(id));

  listEl.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.id;
      if (cb.checked) set.add(id); else set.delete(id);
      updateMsLabel(kind); renderSummary();
      allEl.checked = allIds.length > 0 && allIds.every(x => set.has(x));
    });
  });

  allEl.onchange = () => {
    if (allEl.checked) { set.clear(); allIds.forEach(id => set.add(id)); } else { set.clear(); }
    updateMsLabel(kind); renderSummary(); renderMsList(kind);
  };
}

function openMs(kind, open) {
  const panel = kind === "client" ? $("msClientPanel") : $("msWorkPanel");
  const btn   = kind === "client" ? $("msClientBtn")   : $("msWorkBtn");
  const wrap  = btn.closest(".ms-wrap");
  if (open) {
    if (kind === "client") closeMs("work"); else closeMs("client");
    state.msSearch[kind] = "";
    const searchEl = kind === "client" ? $("msClientSearch") : $("msWorkSearch");
    searchEl.value = ""; renderMsList(kind);
    panel.hidden = false; wrap.setAttribute("data-open", "true"); btn.setAttribute("aria-expanded", "true");
    setTimeout(() => searchEl.focus(), 20);
  } else {
    panel.hidden = true; wrap.removeAttribute("data-open"); btn.setAttribute("aria-expanded", "false");
  }
}
function closeMs(kind) { openMs(kind, false); }

function initSummary() {
  $$("#sumViewRow .chip-btn").forEach(b => {
    b.addEventListener("click", () => {
      state.summaryView = b.dataset.view;
      $$("#sumViewRow .chip-btn").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.view === state.summaryView)));
      renderSummary();
    });
  });

  $("msClientBtn").addEventListener("click", (e) => { e.stopPropagation(); openMs("client", $("msClientPanel").hidden); });
  $("msWorkBtn").addEventListener("click", (e) => { e.stopPropagation(); openMs("work", $("msWorkPanel").hidden); });
  $("msClientPanel").addEventListener("click", (e) => e.stopPropagation());
  $("msWorkPanel").addEventListener("click", (e) => e.stopPropagation());

  $("msClientSearch").addEventListener("input", () => { state.msSearch.client = $("msClientSearch").value; renderMsList("client"); });
  $("msWorkSearch").addEventListener("input", () => { state.msSearch.work = $("msWorkSearch").value; renderMsList("work"); });
  $("msClientClear").addEventListener("click", () => { state.summaryClientIds.clear(); updateMsLabel("client"); renderMsList("client"); renderSummary(); });
  $("msWorkClear").addEventListener("click", () => { state.summaryWorkTypes.clear(); updateMsLabel("work"); renderMsList("work"); renderSummary(); });
  $("msClientDone").addEventListener("click", () => closeMs("client"));
  $("msWorkDone").addEventListener("click", () => closeMs("work"));

  document.addEventListener("click", (e) => {
    if (!$("msClientPanel").hidden && !e.target.closest(".ms-wrap[data-ms='client']")) closeMs("client");
    if (!$("msWorkPanel").hidden && !e.target.closest(".ms-wrap[data-ms='work']")) closeMs("work");
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMs("client"); closeMs("work"); } });
  $("exportSummaryPdf").addEventListener("click", exportSummaryPDF);
}

function summaryRowsHtml(rows, expandedKey) {
  return rows.map(r => {
    const expanded = expandedKey === r.key;
    const pendingClass = r.pending > 0 ? "warn" : "";
    const subLine = r.sub || `${r.totalJobs} job${r.totalJobs === 1 ? "" : "s"}`;
    const jobsRows = r.jobs.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(j => `
        <div class="sum-job">
          <div>
            <div class="who">${escapeHtml(fmtDate(j.date))} · ${escapeHtml(CALC.jobTitle(j))}</div>
            <div class="what">${num(CALC.jobVigha(j), 2)} vigha · ${num(+j.meterHours || +j.engineHours || 0, 2)} mh / ${num(+j.actualHours || 0, 2)} ah ${(CALC.jobPending(j) === 0) ? '<span class="pill ok" style="margin-left:4px">PAID</span>' : '<span class="pill warn" style="margin-left:4px">PENDING</span>'}</div>
          </div>
          <div class="money">${money(CALC.jobBillAmount(j))}</div>
        </div>`).join("");
    return `
      <div class="sum-item" data-key="${escapeHtml(r.key)}" data-expanded="${expanded ? "true" : "false"}">
        <div class="sum-head" role="button" tabindex="0" aria-expanded="${expanded}">
          <div class="who"><div class="name">${escapeHtml(r.name)}</div><div class="sub">${escapeHtml(subLine)}</div></div>
          <div class="amt"><div class="lbl">Billed</div><div class="val">${money(r.billed)}</div></div>
          <div class="amt"><div class="lbl">Pending</div><div class="val ${pendingClass}">${money(r.pending)}</div></div>
          <div class="chev">▸</div>
        </div>
        <div class="sum-body">
          <div class="sum-metric">
            <div class="m"><div class="lbl">Jobs</div><div class="val">${r.totalJobs}</div></div>
            <div class="m"><div class="lbl">Vigha</div><div class="val">${num(r.vigha, 2)}</div></div>
            <div class="m"><div class="lbl">Meter h</div><div class="val">${num(r.meter, 2)}</div></div>
            <div class="m"><div class="lbl">Actual h</div><div class="val">${num(r.actual, 2)}</div></div>
            <div class="m"><div class="lbl">Billed</div><div class="val">${money(r.billed)}</div></div>
            <div class="m"><div class="lbl">Received</div><div class="val">${money(r.received)}</div></div>
          </div>
          <div class="sum-jobs">${jobsRows || '<div class="empty" style="padding:6px">No jobs</div>'}</div>
        </div>
      </div>`;
  }).join("");
}

function summaryTotalsHtml(rows) {
  const tJobs = rows.reduce((s, r) => s + r.totalJobs, 0);
  const tVigha = rows.reduce((s, r) => s + r.vigha, 0);
  const tMeter = rows.reduce((s, r) => s + r.meter, 0);
  const tActual = rows.reduce((s, r) => s + r.actual, 0);
  const tBilled = rows.reduce((s, r) => s + r.billed, 0);
  const tRecv = rows.reduce((s, r) => s + r.received, 0);
  const tPend = rows.reduce((s, r) => s + r.pending, 0);
  return `<span>Jobs: ${tJobs}</span><span>Vigha: ${num(tVigha, 2)}</span><span>Meter h: ${num(tMeter, 2)}</span><span>Actual h: ${num(tActual, 2)}</span><span>Billed: ${money(tBilled)}</span><span>Received: ${money(tRecv)}</span><span>Pending: ${money(tPend)}</span>`;
}

function attachSummaryRowHandlers(tableEl, sectionKey) {
  tableEl.querySelectorAll(".sum-head").forEach(head => {
    const item = head.closest(".sum-item");
    const key = item.dataset.key;
    const toggle = () => {
      const expandKey = sectionKey === "client" ? "summaryExpandedClient" : "summaryExpandedWork";
      const isOpen = state[expandKey] === key;
      state[expandKey] = isOpen ? null : key;
      tableEl.querySelectorAll(".sum-item").forEach(el => {
        const open = el.dataset.key === state[expandKey];
        el.setAttribute("data-expanded", String(open));
        const h = el.querySelector(".sum-head"); if (h) h.setAttribute("aria-expanded", String(open));
      });
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  });
}

function renderSummary() {
  updateMsLabel("client"); updateMsLabel("work");
  if (!$("msClientPanel").hidden) renderMsList("client");
  if (!$("msWorkPanel").hidden) renderMsList("work");

  $("summaryClientSection").hidden = state.summaryView === "work";
  $("summaryWorkSection").hidden   = state.summaryView === "client";

  const jobs = getFilteredJobs();

  if (state.summaryView !== "work") {
    const clientRows = aggregateRows(jobs, "client");
    const clientTable = $("summaryByClient"), clientEmpty = $("summaryClientEmpty"), clientTotals = $("summaryClientTotals");
    if (clientRows.length === 0) { clientTable.innerHTML = ""; clientTotals.hidden = true; clientEmpty.hidden = false; }
    else {
      clientEmpty.hidden = true;
      clientTable.innerHTML = summaryRowsHtml(clientRows, state.summaryExpandedClient);
      clientTotals.hidden = false; clientTotals.innerHTML = summaryTotalsHtml(clientRows);
      attachSummaryRowHandlers(clientTable, "client");
    }
  }

  if (state.summaryView !== "client") {
    const workRows = aggregateRows(jobs, "work");
    const workTable = $("summaryByWork"), workEmpty = $("summaryWorkEmpty"), workTotals = $("summaryWorkTotals");
    if (workRows.length === 0) { workTable.innerHTML = ""; workTotals.hidden = true; workEmpty.hidden = false; }
    else {
      workEmpty.hidden = true;
      workTable.innerHTML = summaryRowsHtml(workRows, state.summaryExpandedWork);
      workTotals.hidden = false; workTotals.innerHTML = summaryTotalsHtml(workRows);
      attachSummaryRowHandlers(workTable, "work");
    }
  }
}

/* ================= HISAB (ACCOUNTS) ================= */
function renderHisab() {
  const billed = state.jobs.reduce((s,j) => s + CALC.jobBillAmount(j), 0);
  const recv = state.jobs.reduce((s,j) => s + (+j.amountReceived||0), 0);
  const pend = state.jobs.reduce((s,j) => s + CALC.jobPending(j), 0);
  const cost = state.fuel.reduce((s,r)=>s+(+r.totalCost||0),0) + state.maintenance.reduce((s,m)=>s+(+m.cost||0),0);

  $("hisabHeroStats").innerHTML = `
    ${stat("Total Billed", money(billed), "total")}
    ${stat("Total Received", money(recv), "success")}
    ${stat("Total Pending", money(pend), "danger")}
    ${stat("Total Profit", money(billed - cost), "mileage")}`;

  const now = new Date();
  const agedList = $("hisabAgedList");
  const pendingJobs = state.jobs.filter(j => CALC.jobPending(j) > 0);
  const aged = pendingJobs.filter(j => {
    if (state.hisabAge === "all") return true;
    const months = +state.hisabAge;
    const jd = new Date(j.date);
    const diffMonths = (now.getFullYear() - jd.getFullYear()) * 12 + (now.getMonth() - jd.getMonth());
    return diffMonths >= months;
  });

  $("hisabAgedEmpty").hidden = aged.length > 0;
  agedList.innerHTML = aged.sort((a,b) => (a.date||"").localeCompare(b.date||"")).map(j => `
    <div class="insight-row" style="border-left: 4px solid var(--danger)">
      <div class="body">
        <div class="lbl">${fmtDate(j.date)} · ${escapeHtml(j.clientName||"Unknown")}</div>
        <div class="val">${escapeHtml(CALC.jobTitle(j))} · Pending: <b style="color:var(--danger)">${money(CALC.jobPending(j))}</b> (out of ${money(CALC.jobBillAmount(j))})</div>
      </div>
    </div>`).join("");

  $$("#hisabAgeFilter .chip-btn").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.age === state.hisabAge)));

  const clientMap = new Map();
  state.jobs.forEach(j => {
    const key = j.clientId || "__none__";
    if (!clientMap.has(key)) clientMap.set(key, { id: key, name: j.clientName || "Unknown", billed: 0, recv: 0, pend: 0, jobs: 0 });
    const c = clientMap.get(key);
    c.billed += CALC.jobBillAmount(j);
    c.recv += (+j.amountReceived || 0);
    c.pend += CALC.jobPending(j);
    c.jobs++;
  });

  const sortedClients = Array.from(clientMap.values()).filter(c => c.pend > 0 || c.recv > 0).sort((a,b) => b.pend - a.pend);
  $("hisabLedgersEmpty").hidden = sortedClients.length > 0;
  
  $("hisabLedgers").innerHTML = sortedClients.map(c => `
    <div class="hisab-card">
      <div class="info">
        <div class="name">${escapeHtml(c.name)}</div>
        <div class="detail">${c.jobs} job(s) · Balance: <b style="color:${c.pend>0?'var(--danger)':'var(--success)'}">₹${money(c.pend)}</b></div>
      </div>
      <div class="amounts">
        <div class="amt-box"><div class="lbl">Billed</div><div class="val billed">₹${money(c.billed)}</div></div>
        <div class="amt-box"><div class="lbl">Paid</div><div class="val paid">₹${money(c.recv)}</div></div>
        ${c.pend > 0 ? `<button class="btn btn-primary small" onclick="window.openPaymentModal('${c.id}')">Record Payment</button>` : ""}
      </div>
    </div>
  `).join("");
}

window.openPaymentModal = openPaymentModal;

/* ================= FORMS ================= */
function initForms() {
  $$("#chartTabs .chip-btn").forEach(b => b.addEventListener("click", () => { state.chartKind = b.dataset.chart; $$("#chartTabs .chip-btn").forEach(x => x.setAttribute("aria-pressed", String(x === b))); renderCharts(); }));
  
  $("chkAllTime").addEventListener("change", (e) => {
    state.dashAllTime = e.target.checked;
    $("dashYear").disabled = state.dashAllTime;
    $("dashMonth").disabled = state.dashAllTime;
    $("dashYear").style.opacity = state.dashAllTime ? "0.6" : "1";
    $("dashMonth").style.opacity = state.dashAllTime ? "0.6" : "1";
    renderDashboard();
  });

  $("dashYear").addEventListener("change", renderDashboard);
  $("dashMonth").addEventListener("change", renderDashboard);

  $("fuelForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.user) return setMsg($("fuelMsg"), "Please sign in first.", "error");
    const date = $("fDate").value, litres = +$("fLitres").value, price = +$("fPrice").value, hour = +$("fHour").value, isFull = $("fFull").checked;
    if (!date) return setMsg($("fuelMsg"), "Date is required.", "error");
    if (!(litres > 0)) return setMsg($("fuelMsg"), "Litres must be > 0.", "error");
    if (!(price >= 0)) return setMsg($("fuelMsg"), "Price must be ≥ 0.", "error");
    if (!(hour >= 0)) return setMsg($("fuelMsg"), "Meter reading is required.", "error");
    const payload = { date, litres, pricePerLitre: price, totalCost: CALC.dieselExpense(litres, price), hourMeter: hour, isFullTank: isFull, notes: $("fNotes").value.trim() };
    try {
      await saveDoc(state.user.uid, "fuel", payload, state.editingFuelId);
      setMsg($("fuelMsg"), state.editingFuelId ? "Updated." : "Saved.", "ok");
      announce("Fuel record saved."); playSaved(); resetFuelForm();
    } catch (err) { console.error("save fuel:", err.code); setMsg($("fuelMsg"), "Could not save.", "error"); }
  });
  $("fuelCancelEdit").addEventListener("click", resetFuelForm);

  $("jPriceMode").addEventListener("change", applyPriceModeVisibility);
  $("jStart").addEventListener("input", updateMeterStartHint);
  $$("#jPaySeg .seg-btn").forEach(b => { b.addEventListener("click", () => { $$("#jPaySeg .seg-btn").forEach(x => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", "true"); }); });
  $("jClient").addEventListener("change", (e) => { if (e.target.value === "__new__") { showPage("clients"); setTimeout(() => $("cName").focus(), 400); } });

  $("jobForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.user) return setMsg($("jobMsg"), "Please sign in first.", "error");
    const date = $("jDate").value, clientId = $("jClient").value, workType = $("jWorkType").value, vigha = +$("jVigha").value || 0, start = +$("jStart").value, end = +$("jEnd").value;
    const startTime = $("jStartTime").value || "", endTime = $("jEndTime").value || "", priceMode = $("jPriceMode").value;
    const ratePerHour = +$("jRateHour").value || 0, ratePerVigha = +$("jRateVigha").value || 0, fixedAmount = +$("jFixed").value || 0;
    const amountReceived = +$("jAmountReceived").value || 0;
    const payBtn = document.querySelector('#jPaySeg .seg-btn[aria-pressed="true"]');
    const paymentStatus = payBtn ? payBtn.dataset.val : "pending";

    if (!date) return setMsg($("jobMsg"), "Date is required.", "error");
    if (!clientId) return setMsg($("jobMsg"), "Client is required.", "error");
    if (!workType) return setMsg($("jobMsg"), "Work type is required.", "error");
    if (!(vigha > 0)) return setMsg($("jobMsg"), "Vigha must be > 0.", "error");
    if (priceMode === "hour"  && !(ratePerHour > 0)) return setMsg($("jobMsg"), "Rate per hour is required.", "error");
    if (priceMode === "vigha" && !(ratePerVigha > 0)) return setMsg($("jobMsg"), "Rate per vigha is required.", "error");
    if (priceMode === "fixed" && !(fixedAmount > 0)) return setMsg($("jobMsg"), "Fixed amount is required.", "error");
    if (end < start) return setMsg($("jobMsg"), "End meter must be ≥ start meter.", "error");

    if (startTime && endTime) {
      const conflict = findConflict({ date, startTime, endTime, excludeId: state.editingJobId });
      if (conflict) return setMsg($("jobMsg"), `Time conflict on ${fmtDate(date)}: ${describeJobForConflict(conflict)}`, "error");
    }

    const meterHours = CALC.engineHours(start, end), actualHours = CALC.wallClockHours(startTime, endTime);
    const client = state.clients.find(c => c.id === clientId);
    const base = { date, clientId: clientId || "", clientName: client ? client.name : "", workType, vigha, startHourMeter: start, endHourMeter: end, startTime, endTime, meterHours, actualHours, priceMode, ratePerHour, ratePerVigha, fixedAmount, paymentStatus, amountReceived, paymentDate: paymentStatus === "done" ? todayISO() : null };
    base.jobCost = CALC.jobBillAmount(base);

    try {
      await saveDoc(state.user.uid, "jobs", base, state.editingJobId);
      setMsg($("jobMsg"), state.editingJobId ? "Updated." : "Saved.", "ok");
      announce("Job saved."); playSaved(); resetJobForm();
    } catch (err) { console.error("save job:", err.code); setMsg($("jobMsg"), "Could not save.", "error"); }
  });
  $("jobCancelEdit").addEventListener("click", resetJobForm);

  $$("#jobFilterRow .chip-btn").forEach(b => { b.addEventListener("click", () => { state.jobFilter = b.dataset.filter; $$("#jobFilterRow .chip-btn").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.filter === state.jobFilter))); renderJobs(); }); });
  $$("#clientSortRow .chip-btn").forEach(b => { b.addEventListener("click", () => { state.clientSort = b.dataset.sort; $$("#clientSortRow .chip-btn").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.sort === state.clientSort))); renderClients(); }); });

  $("clientForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.user) return setMsg($("clientMsg"), "Please sign in first.", "error");
    const name = $("cName").value.trim();
    if (!name) return setMsg($("clientMsg"), "Name is required.", "error");
    const payload = { name, phone: $("cPhone").value.trim(), village: $("cVillage").value.trim(), notes: $("cNotes").value.trim() };
    try {
      await saveDoc(state.user.uid, "clients", payload, state.editingClientId);
      setMsg($("clientMsg"), state.editingClientId ? "Updated." : "Saved.", "ok");
      announce("Client saved."); playSaved(); resetClientForm();
    } catch (err) { console.error("save client:", err.code); setMsg($("clientMsg"), "Could not save.", "error"); }
  });
  $("clientCancelEdit").addEventListener("click", resetClientForm);

  $("maintForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.user) return setMsg($("maintMsg"), "Please sign in first.", "error");
    const date = $("mDate").value, desc = $("mDesc").value.trim();
    if (!date) return setMsg($("maintMsg"), "Date is required.", "error");
    if (!desc) return setMsg($("maintMsg"), "Description is required.", "error");
    const payload = { date, description: desc, parts: $("mParts").value.trim(), cost: +$("mCost").value || 0, meterReading: +$("mMeter").value || 0, notes: $("mNotes").value.trim() };
    try {
      await saveDoc(state.user.uid, "maintenance", payload, state.editingMaintId);
      setMsg($("maintMsg"), state.editingMaintId ? "Updated." : "Saved.", "ok");
      announce("Maintenance saved."); playSaved(); resetMaintForm();
    } catch (err) { console.error("save maintenance:", err.code); setMsg($("maintMsg"), "Could not save.", "error"); }
  });
  $("maintCancelEdit").addEventListener("click", resetMaintForm);

  $("tractorForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.user) return setMsg($("tractorMsg"), "Please sign in first.", "error");
    const data = { model: $("tModel").value.trim(), registration: $("tReg").value.trim(), fuelCapacityLitres: +$("tCap").value || 0, startingHourMeter: +$("tStart").value || 0 };
    try {
      await setMeta(state.user.uid, "tractor", data);
      setMsg($("tractorMsg"), "Profile saved.", "ok"); playSaved();
    } catch (err) { console.error("save tractor:", err.code); setMsg($("tractorMsg"), "Could not save.", "error"); }
  });

  $$("#hisabAgeFilter .chip-btn").forEach(b => b.addEventListener("click", () => { state.hisabAge = b.dataset.age; renderHisab(); }));

  $("exportJson").addEventListener("click", exportJSON);
  $("exportCsv").addEventListener("click", exportCSV);
  $("exportXlsx").addEventListener("click", exportXLSX);
  $("exportClear").addEventListener("click", () => { $("expFrom").value = ""; $("expTo").value = ""; });
}

function applyPriceModeVisibility() {
  const mode = $("jPriceMode").value;
  $("jRateHourWrap").hidden = mode !== "hour";
  $("jRateVighaWrap").hidden = mode !== "vigha";
  $("jFixedWrap").hidden = mode !== "fixed";
}

function updateMeterStartHint() {
  const hintEl = $("jStartHint");
  if (!hintEl) return;
  const jobs = state.jobs.filter(j => j.id !== state.editingJobId).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const last = jobs[0];
  if (!last) { hintEl.hidden = true; return; }
  const lastEnd = +last.endHourMeter || 0;
  const lastDateStr = last.date ? fmtDate(last.date) : "unknown";
  const currentVal = +$("jStart").value;
  hintEl.hidden = false;
  if (isNaN(currentVal) || currentVal === 0) {
    hintEl.classList.remove("warn");
    hintEl.textContent = `Last: ${num(lastEnd, 1)} h (${lastDateStr})`;
    return;
  }
  const gap = currentVal - lastEnd;
  if (Math.abs(gap) < 0.05) {
    hintEl.classList.remove("warn");
    hintEl.textContent = `Matches last (${num(lastEnd, 1)} h on ${lastDateStr})`;
  } else {
    hintEl.classList.add("warn");
    hintEl.textContent = `Gap of ${num(Math.abs(gap), 2)} h since last (${num(lastEnd, 1)} h on ${lastDateStr})`;
  }
}

function resetFuelForm() {
  state.editingFuelId = null; $("fuelForm").reset(); $("fDate").value = todayISO();
  $("fuelFormTitle").textContent = "Add fuel record"; $("fuelSubmit").textContent = "Save fuel record";
  $("fuelEditBanner").hidden = true; $("fuelCancelEdit").hidden = true; setMsg($("fuelMsg"), "");
}

function resetJobForm() {
  state.editingJobId = null; $("jobForm").reset(); $("jDate").value = todayISO(); $("jAmountReceived").value = 0;
  $("jRateHour").value = 0; $("jRateVigha").value = 0; $("jFixed").value = 0; $("jPriceMode").value = "hour"; $("jWorkType").value = "";
  applyPriceModeVisibility();
  $$("#jPaySeg .seg-btn").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.val === "pending")));
  refreshJobClientSelect();
  const last = state.jobs.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  $("jStart").value = last ? (last.endHourMeter ?? "") : "";
  updateMeterStartHint();
  $("jobFormTitle").textContent = "Add job"; $("jobSubmit").textContent = "Save job";
  $("jobEditBanner").hidden = true; $("jobCancelEdit").hidden = true; setMsg($("jobMsg"), "");
}

function resetClientForm() {
  state.editingClientId = null; $("clientForm").reset(); $("clientFormTitle").textContent = "Add client";
  $("clientSubmit").textContent = "Save client"; $("clientEditBanner").hidden = true; $("clientCancelEdit").hidden = true;
  setMsg($("clientMsg"), "");
}

function resetMaintForm() {
  state.editingMaintId = null; $("maintForm").reset(); $("mDate").value = todayISO(); $("mCost").value = 0;
  $("maintSubmit").textContent = "Save maintenance"; $("maintEditBanner").hidden = true; $("maintCancelEdit").hidden = true;
  setMsg($("maintMsg"), "");
}

function fillTractorForm() {
  const t = state.tractor || {};
  $("tModel").value = t.model || ""; $("tReg").value = t.registration || "";
  $("tCap").value = t.fuelCapacityLitres ?? ""; $("tStart").value = t.startingHourMeter ?? "";
  renderDtTractor(); renderDtSide();
}

function refreshJobClientSelect() {
  const sel = $("jClient"), current = sel.value;
  const opts = ['<option value="">— select —</option>'];
  state.clients.forEach(c => opts.push(`<option value="${c.id}">${escapeHtml(c.name)}${c.village ? " — " + escapeHtml(c.village) : ""}</option>`));
  opts.push('<option value="__new__">+ Add new client</option>');
  sel.innerHTML = opts.join("");
  if (current && (current === "__new__" || [...sel.options].some(o => o.value === current))) sel.value = current;
}

function renderFuel() {
  const rows = state.fuel; $("fuelEmpty").hidden = rows.length > 0;
  const tbody = $("fuelRows");
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(fmtDate(r.date))}</td><td class="num">${num(+r.litres || 0, 2)}</td>
      <td class="num">${money(+r.pricePerLitre || 0)}</td><td class="num">${money(+r.totalCost || 0)}</td>
      <td class="num">${num(+r.hourMeter || 0, 1)}</td>
      <td>${r.isFullTank ? '<span class="pill ok">FULL</span>' : '<span class="pill">partial</span>'}</td>
      <td><button class="btn btn-ghost small" data-act="edit" data-id="${r.id}">Edit</button><button class="btn btn-danger small" data-act="del" data-id="${r.id}">Del</button></td>
    </tr>`).join("");
  tbody.querySelectorAll("button[data-act]").forEach(b => b.addEventListener("click", () => { b.dataset.act === "edit" ? startEditFuel(b.dataset.id) : removeRecord("fuel", b.dataset.id, "fuel"); }));
  const totalLitres = rows.reduce((s, r) => s + (+r.litres || 0), 0), totalCost = rows.reduce((s, r) => s + (+r.totalCost || 0), 0);
  const fullCount = rows.filter(r => r.isFullTank).length, lastHour = rows.reduce((m, r) => Math.max(m, +r.hourMeter || 0), 0), L = state.loading.fuel;
  $("fuelHeroStats").innerHTML = `${stat("Total litres", numL(totalLitres, 1, L), "fuel")}${stat("Total spend", moneyL(totalCost, L), "total")}${stat("Full-tank records", L ? "…" : String(fullCount), "mileage")}${stat("Latest meter", numL(lastHour, 1, L), "distance")}`;
}

function startEditFuel(id) {
  const r = state.fuel.find(x => x.id === id); if (!r) return;
  state.editingFuelId = id;
  $("fDate").value = r.date || todayISO(); $("fLitres").value = r.litres ?? ""; $("fPrice").value = r.pricePerLitre ?? ""; $("fHour").value = r.hourMeter ?? "";
  $("fFull").checked = !!r.isFullTank; $("fNotes").value = r.notes || "";
  $("fuelFormTitle").textContent = "Edit fuel record"; $("fuelSubmit").textContent = "Update fuel record";
  $("fuelEditBanner").hidden = false; $("fuelCancelEdit").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function visibleJobs() {
  if (state.jobFilter === "pending") return state.jobs.filter(j => CALC.jobPending(j) > 0);
  if (state.jobFilter === "done") return state.jobs.filter(j => CALC.jobPending(j) === 0);
  return state.jobs;
}

function jobItemHtml(j) {
  const bill = CALC.jobBillAmount(j), pending = CALC.jobPending(j);
  const pendingClass = pending === 0 ? "zero" : "", statusLabel = pending === 0 ? "PAID" : "PENDING";
  const title = CALC.jobTitle(j), client = state.clients.find(c => c.id === j.clientId) || null;
  const clientVillage = client ? client.village : "", villageSub = j.clientName ? `${escapeHtml(j.clientName)}${clientVillage ? " · " + escapeHtml(clientVillage) : ""}` : "&nbsp;";
  
  return `
    <div class="client-item job-item" data-id="${j.id}">
      <div class="client-card-content" data-act="view" data-id="${j.id}">
        <div class="who">
          <div class="name">${escapeHtml(title)}</div>
          <div class="sub">${villageSub}</div>
          <div class="sub" style="opacity:.7">${escapeHtml(fmtDate(j.date))}</div>
        </div>
        <div style="text-align:right">
          <div class="name" style="color:var(--c-total);font-size:12.5px">${money(bill)}</div>
          <div class="sub" style="color:${pending > 0 ? 'var(--danger)' : 'var(--success)'}">Bal: ${money(pending)}</div>
          <div class="pill ${pending === 0 ? "ok" : "warn"}" style="margin-top:2px">${statusLabel}</div>
        </div>
        <div class="chev">›</div>
      </div>
    </div>`;
}

function renderJobs() {
  const rows = visibleJobs();
  $("jobEmpty").hidden = rows.length > 0;
  $("jobCards").innerHTML = rows.map(jobItemHtml).join("");

  $("jobCards").querySelectorAll(".client-card-content").forEach(el => {
    el.addEventListener("click", () => { openStatModal("job-detail-" + el.dataset.id); });
  });

  const all = state.jobs;
  const totalBilled = all.reduce((s, j) => s + CALC.jobBillAmount(j), 0);
  const totalPending = all.reduce((s, j) => s + CALC.jobPending(j), 0);
  const totalHours = all.reduce((s, j) => s + (+j.meterHours || +j.engineHours || 0), 0);
  const L = state.loading.jobs;

  $("jobsHeroStats").innerHTML = `
    ${stat("Jobs logged", L ? "…" : String(all.length), "fuel")}
    ${stat("Total bill", moneyL(totalBilled, L), "total")}
    ${stat("Pending bill", moneyL(totalPending, L), "danger")}
    ${stat("Meter hours", numL(totalHours, 1, L), "distance")}`;
}

function startEditJob(id) {
  const j = state.jobs.find(x => x.id === id); if (!j) return;
  state.editingJobId = id;
  $("jDate").value = j.date || todayISO();
  refreshJobClientSelect(); $("jClient").value = j.clientId || "";
  $("jWorkType").value = j.workType || j.description || "";
  $("jVigha").value = CALC.jobVigha(j) || "";
  $("jStart").value = j.startHourMeter ?? "";
  $("jEnd").value = j.endHourMeter ?? "";
  $("jStartTime").value = j.startTime || "";
  $("jEndTime").value = j.endTime || "";
  $("jPriceMode").value = j.priceMode || "hour";
  $("jRateHour").value = j.ratePerHour ?? 0;
  $("jRateVigha").value = j.ratePerVigha ?? 0;
  $("jFixed").value = j.fixedAmount ?? 0;
  $("jAmountReceived").value = j.amountReceived ?? 0;
  applyPriceModeVisibility(); updateMeterStartHint();
  const status = j.paymentStatus || "pending";
  $$("#jPaySeg .seg-btn").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.val === status)));
  $("jobFormTitle").textContent = "Edit job";
  $("jobSubmit").textContent = "Update job";
  $("jobEditBanner").hidden = false; $("jobCancelEdit").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clientSummaryFor(clientId, clientName) {
  const jobs = state.jobs.filter(j => (clientId && j.clientId === clientId) || (!j.clientId && clientName && j.clientName === clientName));
  const vigha = jobs.reduce((s, j) => s + CALC.jobVigha(j), 0), meter = jobs.reduce((s, j) => s + (+j.meterHours || +j.engineHours || 0), 0);
  const actual = jobs.reduce((s, j) => s + (+j.actualHours || 0), 0), billed = jobs.reduce((s, j) => s + CALC.jobBillAmount(j), 0);
  const pending = jobs.reduce((s, j) => s + CALC.jobPending(j), 0);
  const received = billed - pending, lastDate = jobs.reduce((d, j) => (j.date && j.date > d ? j.date : d), "");
  return { jobs, vigha, meter, actual, billed, pending, received, lastDate };
}

function sortedClientsWithSummary() {
  const rows = state.clients.map(c => ({ c, s: clientSummaryFor(c.id, c.name) }));
  const sort = state.clientSort;
  rows.sort((a, b) => {
    if (sort === "pending") { if (b.s.pending !== a.s.pending) return b.s.pending - a.s.pending; return (a.c.name || "").localeCompare(b.c.name || ""); }
    if (sort === "vigha") { if (b.s.vigha !== a.s.vigha) return b.s.vigha - a.s.vigha; return (a.c.name || "").localeCompare(b.c.name || ""); }
    return (a.c.name || "").localeCompare(b.c.name || "");
  });
  return rows;
}

function clientItemHtml(c, s) {
  const pendingClass = s.pending > 0 ? "" : "zero", villageLine = c.village ? escapeHtml(c.village) : "&nbsp;";
  return `
    <div class="client-item" data-id="${c.id}">
      <div class="client-card-content" data-act="view" data-id="${c.id}">
        <div class="who">
          <div class="name">${escapeHtml(c.name || "—")}</div>
          <div class="sub">${villageLine}</div>
        </div>
        <div style="text-align:right">
          <div class="pending ${pendingClass}">${money(s.pending)}</div>
        </div>
        <div class="chev">›</div>
      </div>
    </div>`;
}

function renderClients() {
  const rows = state.clients; $("clientEmpty").hidden = rows.length > 0;
  const enriched = sortedClientsWithSummary();
  $("clientCards").innerHTML = enriched.map(({ c, s }) => clientItemHtml(c, s)).join("");

  $("clientCards").querySelectorAll(".client-card-content").forEach(el => {
    el.addEventListener("click", () => { openStatModal("client-detail-" + el.dataset.id); });
  });

  const total = rows.length, active = rows.filter(c => clientSummaryFor(c.id, c.name).jobs.length > 0).length;
  const totalBilled = rows.reduce((s, c) => s + clientSummaryFor(c.id, c.name).billed, 0), L = state.loading.clients;

  $("clientsHeroStats").innerHTML = `
    ${stat("Clients", L ? "…" : String(total), "fuel")}
    ${stat("Active", L ? "…" : String(active), "mileage")}
    ${stat("Total billed", moneyL(totalBilled, L), "total")}
    ${stat("Avg / client", L ? "…" : (total ? money(totalBilled / total) : "—"), "distance")}`;
}

function startEditClient(id) {
  const c = state.clients.find(x => x.id === id); if (!c) return;
  state.editingClientId = id;
  $("cName").value = c.name || ""; $("cPhone").value = c.phone || ""; $("cVillage").value = c.village || ""; $("cNotes").value = c.notes || "";
  $("clientFormTitle").textContent = "Edit client"; $("clientSubmit").textContent = "Update client";
  $("clientEditBanner").hidden = false; $("clientCancelEdit").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteClient(id) {
  if (!state.user) return;
  const c = state.clients.find(x => x.id === id); if (!c) return;
  const summary = clientSummaryFor(id, c.name);
  if (summary.jobs.length > 0) {
    if (!confirm(`This client has ${summary.jobs.length} job(s). Delete anyway?`)) return;
    if (!confirm("Jobs will keep the client name but lose the link. Continue?")) return;
  } else {
    if (!confirm(`Delete client "${c.name}"?`)) return;
  }
  try { await deleteRecord(state.user.uid, "clients", id); announce("Client deleted."); }
  catch (e) { console.error("delete client:", e.code); announce("Delete failed."); }
}

function renderMaintenance() {
  const rows = state.maintenance; $("maintEmpty").hidden = rows.length > 0;
  $("maintList").innerHTML = rows.map(m => `
    <div class="insight-row">
      <div class="icon">🔧</div>
      <div class="body">
        <div class="lbl">${escapeHtml(fmtDate(m.date))} · ${money(+m.cost || 0)}</div>
        <div class="val">${escapeHtml(m.description || "")}${m.parts ? " · " + escapeHtml(m.parts) : ""}</div>
      </div>
      <div class="actions"><button class="btn btn-ghost small" data-act="edit" data-id="${m.id}">Edit</button><button class="btn btn-danger small" data-act="del" data-id="${m.id}">Del</button></div>
    </div>`).join("");

  $("maintList").querySelectorAll("button[data-act]").forEach(b => b.addEventListener("click", () => { b.dataset.act === "edit" ? startEditMaint(b.dataset.id) : removeRecord("maintenance", b.dataset.id, "maintenance"); }));
}

function startEditMaint(id) {
  const m = state.maintenance.find(x => x.id === id); if (!m) return;
  state.editingMaintId = id;
  $("mDate").value = m.date || todayISO(); $("mDesc").value = m.description || ""; $("mParts").value = m.parts || ""; $("mCost").value = m.cost ?? 0; $("mMeter").value = m.meterReading ?? ""; $("mNotes").value = m.notes || "";
  $("maintSubmit").textContent = "Update maintenance"; $("maintEditBanner").hidden = false; $("maintCancelEdit").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ================= DASHBOARD ================= */
function populateDashPeriods() {
  const selY = $("dashYear");
  if (!selY) return;
  
  // Options are already hardcoded in HTML, but we set the default value here
  const currentYear = new Date().getFullYear();
  selY.value = (currentYear >= 2026 && currentYear <= 2030) ? currentYear : 2026;

  // Set default month to current month
  const m = new Date().getMonth() + 1;
  $("dashMonth").value = String(m).padStart(2, "0");
}

function renderDashboard() {
  const { from, to } = computeRangeBounds();
  const fJobs = state.jobs.filter(j => (!from || j.date >= from) && (!to || j.date <= to));
  const fFuel = state.fuel.filter(r => (!from || r.date >= from) && (!to || r.date <= to));
  const fMaint = state.maintenance.filter(m => (!from || m.date >= from) && (!to || m.date <= to));

  const totalDiesel = fFuel.reduce((s, r) => s + (+r.totalCost || 0), 0);
  const totalBilled = fJobs.reduce((s, j) => s + CALC.jobBillAmount(j), 0);
  const totalMaint = fMaint.reduce((s, m) => s + (+m.cost || 0), 0);
  const grandTotal = totalDiesel + totalMaint;
  const netProfit = totalBilled - grandTotal;

  const totalMeterHours = fJobs.reduce((s, j) => s + (+j.meterHours || +j.engineHours || 0), 0);
  const totalActualHours = fJobs.reduce((s, j) => s + (+j.actualHours || 0), 0);
  const totalPending = fJobs.reduce((s, j) => s + CALC.jobPending(j), 0);
  
  const intervals = CALC.intervals(fFuel);
  const lastLph = intervals.length ? intervals[intervals.length - 1].lPerHour : null;
  const lastCph = intervals.length ? intervals[intervals.length - 1].costPerHour : null;
  
  const L = state.loading, anyLoading = L.fuel || L.jobs || L.maint || L.clients;

  $("dashHeroStats").innerHTML = `
    ${stat("Total diesel", moneyL(totalDiesel, L.fuel), "fuel", "total-diesel")}
    ${stat("Total billed", moneyL(totalBilled, L.jobs), "total", "total-billed")}
    ${stat("Net Profit", moneyL(netProfit, anyLoading), netProfit >= 0 ? "success" : "danger", "profit")}
    ${stat("Pending payments", moneyL(totalPending, L.jobs), "danger", "pending-payments")}
    ${stat("Job bill", moneyL(totalBilled, L.jobs), "total", "total-job-cost")}
    ${stat("Total maintenance", moneyL(totalMaint, L.maint), "maint", "total-maint")}
    ${stat("Total cost", moneyL(grandTotal, anyLoading), "distance", "total-cost")}
    ${stat("Latest L / hour", L.fuel ? "…" : (lastLph == null ? "—" : num(lastLph, 2)), "mileage", "latest-lph")}
    ${stat("Latest cost / hour", L.fuel ? "…" : (lastCph == null ? "—" : money(lastCph)), "success", "latest-cph")}
    ${stat("Meter hours", numL(totalMeterHours, 1, L.jobs), "distance", "meter-hours")}
    ${stat("Actual hours", numL(totalActualHours, 1, L.jobs), "mileage", "actual-hours")}
    ${stat("Jobs", L.jobs ? "…" : String(fJobs.length), "fuel", "jobs")}
    ${stat("Clients", L.clients ? "…" : String(state.clients.length), "total", "clients")}`;

  bindStatTiles();

  $("dashChips").innerHTML = `<span class="chip">Full-tank intervals: ${intervals.length}</span><span class="chip">Fuel records: ${fFuel.length}</span><span class="chip">Jobs: ${fJobs.length}</span><span class="chip">Maintenance entries: ${fMaint.length}</span>`;
  
  const wrap = $("intervals"); $("intervalsEmpty").hidden = intervals.length > 0;
  wrap.innerHTML = intervals.slice().reverse().slice(0, 8).map(iv => `
    <div class="insight-row"><div class="icon">⛽</div><div class="body"><div class="lbl">${num(iv.fromHour,1)} → ${num(iv.toHour,1)} hrs (Δ ${num(iv.hours,2)} h)</div><div class="val">${num(iv.litres,1)} L · ${iv.lPerHour == null ? "—" : num(iv.lPerHour,2)} L/h · ${iv.costPerHour == null ? "—" : money(iv.costPerHour)}/h</div></div></div>`).join("");

  renderSummary();
  renderCharts();
  renderDesktopDash({ fJobs, fFuel, fMaint, intervals, anyLoading });
}

function renderInsights(fJobs, fFuel, fMaint) {
  const el = $("insights"); if (!el) return;
  const sum = (a, f) => a.reduce((s, x) => s + (+f(x) || 0), 0);
  const billed = sum(fJobs, CALC.jobBillAmount), pend = sum(fJobs, CALC.jobPending), recv = billed - pend;
  const vigha = sum(fJobs, CALC.jobVigha), meterH = sum(fJobs, j => j.meterHours || j.engineHours);
  const diesel = sum(fFuel, r => r.totalCost), profit = billed - diesel - sum(fMaint, m => m.cost);
  const pct = (a, b) => b > 0 ? Math.round(a / b * 100) + "%" : "—";
  const top = (keyFn) => { const m = new Map(); fJobs.forEach(j => m.set(keyFn(j), (m.get(keyFn(j)) || 0) + CALC.jobBillAmount(j))); return [...m].sort((a, b) => b[1] - a[1])[0] || null; };
  const tc = top(j => j.clientName || "Unknown"), tw = top(j => toLatin(CALC.jobTitle(j)));
  const kpi = (l, v, sub, cls = "") => `<div class="kpi"><div class="lbl">${l}</div><div class="val ${cls}">${v}</div><div class="sub">${sub}</div></div>`;
  el.innerHTML = [
    kpi("Profit margin", pct(profit, billed), `₹${money(profit)} net`, profit < 0 ? "danger" : ""),
    kpi("Collected", pct(recv, billed), `₹${money(pend)} pending`),
    kpi("Earned per vigha", vigha > 0 ? money(billed / vigha) : "—", `${num(vigha, 1)} vigha done`),
    kpi("Fuel per vigha", vigha > 0 ? money(diesel / vigha) : "—", `₹${money(diesel)} diesel`),
    kpi("Vigha per engine hour", meterH > 0 ? num(vigha / meterH, 2) : "—", `${num(meterH, 1)} meter hours`),
    kpi("Average job", fJobs.length ? money(billed / fJobs.length) : "—", `${fJobs.length} jobs`),
    kpi("Top client", tc ? escapeHtml(tc[0]) : "—", tc ? `${pct(tc[1], billed)} of billing` : "No jobs"),
    kpi("Top work", tw ? escapeHtml(tw[0]) : "—", tw ? `₹${money(tw[1])} billed` : "No jobs")
  ].join("");
}

function renderCharts() {
  if (!$("mainChart")) return;
  const { from, to } = computeRangeBounds();
  const inR = (r) => (!from || r.date >= from) && (!to || r.date <= to);
  const fJobs = state.jobs.filter(inR), fFuel = state.fuel.filter(inR), fMaint = state.maintenance.filter(inR);
  renderInsights(fJobs, fFuel, fMaint);
  if (typeof Chart === "undefined") return;
  if (state.mainChart) { state.mainChart.destroy(); state.mainChart = null; }
  const kind = state.chartKind || "trend", wrap = $("mainChart").parentElement, note = $("chartNote");
  const cP = cssVar("--primary"), cF = cssVar("--c-distance"), cM = cssVar("--c-maint");
  Chart.defaults.color = cssVar("--text-dim"); Chart.defaults.borderColor = cssVar("--border"); Chart.defaults.font.family = cssVar("--font-body");
  const pal = [cP, cF, "#0d9488", "#9333EA", cM, "#0891B2", "#65A30D", "#DB2777"];
  const opt = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } } };
  let cfg = null;

  if (kind === "trend") {
    const monthly = state.dashAllTime || $("dashMonth").value === "all";
    const map = new Map();
    const add = (r, k, v) => { const key = monthly ? (r.date || "").slice(0, 7) : (r.date || "").slice(8, 10); if (!key) return; if (!map.has(key)) map.set(key, { in: 0, out: 0 }); map.get(key)[k] += v; };
    fJobs.forEach(j => add(j, "in", CALC.jobBillAmount(j)));
    fFuel.forEach(r => add(r, "out", +r.totalCost || 0));
    fMaint.forEach(m => add(m, "out", +m.cost || 0));
    const keys = [...map.keys()].sort();
    if (keys.length) cfg = { type: "bar", data: { labels: keys.map(k => monthly ? k.slice(5) + "/" + k.slice(2, 4) : k), datasets: [
      { label: "Earned", data: keys.map(k => map.get(k).in), backgroundColor: cP, borderRadius: 4 },
      { label: "Spent", data: keys.map(k => map.get(k).out), backgroundColor: cF, borderRadius: 4 },
      { type: "line", label: "Profit", data: keys.map(k => map.get(k).in - map.get(k).out), borderColor: "#111", backgroundColor: "#111", tension: .3, pointRadius: 3 }] }, options: opt };
  } else if (kind === "work") {
    const m = new Map();
    fJobs.forEach(j => { const k = toLatin(CALC.jobTitle(j)); m.set(k, (m.get(k) || 0) + CALC.jobBillAmount(j)); });
    const e = [...m].filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
    if (e.length) cfg = { type: "doughnut", data: { labels: e.map(x => x[0]), datasets: [{ data: e.map(x => x[1]), backgroundColor: pal, borderWidth: 2, borderColor: "#fff" }] }, options: { ...opt, cutout: "58%" } };
  } else if (kind === "clients") {
    const m = new Map();
    fJobs.forEach(j => { const k = j.clientName || "Unknown", o = m.get(k) || { r: 0, p: 0 }, p = CALC.jobPending(j); o.p += p; o.r += CALC.jobBillAmount(j) - p; m.set(k, o); });
    const e = [...m].sort((a, b) => (b[1].r + b[1].p) - (a[1].r + a[1].p)).slice(0, 7);
    if (e.length) cfg = { type: "bar", data: { labels: e.map(x => x[0]), datasets: [
      { label: "Received", data: e.map(x => x[1].r), backgroundColor: cP }, { label: "Pending", data: e.map(x => x[1].p), backgroundColor: cM }] },
      options: { ...opt, indexAxis: "y", scales: { x: { stacked: true }, y: { stacked: true } } } };
  } else if (kind === "yoy") {
    const y = +($("dashYear").value || new Date().getFullYear());
    const prof = (yy) => { const a = Array(12).fill(0); const add = (r, v) => { if ((r.date || "").slice(0, 4) === String(yy)) a[+r.date.slice(5, 7) - 1] += v; };
      state.jobs.forEach(x => add(x, CALC.jobBillAmount(x))); state.fuel.forEach(x => add(x, -(+x.totalCost || 0))); state.maintenance.forEach(x => add(x, -(+x.cost || 0))); return a; };
    const cur = prof(y), prev = prof(y - 1);
    if (cur.some(Boolean) || prev.some(Boolean)) cfg = { type: "bar", data: { labels: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"], datasets: [
      { label: `${y - 1} profit`, data: prev, backgroundColor: cF, borderRadius: 4 }, { label: `${y} profit`, data: cur, backgroundColor: cP, borderRadius: 4 }] }, options: opt };
  } else {
    const iv = CALC.intervals(fFuel).filter(x => x.lPerHour != null);
    if (iv.length) cfg = { type: "line", data: { labels: iv.map(x => num(x.toHour, 0) + " h"), datasets: [
      { label: "Litres per hour", data: iv.map(x => x.lPerHour), borderColor: cF, backgroundColor: cF, tension: .3, yAxisID: "y" },
      { label: "Fuel cost per hour (₹)", data: iv.map(x => x.costPerHour), borderColor: cP, backgroundColor: cP, tension: .3, yAxisID: "y1" }] },
      options: { ...opt, scales: { y: { position: "left" }, y1: { position: "right", grid: { drawOnChartArea: false } } } } };
  }

  wrap.hidden = !cfg; note.hidden = !!cfg;
  if (!cfg) note.textContent = kind === "fuel" ? "Add two full-tank fuel records to see consumption." : "No data for this period yet.";
  else state.mainChart = new Chart($("mainChart").getContext("2d"), cfg);
}

/* ================= DESKTOP DASHBOARD (>= 1024px) ================= */
const DT_MQ = window.matchMedia("(min-width: 1024px)");
const DT_ICON = {
  fuel: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.2-.7-.7-2.2z"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 10h18M16 15h2"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
  cash: '<path d="M7 5h11M7 9h11M10 5c4 0 4 6 0 6H7l7 8"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  field: '<path d="M12 21V11M12 11c0-4 3-6 7-6 0 4-3 6-7 6zM12 14c0-3-2-5-6-5 0 3 2 5 6 5z"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>'
};
const dtIcon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${DT_ICON[k] || ""}</svg>`;
const inr = (n) => (n < 0 ? "-" : "") + "₹ " + Math.abs(+n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

function dtPeriodLabel() {
  if (state.dashAllTime) return "All time";
  const y = $("dashYear").value, m = $("dashMonth").value;
  if (m === "all") return y;
  return new Date(+y, +m - 1, 1).toLocaleString("en-US", { month: "long" }) + " " + y;
}

function dtPrevBounds() {
  if (state.dashAllTime) return null;
  const y = +$("dashYear").value, m = $("dashMonth").value, p2 = (n) => String(n).padStart(2, "0");
  if (m === "all") return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: "vs last year" };
  let py = y, pm = +m - 1;
  if (pm === 0) { pm = 12; py--; }
  return { from: `${py}-${p2(pm)}-01`, to: `${py}-${p2(pm)}-${p2(new Date(py, pm, 0).getDate())}`, label: "vs last month" };
}

function dtDelta(cur, prev, good, label) {
  if (prev == null || cur == null || !isFinite(prev) || !isFinite(cur) || prev === 0) return "";
  const p = (cur - prev) / Math.abs(prev) * 100;
  if (!isFinite(p)) return "";
  const up = p >= 0, isGood = good === "up" ? up : !up;
  const cls = Math.abs(p) < 0.5 ? "" : (isGood ? "good" : "bad");
  return `<div class="dt-kpi-delta ${cls}">${up ? "↑" : "↓"} ${Math.abs(p).toFixed(0)}%<small>${label}</small></div>`;
}

function dtAvgLph(fuelRows) {
  const iv = CALC.intervals(fuelRows);
  const l = iv.reduce((s, x) => s + x.litres, 0), h = iv.reduce((s, x) => s + x.hours, 0);
  return h > 0 ? l / h : null;
}

function dtAgo(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  const d = new Date(+m[1], +m[2] - 1, +m[3]), t = new Date(); t.setHours(0, 0, 0, 0);
  const n = Math.round((t - d) / 864e5);
  if (n === 0) return "Today";
  if (n === 1) return "Yesterday";
  if (n > 1 && n < 30) return n + " days ago";
  return fmtDate(iso);
}

function dtLatestMeter() {
  const a = state.fuel.reduce((m, r) => Math.max(m, +r.hourMeter || 0), 0);
  const b = state.jobs.reduce((m, j) => Math.max(m, +j.endHourMeter || 0), 0);
  return Math.max(a, b);
}

function renderDtSide() {
  const el = $("dtSideCard"); if (!el) return;
  const t = state.tractor || {}, meter = dtLatestMeter();
  el.innerHTML = `<img src="./ZM_tractor.png" alt="" /><div><b>${escapeHtml(t.model || "My tractor")}</b>${t.registration ? `<small>${escapeHtml(t.registration)}</small>` : ""}<small>Meter ${meter > 0 ? num(meter, 1) + " h" : "—"}</small></div>`;
}

function renderDtTractor() {
  const el = $("dtTractor"); if (!el) return;
  const t = state.tractor || {}, meter = dtLatestMeter();
  el.innerHTML = `
    <div class="dt-tr">
      <img src="./ZM_tractor.png" alt="" />
      <div class="dt-tr-info">
        <h4>${escapeHtml(t.model || "Tractor profile not set")}</h4>
        <div class="dt-tr-row"><span>Reg. no</span><b>${escapeHtml(t.registration || "—")}</b></div>
        <div class="dt-tr-row"><span>Tank capacity</span><b>${t.fuelCapacityLitres ? num(t.fuelCapacityLitres, 1) + " L" : "—"}</b></div>
        <div class="dt-tr-row"><span>Start meter</span><b>${t.startingHourMeter ? num(t.startingHourMeter, 1) + " h" : "—"}</b></div>
        <div class="dt-tr-row"><span>Latest meter</span><b>${meter > 0 ? num(meter, 1) + " h" : "—"}</b></div>
      </div>
    </div>
    <button type="button" class="btn btn-ghost" data-goto="fuel" data-scroll="tractorForm">Edit profile →</button>`;
}

function renderDesktopDash(ctx) {
  const dash = $("dtDash"); if (!dash) return;
  renderDtSide();
  if (!DT_MQ.matches) {
    if (state.dtFuelChart) { state.dtFuelChart.destroy(); state.dtFuelChart = null; }
    if (state.dtExpChart) { state.dtExpChart.destroy(); state.dtExpChart = null; }
    return;
  }
  const { fJobs, fFuel, fMaint, anyLoading } = ctx;
  const sum = (a, f) => a.reduce((s, x) => s + (+f(x) || 0), 0);
  const label = dtPeriodLabel(), pb = dtPrevBounds();
  const inB = (r) => (r.date || "") >= pb.from && (r.date || "") <= pb.to;
  const pJobs = pb ? state.jobs.filter(inB) : [], pFuel = pb ? state.fuel.filter(inB) : [], pMaint = pb ? state.maintenance.filter(inB) : [];
  const cur = {
    litres: sum(fFuel, r => r.litres), diesel: sum(fFuel, r => r.totalCost), maint: sum(fMaint, m => m.cost),
    billed: sum(fJobs, CALC.jobBillAmount), pending: sum(fJobs, CALC.jobPending), vigha: sum(fJobs, CALC.jobVigha), lph: dtAvgLph(fFuel)
  };
  cur.cost = cur.diesel + cur.maint; cur.profit = cur.billed - cur.cost;
  const prev = pb ? {
    litres: sum(pFuel, r => r.litres), maint: sum(pMaint, m => m.cost), billed: sum(pJobs, CALC.jobBillAmount),
    vigha: sum(pJobs, CALC.jobVigha), lph: dtAvgLph(pFuel), diesel: sum(pFuel, r => r.totalCost)
  } : null;
  if (prev) { prev.cost = prev.diesel + prev.maint; prev.profit = prev.billed - prev.cost; }
  const D = (k, good) => prev ? dtDelta(cur[k], prev[k], good, pb.label) : "";
  const W = (v) => anyLoading ? "…" : v;

  const kpi = (key, icon, color, lbl, val, sub, delta, cls = "") =>
    `<div class="dt-kpi" data-stat="${key}" role="button" tabindex="0"><div class="dt-kpi-ic c-${color}">${dtIcon(icon)}</div><div class="dt-kpi-body"><div class="dt-kpi-lbl">${lbl}</div><div class="dt-kpi-val ${cls}">${val}</div><div class="dt-kpi-foot"><span class="dt-kpi-sub">${sub}</span>${delta}</div></div></div>`;

  $("dtKpis").innerHTML = [
    kpi("total-diesel", "fuel", "blue", "Fuel Used", W(num(cur.litres, 1) + " L"), label, D("litres", "down")),
    kpi("total-maint", "wrench", "red", "Maintenance Cost", W(inr(cur.maint)), label, D("maint", "down")),
    kpi("total-cost", "wallet", "purple", "Total Cost", W(inr(cur.cost)), label, D("cost", "down")),
    kpi("latest-lph", "gauge", "teal", "Avg Consumption", W(cur.lph == null ? "—" : num(cur.lph, 2) + " L/h"), label, D("lph", "down")),
    kpi("total-billed", "cash", "green", "Total Billed", W(inr(cur.billed)), label, D("billed", "up")),
    kpi("profit", "trend", "slate", "Net Profit", W(inr(cur.profit)), label, D("profit", "up"), anyLoading ? "" : (cur.profit >= 0 ? "success" : "danger")),
    kpi("pending-payments", "clock", "orange", "Pending Payments", W(inr(cur.pending)), `${fJobs.filter(j => CALC.jobPending(j) > 0).length} unpaid jobs`, "", cur.pending > 0 && !anyLoading ? "danger" : ""),
    kpi("jobs", "field", "pink", "Work Done", W(num(cur.vigha, 1) + " vigha"), `${fJobs.length} jobs`, D("vigha", "up"))
  ].join("");

  const chartOk = typeof Chart !== "undefined";

  /* fuel consumption: last 6 months */
  const months = [], now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-US", { month: "short" }), litres: 0 });
  }
  state.fuel.forEach(r => { const m = months.find(x => x.key === (r.date || "").slice(0, 7)); if (m) m.litres += +r.litres || 0; });
  const hasFuel = months.some(m => m.litres > 0);
  $("dtFuelWrap").hidden = !hasFuel; $("dtFuelEmpty").hidden = hasFuel;
  if (state.dtFuelChart) { state.dtFuelChart.destroy(); state.dtFuelChart = null; }
  if (hasFuel && chartOk) {
    state.dtFuelChart = new Chart($("dtFuelChart").getContext("2d"), {
      type: "bar",
      data: { labels: months.map(m => m.label), datasets: [{ label: "Litres", data: months.map(m => +m.litres.toFixed(2)), backgroundColor: "#3b82f6", borderRadius: 6, maxBarThickness: 44 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: "#eef2f7" } }, x: { grid: { display: false } } } }
    });
  }

  /* expense breakdown */
  $("dtExpPeriod").textContent = label;
  const exp = [{ name: "Diesel", v: cur.diesel, c: "#2563eb" }, { name: "Maintenance", v: cur.maint, c: "#ef4444" }];
  const expTotal = cur.cost, hasExp = expTotal > 0;
  $("dtExpBody").hidden = !hasExp; $("dtExpEmpty").hidden = hasExp;
  if (state.dtExpChart) { state.dtExpChart.destroy(); state.dtExpChart = null; }
  if (hasExp) {
    $("dtExpCenter").innerHTML = `<b>${inr(expTotal)}</b><small>Total</small>`;
    $("dtExpLegend").innerHTML = exp.map(e => `<div class="dt-leg"><i style="background:${e.c}"></i><span>${e.name}</span><span>${Math.round(e.v / expTotal * 100)}%</span><b>${inr(e.v)}</b></div>`).join("");
    if (chartOk) state.dtExpChart = new Chart($("dtExpChart").getContext("2d"), {
      type: "doughnut",
      data: { labels: exp.map(e => e.name), datasets: [{ data: exp.map(e => e.v), backgroundColor: exp.map(e => e.c), borderWidth: 3, borderColor: "#fff" }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { display: false } } }
    });
  }

  /* recent activity (fuel, jobs, maintenance, payments) */
  const acts = [];
  state.fuel.forEach(r => acts.push({ d: r.date, color: "teal", icon: "fuel", t: "Fuel Refilled", s: `${num(+r.litres || 0, 1)} L · ${inr(+r.totalCost || 0)}` }));
  state.maintenance.forEach(m => acts.push({ d: m.date, color: "red", icon: "wrench", t: "Maintenance", s: m.description || "" }));
  state.jobs.forEach(j => acts.push({ d: j.date, color: "blue", icon: "field", t: "Field Work", s: `${toLatin(CALC.jobTitle(j))} · ${num(CALC.jobVigha(j), 1)} vigha${j.clientName ? " · " + j.clientName : ""}` }));
  state.payments.forEach(p => acts.push({ d: p.date, color: "green", icon: "card", t: "Payment Received", s: `${p.clientName || ""} · ${inr(+p.amount || 0)}` }));
  acts.sort((a, b) => (b.d || "").localeCompare(a.d || ""));
  $("dtActivity").innerHTML = acts.length ? acts.slice(0, 5).map(a => `
    <div class="dt-act-row"><div class="dt-act-ic c-${a.color}">${dtIcon(a.icon)}</div>
      <div class="dt-act-body"><b>${escapeHtml(a.t)}</b><small>${escapeHtml(a.s)}</small></div>
      <div class="dt-act-when">${escapeHtml(dtAgo(a.d))}</div></div>`).join("") : `<p class="empty">No activity yet.</p>`;

  /* recent fuel logs */
  const logs = state.fuel.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 4);
  $("dtLogsEmpty").hidden = logs.length > 0;
  $("dtFuelRows").innerHTML = logs.map(r => `<tr><td>${escapeHtml(fmtDate(r.date))}</td><td class="num">${num(+r.litres || 0, 1)} L</td><td class="num">${money(+r.pricePerLitre || 0)}</td><td class="num">${money(+r.totalCost || 0)}</td><td class="num">${num(+r.hourMeter || 0, 1)}</td></tr>`).join("");

  /* field work summary (by work type, meter hours) */
  $("dtWorkPeriod").textContent = label;
  const wm = new Map();
  fJobs.forEach(j => {
    const k = toLatin(CALC.jobTitle(j)), o = wm.get(k) || { h: 0, v: 0, n: 0 };
    o.h += +j.meterHours || +j.engineHours || 0; o.v += CALC.jobVigha(j); o.n++; wm.set(k, o);
  });
  const wrows = [...wm].sort((a, b) => b[1].h - a[1].h).slice(0, 5), maxH = Math.max(0, ...wrows.map(r => r[1].h));
  const wcol = ["#2563eb", "#14b8a6", "#f97316", "#8b5cf6", "#ec4899"];
  $("dtWork").innerHTML = wrows.length ? wrows.map(([k, o], i) => `
    <div class="dt-bar-row"><div class="dt-bar-top"><span>${escapeHtml(k)}</span><span>${num(o.h, 1)} hr · ${num(o.v, 1)} vigha</span></div>
      <div class="dt-bar"><i style="width:${maxH > 0 ? Math.max(3, o.h / maxH * 100) : 3}%;background:${wcol[i % wcol.length]}"></i></div></div>`).join("") : `<p class="empty">No jobs in this period.</p>`;

  renderDtTractor();
}

function dtRunSearch(q) {
  q = (q || "").trim().toLowerCase(); if (!q) return;
  const clients = state.clients.filter(c => [c.name, c.village, c.phone].some(v => String(v || "").toLowerCase().includes(q))).slice(0, 8);
  const jobs = state.jobs.filter(j => [j.clientName, j.workType, toLatin(j.workType), j.date, fmtDate(j.date)].some(v => String(v || "").toLowerCase().includes(q))).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 10);
  const row = (key, who, what, right) => `<div class="modal-row" data-open="${escapeHtml(key)}" style="cursor:pointer"><div><div class="who">${escapeHtml(who)}</div><div class="what">${escapeHtml(what)}</div></div><div class="money">${right}</div></div>`;
  let html = "";
  if (clients.length) html += `<div class="summary-section-title">Clients</div><div class="modal-list">${clients.map(c => row("client-detail-" + c.id, c.name || "—", c.village || c.phone || "", money(clientSummaryFor(c.id, c.name).pending))).join("")}</div>`;
  if (jobs.length) html += `<div class="summary-section-title" style="margin-top:12px">Jobs</div><div class="modal-list">${jobs.map(j => row("job-detail-" + j.id, j.clientName || "—", `${fmtDate(j.date)} · ${toLatin(CALC.jobTitle(j))}`, money(CALC.jobBillAmount(j)))).join("")}</div>`;
  if (!html) html = `<p class="empty">Nothing found for “${escapeHtml(q)}”.</p>`;
  state.statModalKey = null;
  $("statModalTitle").textContent = `Results for “${q}”`;
  $("statModalContent").innerHTML = html;
  $("statModalGoWrap").innerHTML = "";
  $("statModalContent").querySelectorAll("[data-open]").forEach(el => el.addEventListener("click", () => openStatModal(el.dataset.open)));
  $("statModal").hidden = false;
}

function initDesktop() {
  const dt = $("dtDate");
  if (dt) {
    const d = new Date();
    dt.innerHTML = `<b>${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}</b>${d.toLocaleString("en-US", { weekday: "long" })}`;
  }
  $("dtSearchForm").addEventListener("submit", (e) => { e.preventDefault(); dtRunSearch($("dtSearch").value); });
  $("dtKpis").addEventListener("click", (e) => { const t = e.target.closest("[data-stat]"); if (t) openStatModal(t.dataset.stat); });
  $("dtKpis").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target.closest("[data-stat]"); if (t) { e.preventDefault(); openStatModal(t.dataset.stat); }
  });
  $("dtDash").addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]"); if (!g) return;
    showPage(g.dataset.goto);
    if (g.dataset.scroll) setTimeout(() => { const t = $(g.dataset.scroll); if (t) t.scrollIntoView({ behavior: "smooth", block: "center" }); }, 150);
  });
  const onMq = () => { renderDtSide(); const p = document.querySelector(".page[data-page='dash']"); if (p && !p.hidden) renderDashboard(); };
  if (DT_MQ.addEventListener) DT_MQ.addEventListener("change", onMq); else if (DT_MQ.addListener) DT_MQ.addListener(onMq);
  renderDtSide();
}

async function removeRecord(colName, id, label) {
  if (!state.user) return; if (!confirm(`Delete this ${label}?`)) return;
  try { await deleteRecord(state.user.uid, colName, id); announce(`${label} deleted.`); }
  catch (e) { console.error("delete failed:", e.code); announce("Delete failed."); }
}

function download(filename, content, type) {
  const blob = new Blob([content], { type }), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function inRange(dateStr, from, to) { if (!dateStr) return false; if (from && dateStr < from) return false; if (to && dateStr > to) return false; return true; }

function filteredData() {
  const from = $("expFrom").value || "", to = $("expTo").value || "";
  return { from, to, fuel: state.fuel.filter(r => inRange(r.date, from, to)), jobs: state.jobs.filter(j => inRange(j.date, from, to)), maint: state.maintenance.filter(m => inRange(m.date, from, to)) };
}

function clientSummariesForJobs(jobs) {
  const groups = new Map();
  jobs.forEach(j => { const key = j.clientId || `name:${j.clientName || ""}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(j); });
  const out = [];
  for (const [, list] of groups) {
    const first = list[0], clientDoc = state.clients.find(c => c.id === first.clientId) || null;
    const billed = list.reduce((s, j) => s + CALC.jobBillAmount(j), 0), pending = list.reduce((s, j) => s + CALC.jobPending(j), 0), recv = list.reduce((s, j) => s + (+j.amountReceived || 0), 0);
    out.push({
      client: { id: first.clientId || "", name: (clientDoc && clientDoc.name) || first.clientName || "", village: (clientDoc && clientDoc.village) || "", phone: (clientDoc && clientDoc.phone) || "" },
      totals: { jobs: list.length, vigha: list.reduce((s, j) => s + CALC.jobVigha(j), 0), meterHours: list.reduce((s, j) => s + (+j.meterHours || +j.engineHours || 0), 0), actualHours: list.reduce((s, j) => s + (+j.actualHours || 0), 0), billed, received: recv, pending },
      jobs: list.slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    });
  }
  return out.sort((a, b) => (a.client.name || "").localeCompare(b.client.name || ""));
}

function exportJSON() {
  const { from, to, fuel, jobs, maint } = filteredData(), clientsSummary = clientSummariesForJobs(jobs);
  download(`zm-tractor-${Date.now()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), range: { from: from || null, to: to || null }, tractor: state.tractor || null, allClients: state.clients, fuel, jobs, maintenance: maint, clientsSummary }, null, 2), "application/json");
}

function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function csvRow(arr) { return arr.map(csvCell).join(","); }

function exportCSV() {
  const { from, to, fuel, jobs, maint } = filteredData(), clientsSummary = clientSummariesForJobs(jobs);
  const lines = [];
  lines.push(csvRow(["# range", from || "all", to || "all"]));
  lines.push(csvRow(["type","date","litres","pricePerLitre","totalCost","meterReading","isFullTank","notes"]));
  fuel.forEach(r => lines.push(csvRow(["fuel", r.date||"", r.litres||0, r.pricePerLitre||0, r.totalCost||0, r.hourMeter||0, r.isFullTank?"yes":"no", r.notes||""])));
  lines.push("");
  lines.push(csvRow(["type","date","clientName","workType","vigha","startMeter","endMeter","startTime","endTime","meterHours","actualHours","priceMode","ratePerHour","ratePerVigha","fixedAmount","amountReceived","jobCost","paymentStatus","paymentDate"]));
  jobs.forEach(j => lines.push(csvRow(["job", j.date||"", j.clientName||"", toLatin(CALC.jobTitle(j)), CALC.jobVigha(j), j.startHourMeter||0, j.endHourMeter||0, j.startTime||"", j.endTime||"", j.meterHours || j.engineHours || 0, j.actualHours || 0, j.priceMode||"hour", j.ratePerHour||0, j.ratePerVigha||0, j.fixedAmount||0, j.amountReceived||0, CALC.jobBillAmount(j), j.paymentStatus||"pending", j.paymentDate||""])));
  lines.push("");
  lines.push(csvRow(["type","date","description","parts","cost","meterReading","notes"]));
  maint.forEach(m => lines.push(csvRow(["maintenance", m.date||"", m.description||"", m.parts||"", m.cost||0, m.meterReading||0, m.notes||""])));
  lines.push("");
  lines.push(csvRow(["type","clientName","village","phone","jobs","vigha","meterHours","actualHours","billed","received","pending"]));
  clientsSummary.forEach(c => lines.push(csvRow(["client_summary", c.client.name, c.client.village, c.client.phone, c.totals.jobs, c.totals.vigha.toFixed(2), c.totals.meterHours.toFixed(2), c.totals.actualHours.toFixed(2), c.totals.billed.toFixed(2), c.totals.received.toFixed(2), c.totals.pending.toFixed(2)])));
  lines.push("");
  lines.push(csvRow(["type","clientName","date","workType","vigha","meterHours","actualHours","jobCost","paymentStatus"]));
  clientsSummary.forEach(c => c.jobs.forEach(j => lines.push(csvRow(["client_job", c.client.name, j.date||"", toLatin(CALC.jobTitle(j)), CALC.jobVigha(j), j.meterHours || j.engineHours || 0, j.actualHours||0, CALC.jobBillAmount(j).toFixed(2), j.paymentStatus||"pending"]))));
  download(`zm-tractor-${Date.now()}.csv`, lines.join("\n"), "text/csv");
}

/* ================= CLIENT TOOLS, TIMER, EXCEL ================= */
function clientHistoryHtml(cId) {
  const pays = state.payments.filter(p => p.clientId === cId).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return `<div class="summary-section-title" style="margin-top:14px">Payment history</div>` + (pays.length
    ? `<div class="modal-list">${pays.slice(0, 3).map(p => `<div class="modal-row"><div><div class="who">${escapeHtml(fmtDate(p.date))}</div><div class="what">${escapeHtml(p.method || "Cash")}</div></div><div class="money success">${money(+p.amount || 0)}</div></div>`).join("")}</div>${pays.length > 3 ? `<p class="empty">+${pays.length - 3} earlier payments</p>` : ""}`
    : `<p class="empty">No payments recorded yet.</p>`);
}

function whatsappBalance(cId) {
  const c = state.clients.find(x => x.id === cId);
  const jobs = state.jobs.filter(j => j.clientId === cId && CALC.jobPending(j) > 0).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (!jobs.length) return alert("This client has no pending balance.");
  let ph = String(c?.phone || "").replace(/\D/g, "");
  if (ph.length === 10) ph = "91" + ph;
  if (!ph) return alert("Add a phone number for this client first.");
  const total = jobs.reduce((s, j) => s + CALC.jobPending(j), 0);
  const lines = jobs.map(j => `${fmtDate(j.date)} ${CALC.jobTitle(j)}: ₹${money(CALC.jobPending(j))}`).join("\n");
  const msg = `Namaste ${c.name}, your pending balance is ₹${money(total)}:\n${lines}\nThank you.`;
  window.open(`https://wa.me/${ph}?text=${encodeURIComponent(msg)}`, "_blank");
}

function exportClientStatement(cId) {
  const keep = { a: state.dashAllTime, c: state.summaryClientIds, w: state.summaryWorkTypes };
  state.dashAllTime = true; state.summaryClientIds = new Set([cId]); state.summaryWorkTypes = new Set();
  try { exportSummaryPDF(); } finally { state.dashAllTime = keep.a; state.summaryClientIds = keep.c; state.summaryWorkTypes = keep.w; }
}

function duplicateJob(id) {
  showPage("jobs"); startEditJob(id);
  state.editingJobId = null;
  const last = state.jobs.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  $("jDate").value = todayISO(); $("jAmountReceived").value = 0;
  $("jStartTime").value = ""; $("jEndTime").value = ""; $("jEnd").value = "";
  $("jStart").value = last ? (last.endHourMeter ?? "") : "";
  $$("#jPaySeg .seg-btn").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.val === "pending")));
  $("jobFormTitle").textContent = "Add job (copy)"; $("jobSubmit").textContent = "Save job";
  $("jobEditBanner").hidden = true; $("jobCancelEdit").hidden = true;
  updateMeterStartHint();
}

function jobFuelShare(j) {
  const hrs = state.jobs.reduce((s, x) => s + (+x.meterHours || +x.engineHours || 0), 0);
  const fuel = state.fuel.reduce((s, r) => s + (+r.totalCost || 0), 0);
  return hrs > 0 ? fuel * ((+j.meterHours || +j.engineHours || 0) / hrs) : 0;
}

function initTimer() {
  const K = "zr.timer";
  const hhmm = () => { const d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  try { const t = JSON.parse(localStorage.getItem(K) || "null"); if (t && t.date === todayISO() && !$("jStartTime").value) $("jStartTime").value = t.time; } catch (_) {}
  $("jStartNow").addEventListener("click", () => { $("jStartTime").value = hhmm(); try { localStorage.setItem(K, JSON.stringify({ date: todayISO(), time: $("jStartTime").value })); } catch (_) {} });
  $("jStopNow").addEventListener("click", () => { $("jEndTime").value = hhmm(); try { localStorage.removeItem(K); } catch (_) {} });
}

function exportXLSX() {
  if (!window.XLSX) return alert("Excel library not loaded. Please refresh.");
  const { from, to, fuel, jobs, maint } = filteredData();
  const wb = XLSX.utils.book_new();
  const FMT = { d: "dd-mmm-yyyy", m: "#,##0.00", n: "0.00", i: "0" };
  const dt = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : (s || ""); };
  const byDate = (a, b) => (a.date || "").localeCompare(b.date || "");
  // cols: [header, width, kind]  kind: d date, m money, n 2-decimals, i integer, t text. totals: column indexes to SUM.
  const sheet = (name, cols, rows, totals = []) => {
    const ws = XLSX.utils.aoa_to_sheet([cols.map(c => c[0]), ...rows], { cellDates: true });
    const last = rows.length + 1, endCol = XLSX.utils.encode_col(cols.length - 1);
    cols.forEach((c, ci) => { const L = XLSX.utils.encode_col(ci); for (let r = 2; r <= last; r++) { const cell = ws[L + r]; if (cell && FMT[c[2]]) cell.z = FMT[c[2]]; } });
    if (totals.length && rows.length) {
      const tr = last + 1; ws["A" + tr] = { t: "s", v: "Total" };
      totals.forEach(ci => { const L = XLSX.utils.encode_col(ci); ws[L + tr] = { t: "n", f: `SUM(${L}2:${L}${last})`, v: rows.reduce((s, r) => s + (+r[ci] || 0), 0), z: FMT[cols[ci][2]] }; });
      ws["!ref"] = `A1:${endCol}${tr}`;
    }
    ws["!cols"] = cols.map(c => ({ wch: c[1] }));
    if (rows.length) ws["!autofilter"] = { ref: `A1:${endCol}${last}` };
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  // Summary (first sheet), with live formulas for pending and profit
  const billed = jobs.reduce((s, j) => s + CALC.jobBillAmount(j), 0), pend = jobs.reduce((s, j) => s + CALC.jobPending(j), 0);
  const recv = billed - pend, diesel = fuel.reduce((s, r) => s + (+r.totalCost || 0), 0), mcost = maint.reduce((s, m) => s + (+m.cost || 0), 0);
  const sum = XLSX.utils.aoa_to_sheet([
    ["ZM Tractor — export"], ["Period", `${from ? fmtDate(from) : "All time"} to ${to ? fmtDate(to) : "today"}`], [],
    ["Measure", "Value"], ["Total billed", billed], ["Received", recv], ["Pending", pend], ["Diesel", diesel], ["Maintenance", mcost], ["Net profit", billed - diesel - mcost],
    ["Jobs", jobs.length], ["Vigha", jobs.reduce((s, j) => s + CALC.jobVigha(j), 0)], ["Meter hours", jobs.reduce((s, j) => s + (+j.meterHours || +j.engineHours || 0), 0)]
  ]);
  sum.B7 = { t: "n", f: "B5-B6", v: pend }; sum.B10 = { t: "n", f: "B5-B8-B9", v: billed - diesel - mcost };
  for (let r = 5; r <= 10; r++) sum["B" + r].z = FMT.m;
  sum.B12.z = FMT.n; sum.B13.z = FMT.n;
  sum["!cols"] = [{ wch: 18 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, sum, "Summary");

  sheet("Jobs", [["Date", 12, "d"], ["Client", 22, "t"], ["Work", 14, "t"], ["Work (English)", 14, "t"], ["Vigha", 9, "n"], ["Meter start", 11, "n"], ["Meter end", 11, "n"], ["Meter hours", 11, "n"], ["Actual hours", 12, "n"], ["Pricing", 11, "t"], ["Billed", 13, "m"], ["Received", 13, "m"], ["Pending", 13, "m"], ["Status", 10, "t"]],
    jobs.slice().sort(byDate).map(j => { const p = CALC.jobPending(j); return [dt(j.date), j.clientName || "", CALC.jobTitle(j), toLatin(CALC.jobTitle(j)), CALC.jobVigha(j), +j.startHourMeter || 0, +j.endHourMeter || 0, +j.meterHours || +j.engineHours || 0, +j.actualHours || 0, ({ hour: "Per hour", vigha: "Per vigha", fixed: "Fixed" })[j.priceMode || "hour"], CALC.jobBillAmount(j), +j.amountReceived || 0, p, p > 0 ? "Pending" : "Paid"]; }),
    [4, 7, 8, 10, 11, 12]);
  sheet("Payments", [["Date", 12, "d"], ["Client", 22, "t"], ["Method", 11, "t"], ["Amount", 13, "m"]],
    state.payments.filter(p => inRange(p.date, from, to)).sort(byDate).map(p => [dt(p.date), p.clientName || "", p.method || "Cash", +p.amount || 0]), [3]);
  sheet("Fuel", [["Date", 12, "d"], ["Litres", 10, "n"], ["Price per litre", 14, "m"], ["Cost", 13, "m"], ["Meter", 10, "n"], ["Full tank", 10, "t"], ["Notes", 24, "t"]],
    fuel.slice().sort(byDate).map(r => [dt(r.date), +r.litres || 0, +r.pricePerLitre || 0, +r.totalCost || 0, +r.hourMeter || 0, r.isFullTank ? "Yes" : "No", r.notes || ""]), [1, 3]);
  const iv = CALC.intervals(fuel);
  sheet("Consumption", [["From meter", 11, "n"], ["To meter", 11, "n"], ["Hours", 9, "n"], ["Litres", 9, "n"], ["Litres per hour", 15, "n"], ["Cost per hour", 14, "m"]],
    iv.map(x => [x.fromHour, x.toHour, x.hours, x.litres, x.lPerHour == null ? "" : x.lPerHour, x.costPerHour == null ? "" : x.costPerHour]));
  sheet("Maintenance", [["Date", 12, "d"], ["Description", 28, "t"], ["Parts", 24, "t"], ["Cost", 13, "m"], ["Meter", 10, "n"], ["Notes", 24, "t"]],
    maint.slice().sort(byDate).map(m => [dt(m.date), m.description || "", m.parts || "", +m.cost || 0, +m.meterReading || 0, m.notes || ""]), [3]);
  sheet("Clients", [["Client", 22, "t"], ["Village", 16, "t"], ["Phone", 14, "t"], ["Jobs", 7, "i"], ["Vigha", 9, "n"], ["Billed", 13, "m"], ["Received", 13, "m"], ["Pending", 13, "m"]],
    clientSummariesForJobs(jobs).map(c => [c.client.name, c.client.village, String(c.client.phone || ""), c.totals.jobs, c.totals.vigha, c.totals.billed, c.totals.received, c.totals.pending]), [3, 4, 5, 6, 7]);
  XLSX.writeFile(wb, `zm-tractor-${todayISO()}.xlsx`, { cellDates: true });
}

function gujText(doc, text, x, y, o = {}) {
  const { align = "left", size = 10, style = "normal", color = [40, 40, 40] } = o, S = 4;
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  const font = `${style === "bold" ? "700" : "500"} ${size * S}px "Hind Vadodara","Noto Sans Gujarati","Nirmala UI","Shruti",sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 4, h = Math.ceil(size * S * 1.7);
  c.width = w; c.height = h; ctx.font = font; ctx.fillStyle = `rgb(${color.join(",")})`;
  ctx.fillText(text, 2, size * S * 1.25);
  const pw = w / S, ph = h / S, px = align === "right" ? x - pw : align === "center" ? x - pw / 2 : x;
  doc.addImage(c.toDataURL("image/png"), "PNG", px, y - size * 1.25, pw, ph);
}

let PDF_LOGO = null;
function loadPdfLogo() {
  const img = new Image();
  img.onload = () => {
    try {
      const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
      const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
      PDF_LOGO = { data: c.toDataURL("image/png"), w, h };
    } catch (_) {}
  };
  img.src = "./ZM_tractor.png";
}

const DEV_MODE = ["localhost", "127.0.0.1"].includes(location.hostname);
const INSTALL_KEY = "zr.installDismissed";

function initPWA() {
  if ("serviceWorker" in navigator && !DEV_MODE) {
    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
        reg.update();
        let reloaded = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloaded) return; reloaded = true; window.location.reload(); });
      } catch (e) { console.warn("SW registration failed:", e.message); }
    });
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    state.deferredPrompt = e;
    const isMobile = matchMedia("(max-width: 700px)").matches;
    if (isMobile && localStorage.getItem(INSTALL_KEY) !== "1") $("installBanner").hidden = false;
  });
  $("installYes").addEventListener("click", async () => {
    $("installBanner").hidden = true; if (!state.deferredPrompt) return;
    state.deferredPrompt.prompt(); await state.deferredPrompt.userChoice; state.deferredPrompt = null;
  });
  $("installNo").addEventListener("click", () => { $("installBanner").hidden = true; localStorage.setItem(INSTALL_KEY, "1"); });
}

function boot() {
  initTabs();
  initForms();
  initSummary();
  initStatModal();
  initAuth();
  initPWA();
  $("fDate").value = todayISO();
  $("jDate").value = todayISO();
  $("mDate").value = todayISO();
  $("jRateHour").value = 0;
  $("jRateVigha").value = 0;
  $("jFixed").value = 0;
  $("jAmountReceived").value = 0;
  $("jPriceMode").value = "hour";
  populateDashPeriods();
  applyPriceModeVisibility();
  initTimer();
  loadPdfLogo();
  initDesktop();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}