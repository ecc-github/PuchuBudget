// script.js — Google Sheets backend, static categories, smooth sync

// ======= CONFIG =======
const API_URL =
  "https://script.google.com/macros/s/AKfycbxicn20ypSOpKqnzlzexzYk28wOgnMkJtVRb5KfSqYgeyqOEwK-6iuU9buP0_YtHZ8/exec";

// ======= STATE =======
let budgets = [];
let transactions = [];
let deletePendingIndex = null;

// NEW: currently selected account for new transactions
let currentAccount = "Joint";

// Multi-account filter for the table ("All", "Ayush", "Joint", "Nupur")
let activeAccountFilters = ["All"];
let activeCategoryFilters = ["All"];
// ======= CATEGORY STYLES (for pills) =======
const CATEGORY_STYLES = {
  "Groceries":         "bg-emerald-50 text-emerald-700",
  "Dining out":        "bg-rose-50 text-rose-700",
  "Personal spending": "bg-indigo-50 text-indigo-700",
  "Housing":           "bg-amber-50 text-amber-700",
  "Transportation":    "bg-sky-50 text-sky-700",
  "Subscriptions":     "bg-fuchsia-50 text-fuchsia-700",
  "Utilities":         "bg-cyan-50 text-cyan-700",
  "Savings":           "bg-lime-50 text-lime-700",
  "Health":            "bg-teal-50 text-teal-700",  
  "Miscellaneous":     "bg-slate-100 text-slate-700",
  "Uncategorized":     "bg-slate-100 text-slate-700",
};

// Hex colors for Plotly nodes/links (roughly matching the pills)
const CATEGORY_COLOR_HEX = {
  "Groceries":         "#22c55e", // emerald-500
  "Dining out":        "#f97373", // rose-ish
  "Personal spending": "#6366f1", // indigo-500
  "Housing":           "#f59e0b", // amber-500
  "Transportation":    "#0ea5e9", // sky-500
  "Subscriptions":     "#e879f9", // fuchsia-400
  "Utilities":         "#06b6d4", // cyan-500
  "Savings":           "#65a30d", // lime-600
  "Health":            "#14b8a6", // teal-500
  "Miscellaneous":     "#64748b", // slate-500
  "Uncategorized":     "#94a3b8"  // slate-400
};


const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// ======= API HELPERS =======

// GET: load everything from Google Sheets (only on init)
async function loadStateFromSheet() {
  const res = await fetch(API_URL);

  if (!res.ok) {
    throw new Error("Failed to load data from Google Sheets");
  }

  const data = await res.json();
  console.log("Loaded from sheet:", data);

  budgets = data.budgets || [];
  transactions = (data.transactions || []).map(t => ({
    ...t,
    account: t.account || "Joint",   // 👈 default if missing
  }));
}


// POST: save everything to Google Sheets (fire-and-forget)
async function saveStateToSheet() {
  try {
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ budgets, transactions }),
    });
  } catch (err) {
    console.error("Failed to save data to Google Sheets:", err);
  }
}

// Normalize to MM/DD/YYYY for saving to / reading from Sheets
function normalizeDateForSheetJS(raw) {
  if (!raw) return "";

  const s = String(raw).trim();

  // MM/DD/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    return s;
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${m}/${d}/${y}`;
  }

  // ISO datetime like 2025-11-01T04:00:00.000Z
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      const yyyy = dt.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    }
  }

  // Fallback: try as Date
  const dt2 = new Date(s);
  if (!isNaN(dt2.getTime())) {
    const mm = String(dt2.getMonth() + 1).padStart(2, "0");
    const dd = String(dt2.getDate()).padStart(2, "0");
    const yyyy = dt2.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }

  return s;
}

// ======= UTIL: Currency & Date Display =======
function formatCurrency(n) {
  if (isNaN(n) || n === null) return "$0.00";
  return "$" + Number(n).toFixed(2);
}

function formatDateForDisplay(value) {
  if (!value) return "";

  const s = String(value).trim();

  // MM/DD/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    return s;
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${m}/${d}/${y}`;
  }

  // ISO datetime
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      const yyyy = dt.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    }
  }

  // Fallback: Date object
  const dt2 = new Date(s);
  if (!isNaN(dt2.getTime())) {
    const mm = String(dt2.getMonth() + 1).padStart(2, "0");
    const dd = String(dt2.getDate()).padStart(2, "0");
    const yyyy = dt2.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }

  return s;
}

// ======= UTIL: Budgets ↔ Month/Year helpers =======

