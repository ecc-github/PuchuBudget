// ======= CONFIG & STATE =======
const el = id => document.getElementById(id);
const API_URL = "https://script.google.com/macros/s/AKfycbwlvPAHEA0RX9ymn2tCmxgL7MoNxTHr8jvfBY3qbU07927ULEJR95ldf06G3c6l2CE/exec";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
let deletePendingIndex = null, budgets = [], transactions = [], activeTransactionId = null, currentAccount = "Joint", activeAccountFilters = ["All"], activeCategoryFilters = ["All"], editAccount = "Joint";

const CATEGORY_STYLES = { "Groceries": "bg-emerald-50 text-emerald-700", "Dining out": "bg-rose-50 text-rose-700", "Personal spending": "bg-indigo-50 text-indigo-700", "Housing": "bg-amber-50 text-amber-700", "Transportation": "bg-sky-50 text-sky-700", "Subscriptions": "bg-fuchsia-50 text-fuchsia-700", "Utilities": "bg-cyan-50 text-cyan-700", "Savings": "bg-lime-50 text-lime-700", "Health": "bg-teal-50 text-teal-700", "Miscellaneous": "bg-slate-100 text-slate-700", "Uncategorized": "bg-slate-100 text-slate-700" };
const CATEGORY_COLOR_HEX = { "Groceries": "#22c55e", "Dining out": "#f97373", "Personal spending": "#6366f1", "Housing": "#f59e0b", "Transportation": "#0ea5e9", "Subscriptions": "#e879f9", "Utilities": "#06b6d4", "Savings": "#65a30d", "Health": "#14b8a6", "Miscellaneous": "#64748b", "Uncategorized": "#94a3b8" };

// ======= SANKEY: AUTO-FIT + NO-REDRAW RESIZE =======
let _sankeyRO = null, _sankeyInitialized = false, _sankeyLastSig = "";

const forceFullSankeyRerender = () => {
  const s = el("reportSankey"), d = el("reportDetails");
  _sankeyInitialized = false; _sankeyLastSig = "";
  if (s) {
    s._hasSankeyClick = false;
    try { s.removeAllListeners?.("plotly_click"); window.Plotly?.purge?.(s); } catch (_) {}
    s.innerHTML = "";
  }
  if (d) d.innerHTML = "";
};

const ensureSankeyAutoFit = () => {
  const s = el("reportSankey");
  if (!s || _sankeyRO) return;
  Object.assign(s.style, { width: "100%", height: "100%" });
  _sankeyRO = new ResizeObserver(() => window.Plotly?.Plots?.resize?.(s));
  _sankeyRO.observe(s);
};

// ======= API HELPERS =======
const loadStateFromSheet = async () => {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error("Failed to load data");
  const data = await res.json();
  budgets = data.budgets || [];
  transactions = (data.transactions || []).map(t => ({ ...t, account: t.account || "Joint" }));
};

const saveStateToSheet = async () => {
  try { await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ budgets, transactions }) }); }
  catch (err) { console.error("Save failed:", err); }
};

window.reloadStateFromSheet = async () => { await loadStateFromSheet(); refreshUI(); };

// ======= UTILS: Date & Currency =======
const formatCurrency = n => (isNaN(n) || n === null) ? "$0.00" : "$" + Number(n).toFixed(2);
const parseMMDDYYYY = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || "").trim()); return m ? new Date(m[3], m[1] - 1, m[2]) : null; };
const sortTransactions = () => transactions.sort((a, b) => (parseMMDDYYYY(normalizeDateForSheetJS(b.date))?.getTime() || 0) - (parseMMDDYYYY(normalizeDateForSheetJS(a.date))?.getTime() || 0));

const normalizeDateForSheetJS = d => {
  if (!d) return "";
  if (d instanceof Date) return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  const s = String(d).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3/$1") : s;
};

const formatDateForDisplay = v => normalizeDateForSheetJS(v);

