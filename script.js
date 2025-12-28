// ======= CONFIG & STATE =======
const API_URL = "https://script.google.com/macros/s/AKfycbwlvPAHEA0RX9ymn2tCmxgL7MoNxTHr8jvfBY3qbU07927ULEJR95ldf06G3c6l2CE/exec";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
let deletePendingIndex = null;
let budgets = [], transactions = [], activeTransactionId = null, currentAccount = "Joint", activeAccountFilters = ["All"], activeCategoryFilters = ["All"];
let editAccount = "Joint"; // Separate state for the modal
const CATEGORY_STYLES = {
  "Groceries": "bg-emerald-50 text-emerald-700", "Dining out": "bg-rose-50 text-rose-700", "Personal spending": "bg-indigo-50 text-indigo-700",
  "Housing": "bg-amber-50 text-amber-700", "Transportation": "bg-sky-50 text-sky-700", "Subscriptions": "bg-fuchsia-50 text-fuchsia-700",
  "Utilities": "bg-cyan-50 text-cyan-700", "Savings": "bg-lime-50 text-lime-700", "Health": "bg-teal-50 text-teal-700",
  "Miscellaneous": "bg-slate-100 text-slate-700", "Uncategorized": "bg-slate-100 text-slate-700"
};

const CATEGORY_COLOR_HEX = {
  "Groceries": "#22c55e", "Dining out": "#f97373", "Personal spending": "#6366f1", "Housing": "#f59e0b", "Transportation": "#0ea5e9",
  "Subscriptions": "#e879f9", "Utilities": "#06b6d4", "Savings": "#65a30d", "Health": "#14b8a6", "Miscellaneous": "#64748b", "Uncategorized": "#94a3b8"
};
// ======= SANKEY: AUTO-FIT + NO-REDRAW RESIZE =======
let _sankeyRO = null;
let _sankeyInitialized = false;
let _sankeyLastSig = "";


function forceFullSankeyRerender() {
  const sDiv = document.getElementById("reportSankey");
  const dDiv = document.getElementById("reportDetails");

  _sankeyInitialized = false;
  _sankeyLastSig = "";

  if (sDiv) {
    // IMPORTANT: purge kills Plotly listeners, so we must allow re-bind
    sDiv._hasSankeyClick = false;

    // If Plotly has already attached listeners, clear them too
    try { sDiv.removeAllListeners?.("plotly_click"); } catch (_) {}

    if (window.Plotly) {
      try { Plotly.purge(sDiv); } catch (_) {}
    }
    sDiv.innerHTML = "";
  }

  if (dDiv) dDiv.innerHTML = "";
}



function ensureSankeyAutoFit() {
  const sDiv = document.getElementById("reportSankey");
  if (!sDiv || _sankeyRO) return;

  // Ensure the container can actually have a height:
  sDiv.style.width = "100%";
  sDiv.style.height = "100%";

  _sankeyRO = new ResizeObserver(() => {
    if (window.Plotly && sDiv && sDiv.data) {
      // Resize without re-plotting
      Plotly.Plots.resize(sDiv);
    }
  });
  _sankeyRO.observe(sDiv);
}

// ======= API HELPERS =======
async function loadStateFromSheet() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error("Failed to load data");
  const data = await res.json();
  budgets = data.budgets || [];
  transactions = (data.transactions || []).map(t => ({ ...t, account: t.account || "Joint" }));
}

const saveStateToSheet = async () => {
  try { await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ budgets, transactions }) }); }
  catch (err) { console.error("Save failed:", err); }
};
// Make sheet reload callable from the tab script
window.reloadStateFromSheet = async function () {
  await loadStateFromSheet();
  refreshUI(); // refreshUI already sorts via sortTransactions()
};


// ======= UTILS: Date & Currency =======
const formatCurrency = n => (isNaN(n) || n === null) ? "$0.00" : "$" + Number(n).toFixed(2);
const sortTransactions = () => {
  transactions.sort((a, b) => {
    const da = parseMMDDYYYY(normalizeDateForSheetJS(a.date))?.getTime() || 0;
    const db = parseMMDDYYYY(normalizeDateForSheetJS(b.date))?.getTime() || 0;
    return db - da; // newest first
  });
};

