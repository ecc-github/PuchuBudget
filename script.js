// script.js — Google Sheets backend, static categories, smooth sync

// ======= CONFIG =======
const API_URL =
  "https://script.google.com/macros/s/AKfycbzTBwojn0FEFbfSaK0VAfERyygxmkLsjzVU3M-QdM-m-Ufcq1Kd_aM58OKRbSkA8jQ/exec";

// ======= STATE =======
let budgets = [];        // [{ month: "November", year: 2025, budget: 1500 }, ...]
let transactions = [];   // from Transactions sheet
let deletePendingIndex = null; // which transaction index is pending delete in overlay

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
  "Miscellaneous":     "bg-slate-100 text-slate-700",
  "Uncategorized":     "bg-slate-100 text-slate-700",
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
  console.log("Loaded from sheet:", data);  // 👈 add this for debugging

  budgets = data.budgets || [];
  transactions = data.transactions || [];
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

  // ---- Total spent ----
  let totalSpent = 0;
  visibleTransactions.forEach((t) => {
    const n = Number(t.amount);
    if (!isNaN(n)) totalSpent += n;
  });

  const count = visibleTransactions.length;
  const txLabel = count === 1 ? "1 transaction" : `${count} transactions`;

  // ---- LINE 1 ----
  const primaryText = `Total ${formatCurrency(totalSpent)} · ${txLabel}`;

  // ---- Budget logic ----
  let secondaryText = "";
  let secondaryClass = "budget-muted";

  if (!ym) {
    secondaryText = "No month selected";
  } else {
    const key = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
    const entry = getBudgetEntryForMonthInput(key);

    if (!entry || entry.budget == null || Number(entry.budget) === 0) {
      secondaryText = "Budget not set";
    } else {
      const budget = Number(entry.budget) || 0;
      const remaining = budget - totalSpent;

      if (remaining >= 0) {
        secondaryText = `+${formatCurrency(remaining)}`;
        secondaryClass = "budget-good";
      } else {
        secondaryText = `-${formatCurrency(Math.abs(remaining))}`;
        secondaryClass = "budget-bad";
      }
    }
  }

  // ---- APPLY RESULT ----
  primaryEls.forEach(el => { 
    if (el) el.textContent = primaryText 
  });

  secondaryEls.forEach(el => { 
    if (el) {
      el.textContent = secondaryText;
      el.className = secondaryClass;
    }
  });
}


// Return the list of transactions for the currently selected month/year
function getVisibleTransactionsForCurrentMonth() {
  const ym = getSelectedYearMonth();
  if (!ym) {
    // No month selected → just return all
    return transactions.slice();
  }

  return transactions.filter((t) => {
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

    const m = Number(match[1]); // month from MM/DD/YYYY
    const y = Number(match[3]); // year

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

    // Date
    const tdDate = document.createElement("td");
    tdDate.className = "px-2 sm:px-3 py-1.5 text-slate-800 whitespace-nowrap";
    tdDate.textContent = formatDateForDisplay(t.date);

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
        "cat-transport","cat-subs","cat-utilities","cat-savings","cat-misc"
      );

      // Add new color
      if (cat === "Groceries")         categorySelect.classList.add("cat-groceries");
      if (cat === "Dining out")        categorySelect.classList.add("cat-dining");
      if (cat === "Personal spending") categorySelect.classList.add("cat-personal");
      if (cat === "Housing")           categorySelect.classList.add("cat-housing");
      if (cat === "Transportation")    categorySelect.classList.add("cat-transport");
      if (cat === "Subscriptions")     categorySelect.classList.add("cat-subs");
      if (cat === "Utilities")         categorySelect.classList.add("cat-utilities");
      if (cat === "Savings")           categorySelect.classList.add("cat-savings");
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