// ======= UTILS: Budget Parsing =======
const parseMonthInputValue = v => {
  if (!v) return { monthName: "", year: null };
  const s = String(v).trim(), mL = /^\d{4}-\d{1,2}$/.exec(s), mF = /^([A-Za-z]+)\s+'?(\d{2,4})$/.exec(s);
  if (mL) return { monthName: MONTH_NAMES[mL[0].split("-")[1] - 1], year: Number(mL[0].split("-")[0]) };
  if (mF) { const y = Number(mF[2]); return { monthName: mF[1][0].toUpperCase() + mF[1].slice(1).toLowerCase(), year: y < 100 ? y + 2000 : y }; }
  const dt = new Date(s); return dt.getTime() ? { monthName: MONTH_NAMES[dt.getMonth()], year: dt.getFullYear() } : { monthName: "", year: null };
};

const getBudgetEntryForMonthInput = v => { const { monthName: m, year: y } = parseMonthInputValue(v); return budgets.find(b => b.month?.toLowerCase() === m?.toLowerCase() && Number(b.year) === y) || null; };

const upsertBudgetForMonthInput = (v, amt) => {
  const { monthName: m, year: y } = parseMonthInputValue(v);
  if (!m || !y) return;
  const idx = budgets.findIndex(b => b.month?.toLowerCase() === m.toLowerCase() && Number(b.year) === y), entry = { month: m, year: y, budget: Number(amt) || 0 };
  idx > -1 ? budgets[idx] = entry : budgets.push(entry);
};

// ======= RENDER & STATS =======
const getSelectedYearMonth = () => { const v = el("budgetMonthYear")?.value; return v?.includes("-") ? { year: Number(v.split("-")[0]), month: Number(v.split("-")[1]) } : null; };

const getVisibleTransactionsForCurrentMonth = () => {
  const ym = getSelectedYearMonth();
  return transactions.filter(t => {
    if (!t.date) return false;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(t.date).trim()), mon = m ? Number(m[1]) : new Date(t.date).getMonth() + 1, yr = m ? Number(m[3]) : new Date(t.date).getFullYear();
    return (!ym || (mon === ym.month && yr === ym.year)) && (activeAccountFilters.includes("All") || activeAccountFilters.includes(t.account || "Joint")) && (activeCategoryFilters.includes("All") || activeCategoryFilters.includes(t.category || "Uncategorized"));
  });
};

const updateHeaderStats = vis => {
  const ym = getSelectedYearMonth(), tot = vis.reduce((s, t) => s + (Number(t.amount) || 0), 0), entry = ym ? getBudgetEntryForMonthInput(`${ym.year}-${String(ym.month).padStart(2, "0")}`) : null, budg = Number(entry?.budget) || 0;
  let sec = "Available budget: —", state = "muted";
  
  if (ym && budg > 0) { const rem = budg - tot; sec = rem >= 0 ? `Available budget: ${formatCurrency(rem)}` : `Over budget by ${formatCurrency(Math.abs(rem))}`; state = rem >= 0 ? "good" : "bad"; }
  [el("monthHeaderPrimary"), el("tableHeaderPrimary")].forEach(e => e && (e.innerHTML = `<span>Total ${formatCurrency(tot)}</span><span class="ml-auto text-[11px] sm:text-xs font-normal text-slate-500">${vis.length} transaction${vis.length === 1 ? "" : "s"}</span>`));
  [el("monthHeaderSecondary"), el("tableHeaderSecondary")].forEach(e => { if (e) { e.textContent = sec; e.style.color = state === "good" ? "#0f9d5a" : (state === "bad" ? "#dc2626" : "#64748b"); e.style.fontWeight = state === "muted" ? "400" : "700"; } });
};