// Parse the Month / Year input into { monthName, year }
function parseMonthInputValue(value) {
  if (!value) return { monthName: "", year: null };

  const s = String(value).trim();

  // Case 1: "YYYY-MM" (legacy / safety)
  if (/^\d{4}-\d{1,2}$/.test(s)) {
    const [yStr, mStr] = s.split("-");
    const year = Number(yStr);
    const idx  = Math.max(0, Math.min(11, parseInt(mStr, 10) - 1));
    const monthName = MONTH_NAMES[idx] || "";
    return { monthName, year };
  }

  // Case 2: "January '25" or "January 2025"
  const m = /^([A-Za-z]+)\s+'?(\d{2,4})$/.exec(s);
  if (m) {
    const rawName = m[1];
    let yearNum   = Number(m[2]);

    if (yearNum < 100) {
      // Treat 2-digit years as 20xx
      yearNum += 2000;
    }

    // Normalize month name capitalization
    const monthName =
      rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();

    return { monthName, year: yearNum };
  }

  // Fallback: try parsing as Date
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    const year      = dt.getFullYear();
    const monthName = MONTH_NAMES[dt.getMonth()] || "";
    return { monthName, year };
  }

  return { monthName: "", year: null };
}

function getBudgetEntryForMonthInput(value) {
  const { monthName, year } = parseMonthInputValue(value);
  if (!monthName || !year) return null;

  const wantedMonth = monthName.trim().toLowerCase();
  const wantedYear  = Number(year);

  return (
    budgets.find((b) => {
      const bm = String(b.month || "").trim().toLowerCase();
      const by = Number(b.year);
      return bm === wantedMonth && by === wantedYear;
    }) || null
  );
}

function upsertBudgetForMonthInput(value, budgetAmount) {
  const { monthName, year } = parseMonthInputValue(value);
  if (!monthName || !year) return;

  const wantedMonth = monthName.trim().toLowerCase();
  const wantedYear  = Number(year);

  let found = false;
  for (let i = 0; i < budgets.length; i++) {
    const b  = budgets[i];
    const bm = String(b.month || "").trim().toLowerCase();
    const by = Number(b.year);

    if (bm === wantedMonth && by === wantedYear) {
      budgets[i] = {
        month: monthName,
        year: year,
        budget: Number(budgetAmount) || 0,
      };
      found = true;
      break;
    }
  }

  if (!found) {
    budgets.push({
      month: monthName,
      year: year,
      budget: Number(budgetAmount) || 0,
    });
  }
}


// ======= RENDER: TRANSACTIONS TABLE =======

function getSelectedYearMonth() {
  const monthInput = document.getElementById("budgetMonthYear");
  if (!monthInput || !monthInput.value || !monthInput.value.includes("-")) {
    return null;
  }

  const [yStr, mStr] = monthInput.value.split("-");
  const year = Number(yStr);
  const month = Number(mStr);

  if (isNaN(year) || isNaN(month)) return null;
  return { year, month };
}



function updateHeaderStats(visibleTransactions) {
  const primaryEls = [
    document.getElementById("monthHeaderPrimary"),
    document.getElementById("tableHeaderPrimary")
  ];

  const secondaryEls = [
    document.getElementById("monthHeaderSecondary"),
    document.getElementById("tableHeaderSecondary")
  ];

  const ym = getSelectedYearMonth();

  // ---- Total spent (only from visible rows) ----
  let totalSpent = 0;
  visibleTransactions.forEach((t) => {
    const n = Number(t.amount);
    if (!isNaN(n)) totalSpent += n;
  });

  const count      = visibleTransactions.length;
  const totalLabel = `Total ${formatCurrency(totalSpent)}`;
  const txLabel    = count === 1 ? "1 transaction" : `${count} transactions`;

  // ---- Budget logic ----
  let secondaryText  = "";
  let state          = "muted"; // "good" | "bad" | "muted"

  if (!ym) {
    secondaryText = "Available budget: —";
    state = "muted";
  } else {
    const key   = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
    const entry = getBudgetEntryForMonthInput(key);

    if (!entry || entry.budget == null || Number(entry.budget) === 0) {
      secondaryText = "Available budget: —";
      state = "muted";
    } else {
      const budget    = Number(entry.budget) || 0;
      const remaining = budget - totalSpent;

      if (remaining >= 0) {
        secondaryText = `Available budget: ${formatCurrency(remaining)}`;
        state = "good";
      } else {
        secondaryText = `Over budget by ${formatCurrency(Math.abs(remaining))}`;
        state = "bad";
      }
    }
  }

  // ---- APPLY PRIMARY LINE (Total + count) ----
  primaryEls.forEach((el) => {
    if (!el) return;
    el.innerHTML = `
      <span>${totalLabel}</span>
      <span class="ml-auto text-[11px] sm:text-xs font-normal text-slate-500">
        ${txLabel}
      </span>
    `;
  });

  // ---- APPLY SECONDARY LINE (with inline styles) ----
  secondaryEls.forEach((el) => {
    if (!el) return;

    // Base text
    el.textContent = secondaryText;

    // Reset styles first
    el.style.color      = "#64748b";  // default slate-ish
    el.style.fontSize   = "0.85rem";
    el.style.fontWeight = "400";

    if (state === "good") {
      el.style.color      = "#0f9d5a"; // emerald-ish
      el.style.fontWeight = "700";
    } else if (state === "bad") {
      el.style.color      = "#dc2626"; // red-ish
      el.style.fontWeight = "700";
    }
  });
}