const parseDateParts = (s) => {
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return null;
  return {
    mm: String(dt.getMonth() + 1).padStart(2, "0"),
    dd: String(dt.getDate()).padStart(2, "0"),
    yyyy: dt.getFullYear()
  };
};

// Replace your current normalizeDateForSheetJS with this:
function normalizeDateForSheetJS(dateInput) {
  if (!dateInput) return "";
  
  // If it's already a Date object, extract local parts
  if (dateInput instanceof Date) {
    const mm = String(dateInput.getMonth() + 1).padStart(2, "0");
    const dd = String(dateInput.getDate()).padStart(2, "0");
    const yyyy = dateInput.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }
  
  // If it's a string from HTML input (YYYY-MM-DD)
  const s = String(dateInput).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${m}/${d}/${y}`;
  }

  return s; // Return as-is if already MM/DD/YYYY
}

const formatDateForDisplay = v => normalizeDateForSheetJS(v);
const parseMMDDYYYY = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || "").trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
};

// ======= UTILS: Budget Parsing =======
function parseMonthInputValue(value) {
  if (!value) return { monthName: "", year: null };
  const s = String(value).trim(), mLegacy = /^\d{4}-\d{1,2}$/.exec(s), mFormat = /^([A-Za-z]+)\s+'?(\d{2,4})$/.exec(s);
  if (mLegacy) {
    const [y, m] = s.split("-");
    return { monthName: MONTH_NAMES[parseInt(m) - 1], year: Number(y) };
  }
  if (mFormat) {
    let y = Number(mFormat[2]);
    return { monthName: mFormat[1].charAt(0).toUpperCase() + mFormat[1].slice(1).toLowerCase(), year: y < 100 ? y + 2000 : y };
  }
  const dt = new Date(s);
  return dt.getTime() ? { monthName: MONTH_NAMES[dt.getMonth()], year: dt.getFullYear() } : { monthName: "", year: null };
}

const getBudgetEntryForMonthInput = (v) => {
  const { monthName: m, year: y } = parseMonthInputValue(v);
  return budgets.find(b => b.month?.toLowerCase() === m?.toLowerCase() && Number(b.year) === y) || null;
};

function upsertBudgetForMonthInput(value, amount) {
  const { monthName, year } = parseMonthInputValue(value);
  if (!monthName || !year) return;
  const idx = budgets.findIndex(b => b.month?.toLowerCase() === monthName.toLowerCase() && Number(b.year) === year);
  const entry = { month: monthName, year, budget: Number(amount) || 0 };
  idx > -1 ? budgets[idx] = entry : budgets.push(entry);
}

// ======= RENDER & STATS =======
function getSelectedYearMonth() {
  const v = document.getElementById("budgetMonthYear")?.value;
  if (!v || !v.includes("-")) return null;
  const [y, m] = v.split("-").map(Number);
  return { year: y, month: m };
}

function updateHeaderStats(visible) {
  const ym = getSelectedYearMonth(), totalSpent = visible.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const entry = ym ? getBudgetEntryForMonthInput(`${ym.year}-${String(ym.month).padStart(2, "0")}`) : null;
  const budget = Number(entry?.budget) || 0;
  
  let secText = "Available budget: —", state = "muted";
  if (ym && budget > 0) {
    const rem = budget - totalSpent;
    secText = rem >= 0 ? `Available budget: ${formatCurrency(rem)}` : `Over budget by ${formatCurrency(Math.abs(rem))}`;
    state = rem >= 0 ? "good" : "bad";
  }

  [document.getElementById("monthHeaderPrimary"), document.getElementById("tableHeaderPrimary")].forEach(el => {
    if (el) el.innerHTML = `<span>Total ${formatCurrency(totalSpent)}</span><span class="ml-auto text-[11px] sm:text-xs font-normal text-slate-500">${visible.length === 1 ? "1 transaction" : visible.length + " transactions"}</span>`;
  });

[document.getElementById("monthHeaderSecondary"), document.getElementById("tableHeaderSecondary")].forEach(el => {
    if (!el) return;
    el.textContent = secText;
    el.style.color = state === "good" ? "#0f9d5a" : (state === "bad" ? "#dc2626" : "#64748b");
    el.style.fontWeight = state === "muted" ? "400" : "700";
  });
}

function getVisibleTransactionsForCurrentMonth() {
  const ym = getSelectedYearMonth();
  return transactions.filter(t => {
    if (!t.date) return false;
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(t.date).trim());
    const m = match ? Number(match[1]) : new Date(t.date).getMonth() + 1;
    const y = match ? Number(match[3]) : new Date(t.date).getFullYear();
    const acct = t.account || "Joint", cat = t.category || "Uncategorized";
    const monthMatch = ym ? (m === ym.month && y === ym.year) : true;
    const acctMatch = activeAccountFilters.includes("All") || activeAccountFilters.includes(acct);
    const catMatch = activeCategoryFilters.includes("All") || activeCategoryFilters.includes(cat);
    return monthMatch && acctMatch && catMatch;
  });
}

function renderTransactions() {
  const tbody = document.getElementById("transactionsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const visible = getVisibleTransactionsForCurrentMonth();
  visible.forEach(t => {
    const tr = document.createElement("tr");
    const acct = t.account || "Joint";
    const rawCat = (t.category || "Uncategorized").trim();
    const dot = acct === "Ayush" ? "bg-sky-500" : (acct === "Nupur" ? "bg-rose-500" : "");

    // Modern "Repeat" SVG with stroke for a lighter, cleaner feel
    const isRec = t.recurring === "Yes";
    const recurringIcon = isRec ? `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-3 h-3 text-slate-400">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>` : "";

    tr.className = "hover:bg-slate-50 cursor-pointer";
    tr.innerHTML = `
      <td class="px-2 sm:px-3 py-1.5 text-slate-800 whitespace-nowrap">
        <div class="flex items-center gap-1.5">
          ${dot ? `<span class="inline-block w-1.5 h-1.5 rounded-full ${dot}"></span>` : ""}
          <span>${formatDateForDisplay(t.date)}</span>
        </div>
      </td>
      <td class="px-2 sm:px-3 py-1.5 text-slate-800">${t.desc || ""}</td>
      <td class="px-2 sm:px-3 py-1.5">
        <span class="category-pill rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_STYLES[rawCat] || CATEGORY_STYLES["Miscellaneous"]}">
          ${rawCat.length > 16 ? rawCat.slice(0, 15) + "…" : rawCat}
        </span>
      </td>
      <td class="px-2 sm:px-3 py-1.5 text-right">
        <div class="flex items-center justify-end gap-1.5">
          ${recurringIcon}
          <span class="text-slate-800 whitespace-nowrap font-medium">${formatCurrency(t.amount || 0)}</span>
        </div>
      </td>`;

tr.onclick = () => {
  deletePendingIndex = transactions.indexOf(t);
const norm = normalizeDateForSheetJS(t.date);
if (!norm) return;
const [m, d, y] = norm.split("/");

  // Set Field Values
  el("editDate").value = `${y}-${m}-${d}`;
  el("editDesc").value = t.desc || "";
  el("editAmt").value = t.amount || 0;
  el("editCat").value = t.category || "Uncategorized";
  el("editRecurring").checked = t.recurring === "Yes";
  editAccount = t.account || "Joint"; // Set internal state
  
  window.applyEditAccountStyles?.();
 // UI update for buttons
  el("deleteOverlay").classList.remove("hidden");
  el("deleteOverlay").classList.add("show");
};

    tbody.appendChild(tr);
  });

  const counter = document.getElementById("transactionCountLabel");
  if (counter) counter.textContent = `${visible.length} transaction${visible.length === 1 ? "" : "s"}`;
  updateHeaderStats(visible);
}
const el = id => document.getElementById(id);
const refreshUI = () => { 
  sortTransactions(); 
  renderTransactions(); 
  renderReportSankey(); 
};
function renderReportSankey() {
  const sDiv = el("reportSankey"), dDiv = el("reportDetails");
  if (!sDiv || !dDiv) return;

  ensureSankeyAutoFit();

  const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const normCat = v => (v == null || v === "" ? "Uncategorized" : String(v)).trim();
  
  // 1. Calculate Data & Signature FIRST (Don't touch the DOM yet)
  const ym = getSelectedYearMonth();
  const monthTx = getVisibleTransactionsForCurrentMonth();

  if (!ym || !monthTx.length) {
    // If no data, we DO want to reset everything
    dDiv.innerHTML = `<p class="text-[11px] sm:text-xs text-slate-500">No transactions to show.</p>`;
    sDiv.innerHTML = ym
      ? '<div class="text-xs p-4 text-slate-500">No transactions found for this month.</div>'
      : '<div class="text-xs p-4 text-slate-500">Select a month...</div>';
    _sankeyInitialized = false;
    _sankeyLastSig = "";
    return;
  }

  // Aggregate Data
  let totalSpent = 0;
  const catTotals = monthTx.reduce((acc, t) => {
    const c = normCat(t.category);
    const a = Number(t.amount) || 0;
    acc[c] = (acc[c] || 0) + a;
    totalSpent += a;
    return acc;
  }, {});

  const cats = Object.keys(catTotals);
  // Generate Signature
  const sig = JSON.stringify({
    ym,
    n: monthTx.length,
    total: Number(totalSpent.toFixed(2)),
    cats: cats.map(c => [c, Number((catTotals[c] || 0).toFixed(2))])
  });

  // 2. CHECK: If nothing changed, resize only. DO NOT wipe dDiv.
  if (_sankeyInitialized && sig === _sankeyLastSig) {
    requestAnimationFrame(() => window.Plotly?.Plots?.resize?.(sDiv));
    return; // <--- This exits before wiping your clicked list!
  }

  // 3. Data Changed: NOW we can reset the list and update the graph
  _sankeyLastSig = sig;
  dDiv.innerHTML = `<p class="text-[11px] sm:text-xs text-slate-500">Click a category node to see line items here.</p>`;

  const labels = [`Total<br>${formatCurrency(totalSpent)}`, ...cats.map(c => `${c}<br>${formatCurrency(catTotals[c])}`)];
  const nodeColors = ["#c5c5c5ff", ...cats.map(c => CATEGORY_COLOR_HEX[c] || "#e5e7eb")];
  const linkColors = cats.map(c => hexToRgba(CATEGORY_COLOR_HEX[c] || "#64748b", 0.25));

  const minV = totalSpent * 0.04;
  const vals = cats.map(c => Math.max(Math.abs(catTotals[c]), minV));

  const data = [{
    type: "sankey",
    orientation: "h",
    node: {
      pad: 15,
      thickness: 15,
      line: { color: "#fff", width: 1 },
      label: labels,
      color: nodeColors,
      hovertemplate: "%{label}<extra></extra>"
    },
    link: {
      source: cats.map(() => 0),
      target: cats.map((_, i) => i + 1),
      value: vals,
      color: linkColors
    }
  }];

  const layout = {
    margin: { t: 5, l: 5, r: 5, b: 5 },
    font: { size: 10 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    autosize: true
  };

  const config = { displayModeBar: false, responsive: true };

  Plotly.react(sDiv, data, layout, config);
  _sankeyInitialized = true;

// Always (re)bind after drawing — guarantees click works after purge/react
try { sDiv.removeAllListeners?.("plotly_click"); } catch (_) {}

sDiv.on("plotly_click", ev => {
  const pt = ev?.points?.[0];
  if (!pt) return;

  let clickedLabel = "";
  if (pt.target && pt.target.label) clickedLabel = pt.target.label;
  else if (pt.label) clickedLabel = pt.label;
  else clickedLabel = labels[pt.pointNumber] || "";

  const catName = normCat(clickedLabel.split("<br>")[0]);
  if (!catName || catName === "Total") return;

  const catTx = monthTx
    .filter(t => normCat(t.category) === catName)
    .sort((a, b) => Math.abs(Number(b.amount) || 0) - Math.abs(Number(a.amount) || 0));

  const sum = catTx.reduce((s, t) => s + (Number(t.amount) || 0), 0);

  dDiv.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <p class="text-xs font-semibold">${catName} — ${formatCurrency(sum)}</p>
      <p class="text-[11px] text-slate-500">${catTx.length} items</p>
    </div>
    <div class="overflow-hidden border rounded-lg bg-white shadow-sm">
      <table class="min-w-full text-[11px] sm:text-xs">
        <thead class="bg-slate-50 sticky top-0">
          <tr>
            <th class="px-2 py-1 text-left text-slate-500">Date</th>
            <th class="px-2 py-1 text-left text-slate-500">Desc</th>
            <th class="px-2 py-1 text-right text-slate-500">Amt</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${catTx.map(t => `
            <tr>
              <td class="px-2 py-1 text-slate-600">${formatDateForDisplay(t.date)}</td>
              <td class="px-2 py-1 text-slate-800">${t.desc || ""}</td>
              <td class="px-2 py-1 text-right font-medium">${formatCurrency(t.amount)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
});

  requestAnimationFrame(() => Plotly.Plots.resize(sDiv));
}
function initBudgetControls() {
  const mIn = el("budgetMonthYear"), bIn = el("budgetAmount");
  if (!mIn || !bIn) return;

  if (!mIn.value) {
    const d = new Date();
    mIn.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  const sync = () => {
    const e = getBudgetEntryForMonthInput(mIn.value);
    bIn.value = e?.budget ?? "";
  };

  const save = () => {
    if (!mIn.value) return;
    upsertBudgetForMonthInput(mIn.value, bIn.value ? Number(bIn.value) : 0);
    saveStateToSheet();
    refreshUI();
  };

  // Force Sankey rebuild whenever month changes (no fail)
  const onMonthCommit = async () => {
    // If you want Sankey to always reflect latest sheet data, uncomment:
    // await loadStateFromSheet();

    sync();
    forceFullSankeyRerender();

    // Ensure DOM value is committed before render
    requestAnimationFrame(() => {
      renderTransactions();
      renderReportSankey(); // will rebuild fully due to forced reset above
      if (window.Plotly) Plotly.Plots.resize(el("reportSankey"));
    });
  };

  // `change` is the key event for <input type="month"> (fires when selection commits)
  mIn.addEventListener("change", onMonthCommit);

  // If you use flatpickr monthSelectPlugin, keep its onChange but route to the same handler
  if (window.flatpickr && window.monthSelectPlugin) {
    flatpickr(mIn, {
      altInput: true,
      plugins: [new monthSelectPlugin({ shorthand: false, dateFormat: "Y-m", altFormat: "F \\'y", theme: "light" })],
      defaultDate: mIn.value,
      onChange: async (d, s) => { mIn.value = s; await onMonthCommit(); }
    });
  }

  sync();
  refreshUI();

  // Keep budget field saves as you had
  ["change", "blur"].forEach(ev => bIn.addEventListener(ev, save));
  bIn.onkeyup = e => e.key === "Enter" && save();
}

function setupEventHandlers() {
  const ov = el("deleteOverlay");
  const hideOv = () => { deletePendingIndex = null; ov.classList.remove("show"); setTimeout(() => ov.classList.add("hidden"), 150); };

  // ======= SMART RECURRING HELPER =======
  const syncRecurringGroup = (baseTrx) => {
    if (baseTrx.recurring !== "Yes") return;

    // 1. Remove any existing FUTURE instances of this specific recurring group
    // This prevents the "double entry" bug
    transactions = transactions.filter(t => {
      const isFuture = (parseMMDDYYYY(t.date)?.getTime() || 0) > (parseMMDDYYYY(baseTrx.date)?.getTime() || 0)

      const isSameGroup = t.groupId && t.groupId === baseTrx.groupId;
      return !(isFuture && isSameGroup);
    });

    // 2. Re-propagate through end of next month
const [m, d, y] = normalizeDateForSheetJS(baseTrx.date).split("/").map(Number);
    const boundary = new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0);
    let currM = m, currY = y, safety = 0;

    while (safety < 24) {
      if (++currM > 12) { currM = 1; currY++; }
      const loopDate = new Date(currY, currM - 1, d);
      if (loopDate > boundary) break;

      transactions.unshift({
        ...baseTrx,
        id: Date.now() + (++safety), // Unique ID for sheet
        date: normalizeDateForSheetJS(loopDate),
        // Keep the same groupId so they stay linked!
      });
    }
  };

  el("deleteCancelBtn").onclick = hideOv;
  el("deleteConfirmBtn").onclick = () => {
    if (deletePendingIndex !== null) { transactions.splice(deletePendingIndex, 1); refreshUI(); saveStateToSheet(); }
    hideOv();
  };

  // ======= ADD TRANSACTION =======
  el("addTransactionBtn").onclick = () => {
    const amt = parseFloat(el("trxAmount").value), rawDate = el("trxDate").value;
    const catLab = el("categorySelected")?.textContent.trim();
    if (isNaN(amt) || !rawDate) return alert("Amount and Date are required.");

    const [y, m, d] = rawDate.split("-").map(Number);
    const isRec = el("trxRecurring").checked;
    
    const newTrx = {
      id: Date.now(),
      groupId: isRec ? Date.now() : null, // Create a unique link for this series
      date: `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`,
      desc: el("trxDesc").value.trim(),
      category: (!catLab || catLab === "Select category") ? "Uncategorized" : catLab,
      amount: amt,
      account: currentAccount,
      recurring: isRec ? "Yes" : "No"
    };

    transactions.unshift(newTrx);
    if (isRec) syncRecurringGroup(newTrx);
    
    el("trxAmount").value = el("trxDesc").value = "";
    el("trxRecurring").checked = false;
    refreshUI(); saveStateToSheet();
  };

  // ======= EDIT MODAL =======
  const applyEditAccountStyles = () => {
    document.querySelectorAll("#editAccountToggle button").forEach(b => {
      const acct = b.dataset.editAccount, isActive = acct === editAccount;
      b.className = `px-3 py-1 rounded-full transition-colors ${isActive ? (ACCT_COLORS[acct] + " text-white") : "text-slate-500 opacity-60"}`;
    });
  };

document.querySelectorAll("#editAccountToggle button").forEach(b => {
  b.onclick = () => {
    editAccount = b.dataset.editAccount;
    window.applyEditAccountStyles?.();
  };
});


window.applyEditAccountStyles = applyEditAccountStyles;
window.applyEditAccountStyles();


  el("editSaveBtn").onclick = () => {
    if (deletePendingIndex === null) return;
    const [y, m, d] = el("editDate").value.split('-');
    const isNowRec = el("editRecurring").checked;
    
    // Get existing item to check if it already had a group
    const oldItem = transactions[deletePendingIndex];

    const updatedTrx = {
      ...oldItem,
      date: `${m}/${d}/${y}`,
      desc: el("editDesc").value.trim(),
      category: el("editCat").value,
      amount: parseFloat(el("editAmt").value) || 0,
      account: editAccount,
      recurring: isNowRec ? "Yes" : "No",
      // If it's newly recurring, give it a group ID. If it was already, keep the old one.
      groupId: oldItem.groupId || (isNowRec ? Date.now() : null)
    };

    transactions[deletePendingIndex] = updatedTrx;

    // If it's recurring, sync the rest of the series
    if (isNowRec) syncRecurringGroup(updatedTrx);

    refreshUI(); saveStateToSheet(); hideOv();
  };
}

(async () => {
  try { 
    await loadStateFromSheet(); 
    // New step: Fill in any missing months that moved into range
    runRecurringMaintenance(); 
  }
  catch (e) { console.error(e); budgets = []; transactions = []; }
  
  renderCategoryFilterUI();
  initBudgetControls();
  setupEventHandlers();
  setupAccountToggle();
  refreshUI(); // refreshUI will handle the sorting
})();

const categoryBtn      = document.getElementById("categoryBtn");
const categoryMenu     = document.getElementById("categoryMenu");
const categorySelected = document.getElementById("categorySelected");

if (categoryBtn && categoryMenu && categorySelected) {
  categoryBtn.addEventListener("click", () => categoryMenu.classList.toggle("hidden"));

  document.querySelectorAll(".category-item").forEach(item => {
    item.addEventListener("click", () => {
      const selected = (item.getAttribute("data-cat") || "Uncategorized").trim();
      categorySelected.textContent = selected;
      categoryMenu.classList.add("hidden");
      console.log("Category selected (label):", selected);
    });
  });
}


// ===================== ACCOUNT TOGGLE =====================
const ACCT_COLORS = { Ayush: "bg-blue-500", Joint: "bg-emerald-600", Nupur: "bg-rose-500" };

function applyAccountToggleStyles() {
  document.querySelectorAll("#accountToggle button[data-account]").forEach(b => {
    const acct = b.dataset.account, isActive = acct === currentAccount;
    b.classList.remove(...Object.values(ACCT_COLORS), "text-white", "opacity-60");
    isActive ? b.classList.add(ACCT_COLORS[acct], "text-white") : b.classList.add("opacity-60");
  });
}

function setupAccountToggle() {
  document.querySelectorAll("#accountToggle button[data-account]").forEach(b => {
    b.onclick = () => { currentAccount = b.dataset.account; applyAccountToggleStyles(); };
  });
  applyAccountToggleStyles();
}

// ===================== DROPDOWNS & FILTERS =====================
function renderCategoryFilterUI() {
  const menu = el("categoryFilterMenu");
  if (!menu) return;

  const cats = Object.keys(CATEGORY_STYLES);
  
  // 1. Generate HTML for "All" plus every category in your styles object
  menu.innerHTML = `
    <label class="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer border-b border-slate-100 mb-1">
      <input type="checkbox" data-cat-filter-multi="All" ${activeCategoryFilters.includes("All") ? "checked" : ""}>
      <span class="text-[10px] font-bold text-slate-700 uppercase tracking-tight">All Categories</span>
    </label>
    ${cats.map(cat => `
      <label class="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded cursor-pointer">
        <input type="checkbox" data-cat-filter-multi="${cat}" ${activeCategoryFilters.includes(cat) ? "checked" : ""}>
        <span class="text-[11px] text-slate-600">${cat}</span>
      </label>
    `).join("")}
  `;

  // 2. Wire up the change events for the newly created elements
  menu.querySelectorAll("[data-cat-filter-multi]").forEach(chk => {
    chk.onchange = () => {
      activeCategoryFilters = handleMultiFilter(chk, activeCategoryFilters, "data-cat-filter-multi");
      refreshUI();
    };
  });
}
// 1. Unified Dropdown Toggle Logic
[["dateHeaderFilterBtn", "accountFilterMenu"], ["categoryHeaderFilterBtn", "categoryFilterMenu"]].forEach(([btnId, menuId]) => {
  const btn = el(btnId), menu = el(menuId);
  if (!btn || !menu) return;

  btn.onclick = (e) => {
    e.stopPropagation();
    // Close other menus before toggling this one
    document.querySelectorAll('.filter-menu').forEach(m => m !== menu && m.classList.add("hidden"));
    menu.classList.toggle("hidden");
  };
});

// 2. Single Global Click Listener (Outside the loop)
document.addEventListener("click", (e) => {
  document.querySelectorAll('.filter-menu').forEach(menu => {
    if (!menu.contains(e.target)) menu.classList.add("hidden");
  });
});

// 3. Multi-select Filter Logic (State Management)
function handleMultiFilter(chk, filterArray, attrName) {
  const val = chk.getAttribute(attrName), allBox = document.querySelector(`[${attrName}='All']`);
  const boxes = document.querySelectorAll(`[${attrName}]`);

  if (val === "All") {
    if (chk.checked) {
      boxes.forEach(b => b !== chk && (b.checked = false));
      return ["All"];
    }
    return filterArray.length === 1 && filterArray[0] === "All" ? (chk.checked = true, ["All"]) : filterArray;
  } 

  let next = chk.checked ? [...filterArray, val] : filterArray.filter(v => v !== val);
  next = [...new Set(next.filter(v => v !== "All"))];
  
  if (!next.length) { allBox.checked = true; return ["All"]; }
  allBox.checked = false;
  return next;
}

// 4. Event Wiring
document.querySelectorAll("[data-filter-multi]").forEach(chk => {
  chk.onchange = () => {
    activeAccountFilters = handleMultiFilter(chk, activeAccountFilters, "data-filter-multi");
    updateFilterDot(); refreshUI();
  };
});

document.querySelectorAll("[data-cat-filter-multi]").forEach(chk => {
  chk.onchange = () => {
    activeCategoryFilters = handleMultiFilter(chk, activeCategoryFilters, "data-cat-filter-multi");
    refreshUI();
  };
});

function updateFilterDot() {
  const dot = el("dateHeaderFilterDot"), set = new Set(activeAccountFilters.filter(a => a !== "All" && a !== "Joint"));
  if (!dot) return;
  dot.style.opacity = set.size ? 1 : 0;
  if (set.size) {
    dot.style.backgroundColor = set.has("Ayush") && set.has("Nupur") ? "#7c3aed" : (set.has("Ayush") ? "#2563eb" : "#dc2626");
  }
}
// ===================== TAB SWITCHER & INITIALIZATION =====================
(function () {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const cards = {
    inputCard: document.getElementById("inputCard"),
    tableCard: document.getElementById("tableCard"),
    reportCard: document.getElementById("reportCard"),
  };

function setActiveTab(targetId) {
  Object.keys(cards).forEach(id => cards[id]?.classList.toggle("hidden", id !== targetId));
  
  tabButtons.forEach(btn => {
    const isActive = btn.getAttribute("data-tab-target") === targetId;
    btn.className = "tab-btn flex-1 text-center px-4 py-2 text-xs sm:text-sm font-medium transition-colors duration-150 " +
                    (isActive ? "bg-slate-200 text-slate-900" : "bg-transparent text-slate-600 hover:bg-slate-100");
  });

  if (targetId === "reportCard") {
    // 1. Render data first
    if (typeof window.refreshUI === "function") window.refreshUI();
    
    // 2. Snap to full width immediately after DOM update
    const el = document.getElementById("reportSankey");
    if (window.Plotly && el) {
      setTimeout(() => {
        Plotly.Plots.resize(el);
      }, 0);
    }
  }
}

  async function refreshReportFromSheet() {
    setActiveTab("reportCard");
    if (typeof window.reloadStateFromSheet === "function") await window.reloadStateFromSheet();
    if (typeof window.refreshUI === "function") window.refreshUI();
    const el = document.getElementById("reportSankey");
    if (window.Plotly && el) requestAnimationFrame(() => window.Plotly.Plots.resize(el));
  }

  tabButtons.forEach(btn => {
    btn.onclick = (e) => {
      const target = btn.getAttribute("data-tab-target");
      if (target === "reportCard") {
        e.preventDefault();
        refreshReportFromSheet();
      } else {
        setActiveTab(target);
      }
    };
  });

  setActiveTab("inputCard");
})();


// ======= AUTO-MAINTENANCE =======
function runRecurringMaintenance() {
  const now = new Date();
  const boundary = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  
  // 1. Get unique group IDs for active recurring series
  const recurringGroups = [...new Set(transactions
    .filter(t => t.recurring === "Yes" && t.groupId)
    .map(t => t.groupId))];

  let addedAny = false;

  recurringGroups.forEach(gid => {
    // 2. Find the latest entry in this group
const groupItems = transactions.filter(t => t.groupId === gid);
if (!groupItems.length) return;

const latest = groupItems.reduce((prev, curr) =>
  (parseMMDDYYYY(normalizeDateForSheetJS(curr.date))?.getTime() || 0) >
  (parseMMDDYYYY(normalizeDateForSheetJS(prev.date))?.getTime() || 0) ? curr : prev
);


    // 3. If the latest entry is before our boundary, extend it
let [m, d, y] = normalizeDateForSheetJS(latest.date).split("/").map(Number);
    let currM = m, currY = y, safety = 0;

    while (safety < 24) {
      if (++currM > 12) { currM = 1; currY++; }
      const loopDate = new Date(currY, currM - 1, d);
      if (loopDate > boundary) break;

      transactions.unshift({
        ...latest,
        id: Date.now() + (++safety),
        date: normalizeDateForSheetJS(loopDate)
      });
      addedAny = true;
    }
  });

  if (addedAny) {
    console.log("Auto-maintenance: Extended recurring transactions.");
    saveStateToSheet();
  }
}