const renderTransactions = () => {
  const tbody = el("transactionsTableBody"); if (!tbody) return;
  const vis = getVisibleTransactionsForCurrentMonth(); tbody.innerHTML = "";
  
  vis.forEach(t => {
    const acct = t.account || "Joint", cat = (t.category || "Uncategorized").trim(), dot = acct === "Ayush" ? "bg-sky-500" : (acct === "Nupur" ? "bg-rose-500" : "");
    const icon = t.recurring === "Yes" ? `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-3 h-3 text-slate-400"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>` : "";
    const tr = document.createElement("tr"); tr.className = "hover:bg-slate-50 cursor-pointer";
    tr.innerHTML = `<td class="px-2 sm:px-3 py-1.5 text-slate-800 whitespace-nowrap"><div class="flex items-center gap-1.5">${dot ? `<span class="inline-block w-1.5 h-1.5 rounded-full ${dot}"></span>` : ""}<span>${formatDateForDisplay(t.date)}</span></div></td><td class="px-2 sm:px-3 py-1.5 text-slate-800">${t.desc || ""}</td><td class="px-2 sm:px-3 py-1.5"><span class="category-pill rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_STYLES[cat] || CATEGORY_STYLES["Miscellaneous"]}">${cat.length > 16 ? cat.slice(0, 15) + "…" : cat}</span></td><td class="px-2 sm:px-3 py-1.5 text-right"><div class="flex items-center justify-end gap-1.5">${icon}<span class="text-slate-800 whitespace-nowrap font-medium">${formatCurrency(t.amount || 0)}</span></div></td>`;
    
    tr.onclick = () => {
      deletePendingIndex = transactions.indexOf(t); const norm = normalizeDateForSheetJS(t.date); if (!norm) return;
      const [m, d, y] = norm.split("/");
      Object.assign(el("editDate"), { value: `${y}-${m}-${d}` }); el("editDesc").value = t.desc || ""; el("editAmt").value = t.amount || 0; el("editCat").value = t.category || "Uncategorized"; el("editRecurring").checked = t.recurring === "Yes";
      editAccount = t.account || "Joint"; window.applyEditAccountStyles?.();
      el("deleteOverlay").classList.replace("hidden", "show");
    };
    tbody.appendChild(tr);
  });
  
  if (el("transactionCountLabel")) el("transactionCountLabel").textContent = `${vis.length} transaction${vis.length === 1 ? "" : "s"}`;
  updateHeaderStats(vis);
};

const refreshUI = () => { sortTransactions(); renderTransactions(); renderReportSankey(); };