// Return the list of transactions for the currently selected month/year
function getVisibleTransactionsForCurrentMonth() {
  const ym = getSelectedYearMonth();

  // Start from all transactions
  let list = transactions.slice();

  // Filter by selected month/year (if any)
  if (ym) {
    list = list.filter((t) => {
      if (!t.date) return false;

      const s = String(t.date).trim();

      // Expecting MM/DD/YYYY
      const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
      if (!match) {
        // Fallback: try Date parsing if format is weird
        const dt = new Date(s);
        if (isNaN(dt.getTime())) return false;
        const m = dt.getMonth() + 1;
        const y = dt.getFullYear();
        return m === ym.month && y === ym.year;
      }

      const m = Number(match[1]); // month
      const y = Number(match[3]); // year

      return m === ym.month && y === ym.year;
    });
  }

  // 🔍 Filter by account(s) if not "All"
  if (!activeAccountFilters.includes("All")) {
    list = list.filter((t) => {
      const acct = t.account || "Joint";
      return activeAccountFilters.includes(acct);
    });
  }

  // 🔍 Filter by category/ies if not "All"
  if (!activeCategoryFilters.includes("All")) {
    list = list.filter((t) => {
      const cat = t.category || "Uncategorized";
      return activeCategoryFilters.includes(cat);
    });
  }

  return list;
}

// Return all transactions for the selected month/year (ignores account filters)
function getMonthTransactionsAllAccounts() {
  const ym = getSelectedYearMonth();
  if (!ym) return [];

  return transactions.filter((t) => {
    if (!t.date) return false;

    const s = String(t.date).trim();

    // Expecting MM/DD/YYYY
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (!match) {
      // Fallback: Date parse
      const dt = new Date(s);
      if (isNaN(dt.getTime())) return false;
      const m = dt.getMonth() + 1;
      const y = dt.getFullYear();
      return m === ym.month && y === ym.year;
    }

    const m = Number(match[1]);
    const y = Number(match[3]);
    return m === ym.month && y === ym.year;
  });
}