const renderReportSankey = () => {
  const s = el("reportSankey"), d = el("reportDetails"); if (!s || !d) return;
  ensureSankeyAutoFit();
  const hex2Rgba = (h, a) => `rgba(${parseInt(h.slice(1,3),16)}, ${parseInt(h.slice(3,5),16)}, ${parseInt(h.slice(5,7),16)}, ${a})`, nCat = v => (v == null || v === "" ? "Uncategorized" : String(v)).trim();
  const ym = getSelectedYearMonth(), mTx = getVisibleTransactionsForCurrentMonth();
  
  if (!ym || !mTx.length) {
    d.innerHTML = `<p class="text-[11px] sm:text-xs text-slate-500">No transactions to show.</p>`;
    s.innerHTML = ym ? '<div class="text-xs p-4 text-slate-500">No transactions found for this month.</div>' : '<div class="text-xs p-4 text-slate-500">Select a month...</div>';
    _sankeyInitialized = false; _sankeyLastSig = ""; return;
  }
  
  let tot = 0; const cTots = mTx.reduce((acc, t) => { const c = nCat(t.category), a = Number(t.amount) || 0; acc[c] = (acc[c] || 0) + a; tot += a; return acc; }, {}), cats = Object.keys(cTots);
  const sig = JSON.stringify({ ym, n: mTx.length, total: Number(tot.toFixed(2)), cats: cats.map(c => [c, Number((cTots[c] || 0).toFixed(2))]) });
  
  if (_sankeyInitialized && sig === _sankeyLastSig) return requestAnimationFrame(() => window.Plotly?.Plots?.resize?.(s));
  
  _sankeyLastSig = sig; d.innerHTML = `<p class="text-[11px] sm:text-xs text-slate-500">Click a category node to see line items here.</p>`;
  const labels = [`Total<br>${formatCurrency(tot)}`, ...cats.map(c => `${c}<br>${formatCurrency(cTots[c])}`)], nCols = ["#c5c5c5ff", ...cats.map(c => CATEGORY_COLOR_HEX[c] || "#e5e7eb")], lCols = cats.map(c => hex2Rgba(CATEGORY_COLOR_HEX[c] || "#64748b", 0.25)), vals = cats.map(c => Math.max(Math.abs(cTots[c]), tot * 0.04));
  
  Plotly.react(s, [{ type: "sankey", orientation: "h", node: { pad: 15, thickness: 15, line: { color: "#fff", width: 1 }, label: labels, color: nCols, hovertemplate: "%{label}<extra></extra>" }, link: { source: cats.map(() => 0), target: cats.map((_, i) => i + 1), value: vals, color: lCols } }], { margin: { t: 5, l: 5, r: 5, b: 5 }, font: { size: 10 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", autosize: true }, { displayModeBar: false, responsive: true });
  _sankeyInitialized = true;
  
  try { s.removeAllListeners?.("plotly_click"); } catch (_) {}
  s.on("plotly_click", ev => {
    const pt = ev?.points?.[0]; if (!pt) return;
    const catName = nCat((pt.target?.label || pt.label || labels[pt.pointNumber] || "").split("<br>")[0]); if (!catName || catName === "Total") return;
    const cTx = mTx.filter(t => nCat(t.category) === catName).sort((a, b) => Math.abs(Number(b.amount) || 0) - Math.abs(Number(a.amount) || 0));
    d.innerHTML = `<div class="flex items-center justify-between mb-2"><p class="text-xs font-semibold">${catName} — ${formatCurrency(cTx.reduce((s, t) => s + (Number(t.amount) || 0), 0))}</p><p class="text-[11px] text-slate-500">${cTx.length} items</p></div><div class="overflow-hidden border rounded-lg bg-white shadow-sm"><table class="min-w-full text-[11px] sm:text-xs"><thead class="bg-slate-50 sticky top-0"><tr><th class="px-2 py-1 text-left text-slate-500">Date</th><th class="px-2 py-1 text-left text-slate-500">Desc</th><th class="px-2 py-1 text-right text-slate-500">Amt</th></tr></thead><tbody class="divide-y divide-slate-100">${cTx.map(t => `<tr><td class="px-2 py-1 text-slate-600">${formatDateForDisplay(t.date)}</td><td class="px-2 py-1 text-slate-800">${t.desc || ""}</td><td class="px-2 py-1 text-right font-medium">${formatCurrency(t.amount)}</td></tr>`).join("")}</tbody></table></div>`;
  });
  requestAnimationFrame(() => Plotly.Plots.resize(s));
};

// ======= CONTROLS & HANDLERS =======
const initBudgetControls = () => {
  const mIn = el("budgetMonthYear"), bIn = el("budgetAmount"); if (!mIn || !bIn) return;
  if (!mIn.value) { const d = new Date(); mIn.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
  
  const sync = () => { bIn.value = getBudgetEntryForMonthInput(mIn.value)?.budget ?? ""; };
  const save = () => { if (mIn.value) { upsertBudgetForMonthInput(mIn.value, Number(bIn.value) || 0); saveStateToSheet(); refreshUI(); } };
  const onMC = async () => { sync(); forceFullSankeyRerender(); requestAnimationFrame(() => { renderTransactions(); renderReportSankey(); window.Plotly?.Plots?.resize(el("reportSankey")); }); };
  
  mIn.addEventListener("change", onMC);
  if (window.flatpickr && window.monthSelectPlugin) flatpickr(mIn, { altInput: true, plugins: [new monthSelectPlugin({ shorthand: false, dateFormat: "Y-m", altFormat: "F \\'y", theme: "light" })], defaultDate: mIn.value, onChange: async (d, s) => { mIn.value = s; await onMC(); } });
  
  sync(); refreshUI();
  ["change", "blur"].forEach(ev => bIn.addEventListener(ev, save)); bIn.onkeyup = e => e.key === "Enter" && save();
};

const setupEventHandlers = () => {
  const ov = el("deleteOverlay"), hideOv = () => { deletePendingIndex = null; ov.classList.remove("show"); setTimeout(() => ov.classList.add("hidden"), 150); };
  
  const syncRec = base => {
    if (base.recurring !== "Yes") return;
    transactions = transactions.filter(t => !((parseMMDDYYYY(t.date)?.getTime() || 0) > (parseMMDDYYYY(base.date)?.getTime() || 0) && t.groupId === base.groupId));
    let [m, d, y] = normalizeDateForSheetJS(base.date).split("/").map(Number), safety = 0, bnd = new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0);
    while (safety++ < 24) {
      if (++m > 12) { m = 1; y++; }
      const ld = new Date(y, m - 1, d); if (ld > bnd) break;
      transactions.unshift({ ...base, id: Date.now() + safety, date: normalizeDateForSheetJS(ld) });
    }
  };

  el("deleteCancelBtn").onclick = hideOv;
  el("deleteConfirmBtn").onclick = () => { if (deletePendingIndex !== null) { transactions.splice(deletePendingIndex, 1); refreshUI(); saveStateToSheet(); } hideOv(); };

  el("addTransactionBtn").onclick = () => {
    const amt = parseFloat(el("trxAmount").value), dt = el("trxDate").value, cLab = el("categorySelected")?.textContent.trim();
    if (isNaN(amt) || !dt) return alert("Amount and Date are required.");
    const isRec = el("trxRecurring").checked, newTrx = { id: Date.now(), groupId: isRec ? Date.now() : null, date: dt.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3/$1"), desc: el("trxDesc").value.trim(), category: !cLab || cLab === "Select category" ? "Uncategorized" : cLab, amount: amt, account: currentAccount, recurring: isRec ? "Yes" : "No" };
    transactions.unshift(newTrx); if (isRec) syncRec(newTrx);
    el("trxAmount").value = el("trxDesc").value = ""; el("trxRecurring").checked = false; refreshUI(); saveStateToSheet();
  };

  window.applyEditAccountStyles = () => document.querySelectorAll("#editAccountToggle button").forEach(b => { const acct = b.dataset.editAccount; b.className = `px-3 py-1 rounded-full transition-colors ${acct === editAccount ? (ACCT_COLORS[acct] + " text-white") : "text-slate-500 opacity-60"}`; });
  document.querySelectorAll("#editAccountToggle button").forEach(b => b.onclick = () => { editAccount = b.dataset.editAccount; window.applyEditAccountStyles(); });
  window.applyEditAccountStyles();

  el("editSaveBtn").onclick = () => {
    if (deletePendingIndex === null) return;
    const [y, m, d] = el("editDate").value.split('-'), isR = el("editRecurring").checked, old = transactions[deletePendingIndex];
    const upd = { ...old, date: `${m}/${d}/${y}`, desc: el("editDesc").value.trim(), category: el("editCat").value, amount: parseFloat(el("editAmt").value) || 0, account: editAccount, recurring: isR ? "Yes" : "No", groupId: old.groupId || (isR ? Date.now() : null) };
    transactions[deletePendingIndex] = upd; if (isR) syncRec(upd);
    refreshUI(); saveStateToSheet(); hideOv();
  };
};

// ======= DROPDOWNS & FILTERS =======
const ACCT_COLORS = { Ayush: "bg-blue-500", Joint: "bg-emerald-600", Nupur: "bg-rose-500" };
const applyAccountToggleStyles = () => document.querySelectorAll("#accountToggle button[data-account]").forEach(b => { const a = b.dataset.account, isA = a === currentAccount; b.classList.remove(...Object.values(ACCT_COLORS), "text-white", "opacity-60"); isA ? b.classList.add(ACCT_COLORS[a], "text-white") : b.classList.add("opacity-60"); });
const setupAccountToggle = () => { document.querySelectorAll("#accountToggle button[data-account]").forEach(b => b.onclick = () => { currentAccount = b.dataset.account; applyAccountToggleStyles(); }); applyAccountToggleStyles(); };

const renderCategoryFilterUI = () => {
  const menu = el("categoryFilterMenu"); if (!menu) return;
  menu.innerHTML = `<label class="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer border-b border-slate-100 mb-1"><input type="checkbox" data-cat-filter-multi="All" ${activeCategoryFilters.includes("All") ? "checked" : ""}><span class="text-[10px] font-bold text-slate-700 uppercase tracking-tight">All Categories</span></label>` + Object.keys(CATEGORY_STYLES).map(cat => `<label class="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded cursor-pointer"><input type="checkbox" data-cat-filter-multi="${cat}" ${activeCategoryFilters.includes(cat) ? "checked" : ""}><span class="text-[11px] text-slate-600">${cat}</span></label>`).join("");
  menu.querySelectorAll("[data-cat-filter-multi]").forEach(chk => chk.onchange = () => { activeCategoryFilters = handleMultiFilter(chk, activeCategoryFilters, "data-cat-filter-multi"); refreshUI(); });
};

[["dateHeaderFilterBtn", "accountFilterMenu"], ["categoryHeaderFilterBtn", "categoryFilterMenu"]].forEach(([bId, mId]) => { const b = el(bId), m = el(mId); if (b && m) b.onclick = e => { e.stopPropagation(); document.querySelectorAll('.filter-menu').forEach(x => x !== m && x.classList.add("hidden")); m.classList.toggle("hidden"); }; });
document.addEventListener("click", e => document.querySelectorAll('.filter-menu').forEach(m => { if (!m.contains(e.target)) m.classList.add("hidden"); }));

const handleMultiFilter = (chk, arr, attr) => {
  const val = chk.getAttribute(attr), allBox = document.querySelector(`[${attr}='All']`);
  if (val === "All") { if (chk.checked) { document.querySelectorAll(`[${attr}]`).forEach(b => b !== chk && (b.checked = false)); return ["All"]; } return arr.length === 1 && arr[0] === "All" ? (chk.checked = true, ["All"]) : arr; }
  let nxt = [...new Set((chk.checked ? [...arr, val] : arr.filter(v => v !== val)).filter(v => v !== "All"))];
  if (!nxt.length) { allBox.checked = true; return ["All"]; }
  allBox.checked = false; return nxt;
};

document.querySelectorAll("[data-filter-multi]").forEach(chk => chk.onchange = () => {
  activeAccountFilters = handleMultiFilter(chk, activeAccountFilters, "data-filter-multi");
  const dot = el("dateHeaderFilterDot"), set = new Set(activeAccountFilters.filter(a => a !== "All" && a !== "Joint"));
  if (dot) { dot.style.opacity = set.size ? 1 : 0; if (set.size) dot.style.backgroundColor = set.has("Ayush") && set.has("Nupur") ? "#7c3aed" : (set.has("Ayush") ? "#2563eb" : "#dc2626"); }
  refreshUI();
});

// ======= AUTO-MAINTENANCE & INIT =======
const runRecurringMaintenance = () => {
  const bnd = new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0); let added = false;
  [...new Set(transactions.filter(t => t.recurring === "Yes" && t.groupId).map(t => t.groupId))].forEach(gid => {
    const grp = transactions.filter(t => t.groupId === gid); if (!grp.length) return;
    const lt = grp.reduce((p, c) => (parseMMDDYYYY(normalizeDateForSheetJS(c.date))?.getTime() || 0) > (parseMMDDYYYY(normalizeDateForSheetJS(p.date))?.getTime() || 0) ? c : p);
    let [m, d, y] = normalizeDateForSheetJS(lt.date).split("/").map(Number), safety = 0;
    while (safety++ < 24) { if (++m > 12) { m = 1; y++; } const ld = new Date(y, m - 1, d); if (ld > bnd) break; transactions.unshift({ ...lt, id: Date.now() + safety, date: normalizeDateForSheetJS(ld) }); added = true;