function renderTransactions() {
  const tbody = document.getElementById("transactionsTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  // Decide which transactions are visible based on the selected month/year
  const visibleTransactions = getVisibleTransactionsForCurrentMonth();

  visibleTransactions.forEach((t) => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50 cursor-pointer";

    // Find the original index in the master transactions array
    const originalIndex = transactions.indexOf(t);

    // Date + small account dot
    const tdDate = document.createElement("td");
    tdDate.className = "px-2 sm:px-3 py-1.5 text-slate-800 whitespace-nowrap";

    const acct = t.account || "Joint";
    const dotClass =
      acct === "Ayush" ? "bg-sky-500" :
      acct === "Nupur" ? "bg-rose-500" :
      "";

    tdDate.innerHTML = `
      <div class="flex items-center gap-1.5">
        ${
          dotClass
            ? `<span class="inline-block w-1.5 h-1.5 rounded-full ${dotClass}"></span>`
            : ""
        }
        <span>${formatDateForDisplay(t.date)}</span>
      </div>
    `;



    // Description
    const tdDesc = document.createElement("td");
    tdDesc.className = "px-2 sm:px-3 py-1.5 text-slate-800";
    tdDesc.textContent = t.desc || "";

    // Category pill
    const tdCat = document.createElement("td");
    tdCat.className = "px-2 sm:px-3 py-1.5";

    const rawCatLabel = t.category || "Uncategorized";
    const MAX_CAT_LEN = 16;
    let catLabel = rawCatLabel;
    if (catLabel.length > MAX_CAT_LEN) {
      catLabel = catLabel.slice(0, MAX_CAT_LEN - 1) + "…";
    }

    const pillClass =
      CATEGORY_STYLES[rawCatLabel] || CATEGORY_STYLES["Miscellaneous"];

    tdCat.innerHTML = `
      <span class="category-pill rounded-full px-2 py-0.5 text-[11px] font-medium ${pillClass}">
        ${catLabel}
      </span>
    `;

    // Amount
    const tdAmt = document.createElement("td");
    tdAmt.className =
      "px-2 sm:px-3 py-1.5 text-right text-slate-800 whitespace-nowrap";
    tdAmt.textContent = formatCurrency(t.amount || 0);

    // Append tds
    tr.appendChild(tdDate);
    tr.appendChild(tdDesc);
    tr.appendChild(tdCat);
    tr.appendChild(tdAmt);

    // Clicking the row opens overlay asking to delete
    tr.addEventListener("click", () => {
      // Store the index in the full transactions[] array
      deletePendingIndex = originalIndex;

      const overlay = document.getElementById("deleteOverlay");
      const textEl = document.getElementById("deleteOverlayText");

      if (textEl) {
        textEl.textContent =
          `${formatDateForDisplay(t.date)} — ${t.desc || "No description"} · ${formatCurrency(t.amount)}`;
      }

      if (overlay) {
        overlay.classList.remove("hidden");
        overlay.classList.add("show");
      }
    });

    tbody.appendChild(tr);
  });

  // Update small "X transactions" label
  const counterEl = document.getElementById("transactionCountLabel");
  if (counterEl) {
    counterEl.textContent =
      `${visibleTransactions.length} transaction` +
      (visibleTransactions.length === 1 ? "" : "s");
  }

  // Update the summary header under the inputs
  updateHeaderStats(visibleTransactions);
}


// ======= MAIN REFRESH =======
function refreshUI() {
  renderTransactions();
  renderReportSankey();
}


function renderReportSankey() {
  const sankeyDiv   = document.getElementById("reportSankey");
  const detailsDiv  = document.getElementById("reportDetails");
  if (!sankeyDiv || !detailsDiv) return;

  // 🚫 Don't render while the Report tab is hidden (Plotly gets bad width)
  const reportCardSection = document.getElementById("reportCard");
  if (reportCardSection && reportCardSection.classList.contains("hidden")) {
    return;
  }

  // Clear details text if any
  detailsDiv.innerHTML = `
    <p class="text-[11px] sm:text-xs text-slate-500">
      Click a category node to see line items here.
    </p>
  `;

  const ym = getSelectedYearMonth();
  if (!ym) {
    sankeyDiv.innerHTML = `
      <div class="text-xs sm:text-sm text-slate-500">
        Select a month to see the report.
      </div>
    `;
    return;
  }

  // Transactions for current month + current account filters
  const monthTx = getVisibleTransactionsForCurrentMonth();
  if (monthTx.length === 0) {
    sankeyDiv.innerHTML = ``;
    return;
  }

  // Sum amounts by category
  const categoryTotals = {};
  let totalSpent = 0;

  monthTx.forEach((t) => {
    const cat = t.category || "Uncategorized";
    const amt = Number(t.amount) || 0;
    if (!categoryTotals[cat]) categoryTotals[cat] = 0;
    categoryTotals[cat] += amt;
    totalSpent += amt;
  });

  const categories = Object.keys(categoryTotals);
  if (categories.length === 0 || totalSpent === 0) {
    sankeyDiv.innerHTML = `
      <div class="text-xs sm:text-sm text-slate-500">
        No spending recorded yet for this month.
      </div>
    `;
    return;
  }

  // ====================== BUILD NODES & LINKS ======================
  const nodeLabels = [
    `Total<br>${formatCurrency(totalSpent)}`   // 0
  ].concat(
    categories.map(
      (cat) => `${cat}<br>${formatCurrency(categoryTotals[cat])}`
    )
  );

  const nodeColors = [
    "#15803d" // ✅ green Total node
  ].concat(
    categories.map((cat) => CATEGORY_COLOR_HEX[cat] || "#e5e7eb")
  );

  const sources    = [];
  const targets    = [];
  const values     = [];
  const linkColors = [];

  const categoryStartIndex = 1;               // categories start at node index 1
  const MIN_CAT_VAL        = totalSpent > 0 ? totalSpent * 0.05 : 0; // min thickness

  categories.forEach((cat, idx) => {
    const actual     = Math.abs(categoryTotals[cat]);
    const displayVal = Math.max(actual, MIN_CAT_VAL);

    sources.push(0);           // from Total
    targets.push(idx + 1);     // category node
    values.push(displayVal);
    linkColors.push(CATEGORY_COLOR_HEX[cat] || "#e5e7eb");
  });

  const data = [{
    type: "sankey",
    orientation: "h",
    node: {
      pad: 15,
      thickness: 20,
      line: { color: "#ffffff", width: 1 },
      label: nodeLabels,
      color: nodeColors,
      hovertemplate: "%{label}<extra></extra>"
    },
    link: {
      source: sources,
      target: targets,
      value:  values,
      color:  linkColors
    }
  }];

  // ====================== LAYOUT (FIT TO CARD WIDTH) ======================
  const layout = {
    margin: { t: 10, l: 10, r: 10, b: 10 },
    font: { size: 10 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    autosize: true,
    width: sankeyDiv.clientWidth || undefined
  };

  Plotly.newPlot(sankeyDiv, data, layout, {
    displayModeBar: false,
    responsive: true
  });

  if (Plotly.Plots && typeof Plotly.Plots.resize === "function") {
    Plotly.Plots.resize(sankeyDiv);
  }

  // ====================== CLICK → LINE ITEMS (SORTED HIGH → LOW) ======================
  sankeyDiv.on("plotly_click", (ev) => {
    const p = ev.points && ev.points[0];
    if (!p) return;

    const nodeIndex = typeof p.pointNumber === "number" ? p.pointNumber : null;
    if (nodeIndex == null) return;

    // Ignore Total node
    if (nodeIndex === 0) return;

    // Only respond to real categories
    if (nodeIndex < categoryStartIndex) return;

    const catIdx   = nodeIndex - categoryStartIndex;
    const category = categories[catIdx];
    if (!category) return;

    let catTx = monthTx.filter(
      (t) => (t.category || "Uncategorized") === category
    );

    if (catTx.length === 0) {
      detailsDiv.innerHTML = `
        <p class="text-[11px] sm:text-xs text-slate-500">
          No line items for <span class="font-semibold">${category}</span>.
        </p>
      `;
      return;
    }

    // 🔽 Sort by amount (highest → lowest)
    catTx = [...catTx].sort((a, b) => {
      const av = Math.abs(Number(a.amount) || 0);
      const bv = Math.abs(Number(b.amount) || 0);
      return bv - av;
    });

    const totalCat = catTx.reduce(
      (sum, t) => sum + (Number(t.amount) || 0),
      0
    );

    let html = `
      <div class="flex items-center justify-between mb-2">
        <p class="text-xs sm:text-sm font-semibold text-slate-900">
          ${category} — ${formatCurrency(totalCat)}
        </p>
        <p class="text-[11px] sm:text-xs text-slate-50ertemplate: "%{label}<0">
          ${catTx.length} item${catTx.length === 1 ? "" : "s"} (sorted high → low)
        </p>
      </div>
      <div class="max-h-52 overflow-y-auto border border-slate-200 rounded-lg bg-white">
        <table class="min-w-full text-[11px] sm:text-xs">
          <thead class="bg-slate-50 text-slate-500">
            <tr>
              <th class="px-2 py-1 text-left font-medium">Date</th>
              <th class="px-2 py-1 text-left font-medium">Description</th>
              <th class="px-2 py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
    `;

    catTx.forEach((t) => {
      html += `
        <tr>
          <td class="px-2 py-1">${formatDateForDisplay(t.date)}</td>
          <td class="px-2 py-1">${t.desc || ""}</td>
          <td class="px-2 py-1 text-right">${formatCurrency(t.amount || 0)}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;

    detailsDiv.innerHTML = html;
  });
}


function initBudgetControls() {
  const monthInput  = document.getElementById("budgetMonthYear");
  const budgetInput = document.getElementById("budgetAmount");
  if (!monthInput || !budgetInput) return;

  // Default underlying value to today's month/year if empty, in "YYYY-MM"
  if (!monthInput.value) {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    monthInput.value = `${year}-${month}`;
  }

  // Helper: load budget for current month input's value ("YYYY-MM")
  function syncBudgetForCurrentMonth() {
    const entry = getBudgetEntryForMonthInput(monthInput.value);
    if (entry) {
      budgetInput.value =
        entry.budget !== undefined && entry.budget !== null
          ? entry.budget
          : "";
    } else {
      budgetInput.value = "";
    }
  }

  // Initialize Flatpickr month/year picker (if library loaded)
  if (window.flatpickr && window.monthSelectPlugin) {
    flatpickr(monthInput, {
      altInput: true,
      plugins: [
        new monthSelectPlugin({
          shorthand: false,
          dateFormat: "Y-m",        // internal stored value → 2025-12
          altFormat: "F \\'y",      // visible to user → December '25
          theme: "light"
        })
      ],
      defaultDate: monthInput.value,
      allowInput: false,
      onChange: function(selectedDates, dateStr) {
        // dateStr is "YYYY-MM"
        monthInput.value = dateStr;
        syncBudgetForCurrentMonth();
        // 🔥 re-filter transactions whenever month changes
        refreshUI();
      }
    });
  }

  // Initial sync from loaded budgets[]
  syncBudgetForCurrentMonth();
  // 🔥 initial filter of transactions for the default month
  refreshUI();

  // Save budget for the selected month/year
function saveBudgetForCurrentMonth() {
  const raw = budgetInput.value.trim();
  const amount = raw ? Number(raw) : 0;
  if (!monthInput.value) return; // need a month/year

  upsertBudgetForMonthInput(monthInput.value, amount);
  saveStateToSheet();
  refreshUI();  // 🔥 update header + table summary immediately
}

  // 🔥 if user changes the month via native <input type="month"> (no flatpickr)
  monthInput.addEventListener("change", () => {
    syncBudgetForCurrentMonth();
    refreshUI();   // re-filter table
  });

  // Save on change, blur, and Enter
  budgetInput.addEventListener("change", saveBudgetForCurrentMonth);
  budgetInput.addEventListener("blur", saveBudgetForCurrentMonth);
  budgetInput.addEventListener("keyup", (e) => {
    if (e.key === "Enter") saveBudgetForCurrentMonth();
  });
}


function setupEventHandlers() {
  const addTransactionBtn = document.getElementById("addTransactionBtn");
  const overlay           = document.getElementById("deleteOverlay");
  const deleteCancelBtn   = document.getElementById("deleteCancelBtn");
  const deleteConfirmBtn  = document.getElementById("deleteConfirmBtn");
  const categorySelect    = document.getElementById("trxCategory");

  // -------------------------------------------
  // CATEGORY SELECTOR STYLING
  // -------------------------------------------
  if (categorySelect) {
    categorySelect.addEventListener("change", () => {
      const cat = categorySelect.value;

      // Remove previous colors
categorySelect.classList.remove(
  "cat-groceries","cat-dining","cat-personal","cat-housing",
  "cat-transport","cat-subs","cat-utilities","cat-savings",
  "cat-health","cat-misc"     
);

if (cat === "Groceries")         categorySelect.classList.add("cat-groceries");
if (cat === "Dining out")        categorySelect.classList.add("cat-dining");
if (cat === "Personal spending") categorySelect.classList.add("cat-personal");
if (cat === "Housing")           categorySelect.classList.add("cat-housing");
if (cat === "Transportation")    categorySelect.classList.add("cat-transport");
if (cat === "Subscriptions")     categorySelect.classList.add("cat-subs");
if (cat === "Utilities")         categorySelect.classList.add("cat-utilities");
if (cat === "Savings")           categorySelect.classList.add("cat-savings");
if (cat === "Health")            categorySelect.classList.add("cat-health");  // ⭐ NEW
if (cat === "Miscellaneous")     categorySelect.classList.add("cat-misc");

    });
  }

if (addTransactionBtn) {
  addTransactionBtn.addEventListener("click", () => {
    const dateRaw = document.getElementById("trxDate").value; // "YYYY-MM-DD"
    const desc    = document.getElementById("trxDesc").value.trim();

    // 🔥 Read category from the visible label
    const categoryLabelEl = document.getElementById("categorySelected");
    let category = "Uncategorized";

    if (categoryLabelEl) {
      const txt = categoryLabelEl.textContent.trim();
      // Treat "Select category" as "no category chosen"
      if (txt && txt !== "Select category") {
        category = txt;
      }
    }

    const amountRaw = document.getElementById("trxAmount").value;
    const amount    = amountRaw ? parseFloat(amountRaw) : NaN;

    if (!amountRaw || isNaN(amount)) {
      alert("Amount is required.");
      return;
    }

    const dateForSheet = normalizeDateForSheetJS(dateRaw);

    console.log("Adding transaction with category:", category);

    // Optimistic add — NEWEST FIRST
  transactions.unshift({
    id: Date.now(),
    date: dateForSheet,
    desc,
    category,
    amount,
    account: currentAccount,   // 👈 NEW
  });

    document.getElementById("trxAmount").value = "";
    document.getElementById("trxDesc").value   = "";

    refreshUI();
    saveStateToSheet();
  });
}



  // Overlay cancel
  if (deleteCancelBtn && overlay) {
    deleteCancelBtn.addEventListener("click", () => {
      deletePendingIndex = null;
      overlay.classList.remove("show");
      setTimeout(() => overlay.classList.add("hidden"), 150);
    });
  }

  // Overlay confirm delete
  if (deleteConfirmBtn && overlay) {
    deleteConfirmBtn.addEventListener("click", () => {
      if (deletePendingIndex !== null) {
        transactions.splice(deletePendingIndex, 1);
        deletePendingIndex = null;
        refreshUI();
        saveStateToSheet();
      }
      overlay.classList.remove("show");
      setTimeout(() => overlay.classList.add("hidden"), 150);
    });
  }
}

// ======= INIT (async) =======
(async function init() {
  try {
    await loadStateFromSheet();  // one-time sync from Sheets at page load

    // Newest first: reverse order from sheet once on load
    transactions.reverse();
  } catch (err) {
    console.error("Error loading from Sheets:", err);
    budgets = [];
    transactions = [];
  }

  // Wire up everything
  initBudgetControls();
  setupEventHandlers();
  setupAccountToggle();

  refreshUI();
})();
const categoryBtn      = document.getElementById("categoryBtn");
const categoryMenu     = document.getElementById("categoryMenu");
const categorySelected = document.getElementById("categorySelected");

if (categoryBtn && categoryMenu && categorySelected) {
  categoryBtn.addEventListener("click", () => {
    categoryMenu.classList.toggle("hidden");
  });

  document.querySelectorAll(".category-item").forEach((item) => {
    item.addEventListener("click", () => {
      const selected = item.getAttribute("data-cat") || "Uncategorized";

      // Update the button label
      categorySelected.textContent = selected;
      categoryMenu.classList.add("hidden");

      console.log("Category selected (label):", selected);
    });
  });
}


// ===================== ACCOUNT TOGGLE =====================

function applyAccountToggleStyles() {
  const toggle = document.getElementById("accountToggle");
  if (!toggle) return;

  const buttons = toggle.querySelectorAll("button[data-account]");

  buttons.forEach((b) => {
    const acct = b.getAttribute("data-account");
    const isActive = acct === currentAccount;

    // Clear any old color classes
    b.classList.remove(
      "bg-blue-500",
      "bg-emerald-600",
      "bg-rose-500",
      "text-white",
      "text-blue-700",
      "text-emerald-700",
      "text-rose-700",
      "opacity-60"
    );

    if (isActive) {
      // Active state: solid color + white text
      if (acct === "Ayush") {
        b.classList.add("bg-blue-500", "text-white");
      } else if (acct === "Joint") {
        b.classList.add("bg-emerald-600", "text-white");
      } else if (acct === "Nupur") {
        b.classList.add("bg-rose-500", "text-white");
      }
    } else {
      // Inactive state: faint / dimmed
      b.classList.add("opacity-60");
    }
  });
}

function setupAccountToggle() {
  const toggle = document.getElementById("accountToggle");
  if (!toggle) return;

  const buttons = toggle.querySelectorAll("button[data-account]");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentAccount = btn.getAttribute("data-account") || "Joint";
      applyAccountToggleStyles();
      console.log("Account selected:", currentAccount);
    });
  });

  // Set initial styles (default Joint)
  applyAccountToggleStyles();
}

// ===================== ACCOUNT FILTER (Date header) =====================

// Toggle dropdown
document.getElementById("dateHeaderFilterBtn").addEventListener("click", () => {
  const menu = document.getElementById("accountFilterMenu");
  menu.classList.toggle("hidden");
});

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  const menu = document.getElementById("accountFilterMenu");
  const btn = document.getElementById("dateHeaderFilterBtn");

  if (!menu.contains(e.target) && !btn.contains(e.target)) {
    menu.classList.add("hidden");
  }
});


// Handle checkbox changes (multi-select: All / Ayush / Joint / Nupur)
document.querySelectorAll("[data-filter-multi]").forEach((chk) => {
  chk.addEventListener("change", () => {
    const val    = chk.dataset.filterMulti;
    const allBox = document.querySelector("[data-filter-multi='All']");
    const boxes  = document.querySelectorAll("[data-filter-multi]");

    // ---- "All" clicked ----
    if (val === "All") {
      if (chk.checked) {
        // Only "All" is active
        activeAccountFilters = ["All"];
        boxes.forEach((b) => {
          if (b !== chk) b.checked = false;
        });
      } else {
        // Prevent unchecking All with nothing else selected
        // (user should turn on specific filters instead)
        if (activeAccountFilters.length === 1 && activeAccountFilters[0] === "All") {
          chk.checked = true;
        }
      }
    } else {
      // ---- Individual (Ayush / Joint / Nupur) clicked ----
      if (chk.checked) {
        activeAccountFilters.push(val);
      } else {
        activeAccountFilters = activeAccountFilters.filter((a) => a !== val);
      }

      // Remove "All" any time specific filters are used
      activeAccountFilters = activeAccountFilters.filter((a) => a !== "All");

      // Dedupe
      activeAccountFilters = [...new Set(activeAccountFilters)];

      // If nothing selected, fall back to All
      if (activeAccountFilters.length === 0) {
        activeAccountFilters = ["All"];
        allBox.checked = true;
      } else {
        allBox.checked = false;
      }
    }

    updateFilterDot();
    refreshUI();
  });
});


function updateFilterDot() {
  const dot = document.getElementById("dateHeaderFilterDot");
  if (!dot) return;

  // Ignore "All" and "Joint" for dot color
  const filteredSet = new Set(
    activeAccountFilters.filter((a) => a !== "All" && a !== "Joint")
  );

  // No Ayush/Nupur selected → no dot
  if (filteredSet.size === 0) {
    dot.style.opacity = 0;
    return;
  }

  const hasAyush = filteredSet.has("Ayush");
  const hasNupur = filteredSet.has("Nupur");

  dot.style.opacity = 1;

  if (hasAyush && hasNupur) {
    // Ayush + Nupur → purple
    dot.style.backgroundColor = "#7c3aed";
  } else if (hasAyush) {
    // Ayush only → blue
    dot.style.backgroundColor = "#2563eb";
  } else if (hasNupur) {
    // Nupur only → red
    dot.style.backgroundColor = "#dc2626";
  } else {
    // Shouldn’t happen, but just in case
    dot.style.opacity = 0;
  }
}

// ===================== CATEGORY FILTER (Category header) =====================

// Toggle dropdown
const catHeaderBtn   = document.getElementById("categoryHeaderFilterBtn");
const catFilterMenu  = document.getElementById("categoryFilterMenu");

if (catHeaderBtn && catFilterMenu) {
  catHeaderBtn.addEventListener("click", () => {
    catFilterMenu.classList.toggle("hidden");
  });

  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (!catFilterMenu.contains(e.target) && !catHeaderBtn.contains(e.target)) {
      catFilterMenu.classList.add("hidden");
    }
  });
}

// Handle checkbox changes (multi-select: All / each category)
document.querySelectorAll("[data-cat-filter-multi]").forEach((chk) => {
  chk.addEventListener("change", () => {
    const val    = chk.dataset.catFilterMulti;
    const allBox = document.querySelector("[data-cat-filter-multi='All']");
    const boxes  = document.querySelectorAll("[data-cat-filter-multi]");

    // ---- "All" clicked ----
    if (val === "All") {
      if (chk.checked) {
        // Only "All" is active
        activeCategoryFilters = ["All"];
        boxes.forEach((b) => {
          if (b !== chk) b.checked = false;
        });
      } else {
        // Prevent unchecking All when nothing else selected
        if (activeCategoryFilters.length === 1 && activeCategoryFilters[0] === "All") {
          chk.checked = true;
        }
      }
    } else {
      // ---- Individual category clicked ----
      if (chk.checked) {
        activeCategoryFilters.push(val);
      } else {
        activeCategoryFilters = activeCategoryFilters.filter((c) => c !== val);
      }

      // Remove "All" when using specific filters
      activeCategoryFilters = activeCategoryFilters.filter((c) => c !== "All");

      // Dedupe
      activeCategoryFilters = [...new Set(activeCategoryFilters)];

      // If nothing selected, fall back to All
      if (activeCategoryFilters.length === 0) {
        activeCategoryFilters = ["All"];
        if (allBox) allBox.checked = true;
      } else if (allBox) {
        allBox.checked = false;
      }
    }

    // Re-render table + header stats with new category filters
    refreshUI();
  });
});
