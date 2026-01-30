"use strict";

console.log("app.js loaded");


const LS_KEY = "kcal_tracker_v3";

/*
  State:
  - ingredients: { id, name, brand, unitType, kcal, protein, carbs, fat, price }  (per base)
  - recipes: { id, name, items: [{ ingredientId, amount }] }                     (amount in g/ml/pieces)
  - dayLogs: { [dateKey]: [{ id, type, refId, amount, meal? }] }                 (meal is optional for backward compatibility)
  - goals: { kcal, protein, price, carbs, fat }

  Notes:
  - We do NOT break old imports. meal is optional and defaults to "snacks".
  - We use a day rollover at 04:30 local time.
*/

const MEALS = [
  { key: "breakfast", labelKey: "breakfast" },
  { key: "lunch", labelKey: "lunch" },
  { key: "snacks", labelKey: "snacks" },
  { key: "dinner", labelKey: "dinner" }
];


function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function parseNumber(input) {
  if (input == null) return NaN;
  const s = String(input).trim().replace(",", ".");
  if (s === "") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function clampPct(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 999) return 999;
  return x;
}

function round1(x) {
  return (Math.round(x * 10) / 10).toFixed(1);
}
function round2(x) {
  return (Math.round(x * 100) / 100).toFixed(2);
}

function euroPlain(x) {
  return round2(x).replace(".", ",");
}

function euro(x) {
  return `€ ${euroPlain(x)}`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function unitLabel(unitType) {
  if (unitType === "100g") return "pro 100 g";
  if (unitType === "100ml") return "pro 100 ml";
  return "pro Stück";
}

function amountPlaceholder(unitType) {
  if (unitType === "piece") return "Menge in Stück (z.B. 2)";
  if (unitType === "100ml") return "Menge in ml (z.B. 250)";
  return "Menge in g (z.B. 80)";
}

function amountLabel(unitType, amount) {
  if (unitType === "piece") return `${amount} Stück`;
  if (unitType === "100ml") return `${amount} ml`;
  return `${amount} g`;
}

function ratiosText(price, kcal, protein) {
  const p100prot = (protein > 0) ? (price / protein) * 100 : NaN;
  const p100kcal = (kcal > 0) ? (price / kcal) * 100 : NaN;

  // NEW: protein per 100 kcal
  const protPer100kcal = (kcal > 0) ? (protein / kcal) * 100 : NaN;

  // Reference values from DAILY GOALS (computed "average" target)
  const refP100prot = (state?.goals?.protein > 0) ? (state.goals.price / state.goals.protein) * 100 : NaN;
  const refP100kcal = (state?.goals?.kcal > 0) ? (state.goals.price / state.goals.kcal) * 100 : NaN;

  const a = Number.isFinite(p100prot) ? euroPlain(p100prot) : "n/a";
  const b = Number.isFinite(p100kcal) ? euroPlain(p100kcal) : "n/a";

  const aRef = Number.isFinite(refP100prot) ? ` (Ø ${euroPlain(refP100prot)})` : "";
  const bRef = Number.isFinite(refP100kcal) ? ` (Ø ${euroPlain(refP100kcal)})` : "";

  const c = Number.isFinite(protPer100kcal)
    ? `${round1(protPer100kcal).replace(".", ",")} g`
    : "n/a";

  return `· € / 100 g Protein ${a}${aRef} · € / 100 kcal ${b}${bRef} · ${t("proteinPer100kcal")} ${c}`;
}



function lineFull(price, kcal, protein, carbs, fat) {
  return `Preis ${euro(price)} · kcal ${Math.round(kcal)} · Protein ${round1(protein).replace(".", ",")} g · KH ${round1(carbs).replace(".", ",")} g · Fett ${round1(fat).replace(".", ",")} g ${ratiosText(price, kcal, protein)}`;
}

/* ===== Date handling (04:30 rollover) ===== */
function dayKeyFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function dateFromDayKey(key) {
  const parts = String(key).split("-");
  if (parts.length !== 3) return new Date();
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const d = Number(parts[2]);
  const dt = new Date(y, m, d);
  return Number.isFinite(dt.getTime()) ? dt : new Date();
}

function nowDayKeyRollover0430() {
  const now = new Date();
  // shift backwards 4h30m so that 00:00-04:29 belong to previous day
  const shifted = new Date(now.getTime() - (4 * 60 + 30) * 60 * 1000);
  return dayKeyFromDate(shifted);
}

function formatDateKeyGerman(key) {
  const d = dateFromDayKey(key);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}.${mm}.${yy}`;
}

/* ===== State load/save with backward compatible import ===== */
function loadState() {
  const raw = localStorage.getItem(LS_KEY);
  const defaults = { kcal: 2500, protein: 160, price: 15, carbs: 300, fat: 80 };

  if (!raw) {
    return { ingredients: [], recipes: [], dayLogs: {}, goals: { ...defaults } };
  }

  try {
    const s = JSON.parse(raw);
    if (!Array.isArray(s.ingredients)) s.ingredients = [];
    if (!Array.isArray(s.recipes)) s.recipes = [];
    if (!s.dayLogs || typeof s.dayLogs !== "object") s.dayLogs = {};
    if (!s.goals || typeof s.goals !== "object") s.goals = { ...defaults };

    // Ensure goals contain all fields (backward compatible)
    s.goals.kcal = Number.isFinite(s.goals.kcal) ? s.goals.kcal : defaults.kcal;
    s.goals.protein = Number.isFinite(s.goals.protein) ? s.goals.protein : defaults.protein;
    s.goals.price = Number.isFinite(s.goals.price) ? s.goals.price : defaults.price;
    s.goals.carbs = Number.isFinite(s.goals.carbs) ? s.goals.carbs : defaults.carbs;
    s.goals.fat = Number.isFinite(s.goals.fat) ? s.goals.fat : defaults.fat;

    return s;
  } catch {
    return { ingredients: [], recipes: [], dayLogs: {}, goals: { ...defaults } };
  }
}

let state = loadState();

/* Selected day key for navigation */
let selectedDayKey = nowDayKeyRollover0430();

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function getDayLog(key) {
  if (!state.dayLogs[key]) state.dayLogs[key] = [];
  return state.dayLogs[key];
}

function isValidMeal(meal) {
  return MEALS.some(m => m.key === meal);
}

function normalizeEntryMeal(entry) {
  // Backward compatibility: old entries had no meal -> default to snacks
  const m = entry && entry.meal;
  if (isValidMeal(m)) return m;
  return "snacks";
}

/* ===== Calc ===== */
function calcIngredientTotals(ing, amount) {
  let factor = 0;
  if (ing.unitType === "100g") factor = amount / 100;
  else if (ing.unitType === "100ml") factor = amount / 100;
  else factor = amount;

  return {
    kcal: ing.kcal * factor,
    protein: ing.protein * factor,
    carbs: ing.carbs * factor,
    fat: ing.fat * factor,
    price: ing.price * factor
  };
}

function calcRecipeTotals(recipe) {
  let t = { kcal: 0, protein: 0, carbs: 0, fat: 0, price: 0 };

  for (const it of recipe.items) {
    const ing = state.ingredients.find(x => x.id === it.ingredientId);
    if (!ing) continue;
    const a = calcIngredientTotals(ing, it.amount);
    t.kcal += a.kcal;
    t.protein += a.protein;
    t.carbs += a.carbs;
    t.fat += a.fat;
    t.price += a.price;
  }
  return t;
}


function ratioColor(value, reference) {
  // IMPORTANT: read from :root so theme vars are always found
  const styles = getComputedStyle(document.documentElement);

  const base = styles.getPropertyValue("--ratio-base").trim() || "rgb(242,244,248)";
  const green = styles.getPropertyValue("--ratio-green").trim() || "rgb(60,185,120)";
  const red = styles.getPropertyValue("--ratio-red").trim() || "rgb(255,90,90)";

  if (!Number.isFinite(value) || !Number.isFinite(reference) || reference <= 0) {
    return base;
  }

  const ratio = value / reference;
  const EPS = 0.03;
  if (Math.abs(ratio - 1) <= EPS) return base;

  function colorToObj(c) {
  const s = String(c).trim();

  // rgb(...) oder rgba(...)
  const m = s.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };

  // hex #rrggbb oder #rgb
  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split("").map(ch => ch + ch).join("");
    if (hex.length === 6) {
      const n = parseInt(hex, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
  }

  // fallback
  return { r: 11, g: 19, b: 32 };
}


  const baseObj = colorToObj(base);
const greenObj = colorToObj(green);
const redObj = colorToObj(red);


  let t = 0;
  let target = baseObj;

  if (ratio < 1) {
    t = (ratio - 0.5) / 0.5;
    t = Math.max(0, Math.min(1, t));
    target = {
      r: Math.round(greenObj.r + (baseObj.r - greenObj.r) * t),
      g: Math.round(greenObj.g + (baseObj.g - greenObj.g) * t),
      b: Math.round(greenObj.b + (baseObj.b - greenObj.b) * t)
    };
  } else {
    t = (ratio - 1.0) / 1.0;
    t = Math.max(0, Math.min(1, t));
    target = {
      r: Math.round(baseObj.r + (redObj.r - baseObj.r) * t),
      g: Math.round(baseObj.g + (redObj.g - baseObj.g) * t),
      b: Math.round(baseObj.b + (redObj.b - baseObj.b) * t)
    };
  }

  return `rgb(${target.r},${target.g},${target.b})`;
}



/* ===== DOM helpers ===== */
const $ = (sel) => document.querySelector(sel);

/* Tabs */
const tabButtons = Array.from(document.querySelectorAll(".tabBtn"));
const tabs = {
  day: $("#tab-day"),
  recipes: $("#tab-recipes"),
  ingredients: $("#tab-ingredients")
};

function setTab(name) {
  for (const k of Object.keys(tabs)) {
    tabs[k].classList.toggle("hidden", k !== name);
  }
  for (const btn of tabButtons) {
    btn.classList.toggle("tabBtn--active", btn.dataset.nav === name);
  }
  renderAll();
}

tabButtons.forEach(btn => {
  btn.addEventListener("click", () => setTab(btn.dataset.nav));
});

/* Modal */
const modal = $("#modal");
const modalTitle = $("#modalTitle");
const modalContent = $("#modalContent");
const modalClose = $("#modalClose");

modalClose.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

function openModal(title, renderFn) {
  modalTitle.textContent = title;
  modalContent.innerHTML = "";
  renderFn(modalContent);
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
  modalContent.innerHTML = "";
}

/* ===== Date navigation bar ===== */
const btnPrevDay = $("#btnPrevDay");
const btnNextDay = $("#btnNextDay");
const dateLabel = $("#dateLabel");

function getStoredDayKeysSorted() {
  const keys = Object.keys(state.dayLogs || {});
  keys.sort();
  return keys;
}

function getOldestStoredDayKeyOrNull() {
  const keys = getStoredDayKeysSorted().filter(k => {
    const arr = state.dayLogs[k];
    return Array.isArray(arr) && arr.length > 0;
  });
  if (keys.length === 0) return null;
  return keys[0];
}

function updateDateBar() {
  const todayKey = nowDayKeyRollover0430();
  const oldest = getOldestStoredDayKeyOrNull();

  // Label: Today -> "Heute", otherwise show date
dateLabel.textContent = (selectedDayKey === todayKey) ? t("today") : formatDateKeyGerman(selectedDayKey);

  // Can go forward only until today
  btnNextDay.disabled = (selectedDayKey === todayKey);

  // Can go back until oldest stored key (but allow empty days between)
  if (!oldest) {
    btnPrevDay.disabled = true;
  } else {
    btnPrevDay.disabled = (selectedDayKey <= oldest);
  }
}

btnPrevDay.addEventListener("click", () => {
  const oldest = getOldestStoredDayKeyOrNull();
  if (!oldest) return;

  const d = dateFromDayKey(selectedDayKey);
  const prev = addDays(d, -1);
  const prevKey = dayKeyFromDate(prev);

  if (prevKey < oldest) return;

  selectedDayKey = prevKey;
  renderAll();
});

btnNextDay.addEventListener("click", () => {
  const todayKey = nowDayKeyRollover0430();
  if (selectedDayKey >= todayKey) return;

  const d = dateFromDayKey(selectedDayKey);
  const next = addDays(d, +1);
  const nextKey = dayKeyFromDate(next);

  if (nextKey > todayKey) return;

  selectedDayKey = nextKey;
  renderAll();
});

/* ===== Export / Import ===== */
const btnExport = $("#btnExport");
const btnImport = $("#btnImport");
const importFile = $("#importFile");

btnExport.addEventListener("click", () => {
  // Add optional schemaVersion, but keep structure identical so old importers still work
  const payload = { ...state, schemaVersion: 2 };
  const data = JSON.stringify(payload, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `tracker-export-${nowDayKeyRollover0430()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

btnImport.addEventListener("click", () => {
  importFile.value = "";
  importFile.click();
});

importFile.addEventListener("change", async () => {
  const file = importFile.files && importFile.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON");
    if (!Array.isArray(parsed.ingredients)) throw new Error("Missing ingredients");
    if (!Array.isArray(parsed.recipes)) throw new Error("Missing recipes");
    if (!parsed.dayLogs || typeof parsed.dayLogs !== "object") throw new Error("Missing dayLogs");
    if (!parsed.goals || typeof parsed.goals !== "object") throw new Error("Missing goals");

    // Backward compatible: ensure goals contain carbs/fat
    const defaults = { kcal: 2500, protein: 160, price: 15, carbs: 300, fat: 80 };
    parsed.goals.kcal = Number.isFinite(parsed.goals.kcal) ? parsed.goals.kcal : defaults.kcal;
    parsed.goals.protein = Number.isFinite(parsed.goals.protein) ? parsed.goals.protein : defaults.protein;
    parsed.goals.price = Number.isFinite(parsed.goals.price) ? parsed.goals.price : defaults.price;
    parsed.goals.carbs = Number.isFinite(parsed.goals.carbs) ? parsed.goals.carbs : defaults.carbs;
    parsed.goals.fat = Number.isFinite(parsed.goals.fat) ? parsed.goals.fat : defaults.fat;

    state = parsed;
    saveState();

    // After import: keep selected day sensible
    const todayKey = nowDayKeyRollover0430();
    if (selectedDayKey > todayKey) selectedDayKey = todayKey;

    closeModal();
    renderAll();
    setTab("day");
  } catch {
alert(t("importFailed"));
  }
});

/* ===== Goals ===== */
const btnOpenGoals = $("#btnOpenGoals");

btnOpenGoals.addEventListener("click", () => {
  openModal(t("editGoals"), (container) => {

    const form = document.createElement("form");
    form.className = "modalRow";

    form.innerHTML = `
      <label class="field">
        <span>kcal Ziel pro Tag</span>
        <input class="searchInput" type="text" inputmode="decimal" id="mGoalKcal" placeholder="z.B. 2500">
      </label>
      <label class="field">
        <span>Protein Ziel pro Tag (g)</span>
        <input class="searchInput" type="text" inputmode="decimal" id="mGoalProtein" placeholder="z.B. 160">
      </label>
      <label class="field">
        <span>Preis Ziel pro Tag (€)</span>
        <input class="searchInput" type="text" inputmode="decimal" id="mGoalPrice" placeholder="z.B. 15">
      </label>
      <label class="field">
        <span>Kohlenhydrate Ziel pro Tag (g)</span>
        <input class="searchInput" type="text" inputmode="decimal" id="mGoalCarbs" placeholder="z.B. 300">
      </label>
      <label class="field">
        <span>Fett Ziel pro Tag (g)</span>
        <input class="searchInput" type="text" inputmode="decimal" id="mGoalFat" placeholder="z.B. 80">
      </label>
      <div class="row">
        <button class="btn" type="submit">Speichern</button>
      </div>
    `;

    container.appendChild(form);

    const kcalEl = form.querySelector("#mGoalKcal");
    const protEl = form.querySelector("#mGoalProtein");
    const priceEl = form.querySelector("#mGoalPrice");
    const carbsEl = form.querySelector("#mGoalCarbs");
    const fatEl = form.querySelector("#mGoalFat");

    kcalEl.value = String(state.goals.kcal ?? "");
    protEl.value = String(state.goals.protein ?? "");
    priceEl.value = String(state.goals.price ?? "");
    carbsEl.value = String(state.goals.carbs ?? "");
    fatEl.value = String(state.goals.fat ?? "");

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const kcal = parseNumber(kcalEl.value);
      const protein = parseNumber(protEl.value);
      const price = parseNumber(priceEl.value);
      const carbs = parseNumber(carbsEl.value);
      const fat = parseNumber(fatEl.value);

      if (!Number.isFinite(kcal) || kcal <= 0) return alert("kcal Ziel muss > 0 sein.");
      if (!Number.isFinite(protein) || protein <= 0) return alert("Protein Ziel muss > 0 sein.");
      if (!Number.isFinite(price) || price <= 0) return alert("Preis Ziel muss > 0 sein.");
      if (!Number.isFinite(carbs) || carbs <= 0) return alert("KH Ziel muss > 0 sein.");
      if (!Number.isFinite(fat) || fat <= 0) return alert("Fett Ziel muss > 0 sein.");

      state.goals = { kcal, protein, price, carbs, fat };
      saveState();
      closeModal();
      renderAll();
    });
  });
});

/* ===== SEARCH (tabs) ===== */
const ingredientsSearch = $("#ingredientsSearch");
const recipesSearch = $("#recipesSearch");

let ingredientsFilter = "";
let recipesFilter = "";

if (ingredientsSearch) {
  ingredientsSearch.addEventListener("input", () => {
    ingredientsFilter = (ingredientsSearch.value || "").trim().toLowerCase();
    renderIngredients();
  });
}
if (recipesSearch) {
  recipesSearch.addEventListener("input", () => {
    recipesFilter = (recipesSearch.value || "").trim().toLowerCase();
    renderRecipes();
  });
}

/* ===== Ingredients ===== */
const ingredientsList = $("#ingredientsList");
const ingredientsEmptyHint = $("#ingredientsEmptyHint");
const btnNewIngredient = $("#btnNewIngredient");

btnNewIngredient.addEventListener("click", () => openIngredientEditorModal(null));

function ingredientSummaryText(ing) {
  const brand = ing.brand ? `, ${ing.brand}` : "";
  const baseLine = `(${unitLabel(ing.unitType)})`;
  const detail = lineFull(ing.price, ing.kcal, ing.protein, ing.carbs, ing.fat);
  return `${ing.name}${brand} ${baseLine}\n${detail}`;
}

function openIngredientEditorModal(id) {
  const editingId = id;

  openModal(editingId ? "Zutat bearbeiten" : "Neue Zutat", (container) => {
    const form = document.createElement("form");
    form.className = "modalRow";

    const ing = editingId ? state.ingredients.find(x => x.id === editingId) : null;

    form.innerHTML = `
      <label class="field">
        <span>Name</span>
        <input type="text" id="mIngName" required placeholder="z.B. Haferflocken" />
      </label>

      <label class="field">
        <span>Marke oder Hersteller</span>
        <input type="text" id="mIngBrand" placeholder="z.B. Hofer" />
      </label>

      <label class="field">
        <span>Angaben pro</span>
        <select id="mIngUnitType">
          <option value="100g">100 g</option>
          <option value="100ml">100 ml</option>
          <option value="piece">Stück</option>
        </select>
      </label>

      <div class="grid2">
        <label class="field">
          <span>kcal</span>
          <input type="text" inputmode="decimal" id="mIngKcal" required placeholder="z.B. 389" />
        </label>
        <label class="field">
          <span>Protein (g)</span>
          <input type="text" inputmode="decimal" id="mIngProtein" required placeholder="z.B. 13" />
        </label>
        <label class="field">
          <span>Kohlenhydrate (g)</span>
          <input type="text" inputmode="decimal" id="mIngCarbs" required placeholder="z.B. 66" />
        </label>
        <label class="field">
          <span>Fett (g)</span>
          <input type="text" inputmode="decimal" id="mIngFat" required placeholder="z.B. 7" />
        </label>
      </div>

      <label class="field">
        <span>Preis (Euro) pro Basis</span>
        <input type="text" inputmode="decimal" id="mIngPrice" required placeholder="z.B. 0,19" />
      </label>

      <div class="row wrap">
        <button class="btn btn--big" type="submit">Speichern</button>
        ${editingId ? `<button class="btn btn--danger btn--big" type="button" id="mIngDelete">Löschen</button>` : ``}
      </div>

      <div class="divider"></div>
      <div class="summaryBox" id="mIngSummary"></div>
    `;

    container.appendChild(form);

    const nameEl = form.querySelector("#mIngName");
    const brandEl = form.querySelector("#mIngBrand");
    const unitEl = form.querySelector("#mIngUnitType");
    const kcalEl = form.querySelector("#mIngKcal");
    const protEl = form.querySelector("#mIngProtein");
    const carbsEl = form.querySelector("#mIngCarbs");
    const fatEl = form.querySelector("#mIngFat");
    const priceEl = form.querySelector("#mIngPrice");
    const summaryEl = form.querySelector("#mIngSummary");

    if (ing) {
      nameEl.value = ing.name ?? "";
      brandEl.value = ing.brand ?? "";
      unitEl.value = ing.unitType ?? "100g";
      kcalEl.value = String(ing.kcal ?? "");
      protEl.value = String(ing.protein ?? "");
      carbsEl.value = String(ing.carbs ?? "");
      fatEl.value = String(ing.fat ?? "");
      priceEl.value = String(ing.price ?? "");
      summaryEl.textContent = ingredientSummaryText(ing);
    } else {
      summaryEl.textContent = "";
    }

    function updateSummary() {
      const tmp = {
        name: nameEl.value.trim(),
        brand: brandEl.value.trim(),
        unitType: unitEl.value,
        kcal: parseNumber(kcalEl.value) || 0,
        protein: parseNumber(protEl.value) || 0,
        carbs: parseNumber(carbsEl.value) || 0,
        fat: parseNumber(fatEl.value) || 0,
        price: parseNumber(priceEl.value) || 0
      };
      if (!tmp.name) {
        summaryEl.textContent = "";
        return;
      }
      summaryEl.textContent = ingredientSummaryText(tmp);
    }

    [nameEl, brandEl, unitEl, kcalEl, protEl, carbsEl, fatEl, priceEl].forEach(el => {
      el.addEventListener("input", updateSummary);
      el.addEventListener("change", updateSummary);
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const name = nameEl.value.trim();
      const brand = brandEl.value.trim();
      const unitType = unitEl.value;

      const kcal = parseNumber(kcalEl.value);
      const protein = parseNumber(protEl.value);
      const carbs = parseNumber(carbsEl.value);
      const fat = parseNumber(fatEl.value);
      const price = parseNumber(priceEl.value);

      if (!name) return alert("Name fehlt.");
      if (!["100g", "100ml", "piece"].includes(unitType)) return alert("Ungültige Einheit.");

      for (const [label, val] of [["kcal", kcal], ["Protein", protein], ["KH", carbs], ["Fett", fat], ["Preis", price]]) {
        if (!Number.isFinite(val) || val < 0) return alert(`${label} muss eine Zahl >= 0 sein.`);
      }

      if (editingId) {
        const target = state.ingredients.find(x => x.id === editingId);
        if (!target) return;
        target.name = name;
        target.brand = brand;
        target.unitType = unitType;
        target.kcal = kcal;
        target.protein = protein;
        target.carbs = carbs;
        target.fat = fat;
        target.price = price;
      } else {
        state.ingredients.push({ id: uid(), name, brand, unitType, kcal, protein, carbs, fat, price });
      }

      saveState();
      closeModal();
      renderAll();
    });

    const delBtn = form.querySelector("#mIngDelete");
    if (delBtn) {
      delBtn.addEventListener("click", () => {
        const target = state.ingredients.find(x => x.id === editingId);
        if (!target) return;

        const usedInRecipes = state.recipes.some(r => r.items.some(it => it.ingredientId === target.id));
        if (usedInRecipes) {
          alert("Diese Zutat ist in einem Gericht enthalten. Entferne sie zuerst aus den Gerichten.");
          return;
        }

        // We keep dayLogs entries as-is, but rendering ignores missing ingredient IDs.
        state.ingredients = state.ingredients.filter(x => x.id !== target.id);

        saveState();
        closeModal();
        renderAll();
      });
    }
  });
}

/* ===== Recipes ===== */
const recipesList = $("#recipesList");
const recipesEmptyHint = $("#recipesEmptyHint");
const btnNewRecipe = $("#btnNewRecipe");

let editingRecipeId = null;

btnNewRecipe.addEventListener("click", () => openRecipeEditorModal(null));

function resetRecipeDraft() {
  window.__recipeDraft = { id: "__draft", name: "", items: [] };
}
resetRecipeDraft();

function openRecipeEditorModal(id, keepDraft = false) {
  editingRecipeId = id;

  if (!keepDraft) {
    if (id) {
      const r = state.recipes.find(x => x.id === id);
      window.__recipeDraft = { id: r.id, name: r.name, items: r.items.map(x => ({ ...x })) };
    } else {
      resetRecipeDraft();
    }
  }

  openModal(id ? "Gericht bearbeiten" : "Neues Gericht", (container) => {
    const form = document.createElement("form");
    form.className = "modalRow";

    form.innerHTML = `
      <label class="field">
        <span>Name</span>
        <input type="text" id="mRecipeName" placeholder="z.B. Hafer Bowl" required />
      </label>

      <div class="row row--space row--stackMobile">
        <div class="h3">Zutaten</div>
        <button class="btn btn--ghost btn--big" type="button" id="mAddIngredientToRecipe">Zutat hinzufügen</button>
      </div>

      <div id="mRecipeIngredients" class="list"></div>
      <div class="hint" id="mRecipeIngredientsHint">Noch keine Zutaten im Gericht.</div>

      <div class="row wrap">
        <button class="btn btn--big" type="submit">Speichern</button>
        ${id ? `<button class="btn btn--danger btn--big" type="button" id="mDeleteRecipe">Löschen</button>` : ``}
      </div>

      <div class="divider"></div>
      <div class="summaryBox" id="mRecipeSummary"></div>
    `;

    container.appendChild(form);

    const nameEl = form.querySelector("#mRecipeName");
    nameEl.value = window.__recipeDraft.name || "";

    nameEl.addEventListener("input", () => {
      window.__recipeDraft.name = nameEl.value;
    });

    const listEl = form.querySelector("#mRecipeIngredients");
    const hintEl = form.querySelector("#mRecipeIngredientsHint");
    const summaryEl = form.querySelector("#mRecipeSummary");

    function renderRecipeEditorIngredientsInModal() {
      const r = window.__recipeDraft;
      listEl.innerHTML = "";

      if (!r.items || r.items.length === 0) {
        hintEl.classList.remove("hidden");
        summaryEl.textContent = "Noch keine Zutaten, keine Berechnung.";
        return;
      }
      hintEl.classList.add("hidden");

      r.items.forEach((it, idx) => {
        const ing = state.ingredients.find(x => x.id === it.ingredientId);

        const row = document.createElement("div");
        row.className = "item";
        row.style.cursor = "default";

        if (!ing) {
          row.innerHTML = `
            <div class="item__top">
              <div>
                <div class="item__title">Unbekannte Zutat</div>
                <div class="item__sub">Nicht gefunden</div>
              </div>
              <div class="item__right">${escapeHtml(String(it.amount))}</div>
            </div>
          `;
        } else {
          const a = calcIngredientTotals(ing, it.amount);
          row.innerHTML = `
            <div class="item__top">
              <div>
                <div class="item__title">${escapeHtml(ing.name)}</div>
                <div class="item__sub">${escapeHtml(ing.brand || unitLabel(ing.unitType))}</div>
              </div>
              <div class="item__right">${escapeHtml(amountLabel(ing.unitType, it.amount))}</div>
            </div>
            <div class="item__sub">${escapeHtml(lineFull(a.price, a.kcal, a.protein, a.carbs, a.fat))}</div>
          `;
        }

        const actions = document.createElement("div");
        actions.className = "row";
        actions.style.marginTop = "8px";

        const btnRemove = document.createElement("button");
        btnRemove.className = "btn btn--danger";
        btnRemove.type = "button";
        btnRemove.textContent = "Entfernen";
        btnRemove.addEventListener("click", () => {
          window.__recipeDraft.items.splice(idx, 1);
          renderRecipeEditorIngredientsInModal();
        });

        actions.appendChild(btnRemove);
        row.appendChild(actions);
        listEl.appendChild(row);
      });

      const tempRecipe = { id: r.id, name: r.name || "", items: r.items };
      const t = calcRecipeTotals(tempRecipe);
      summaryEl.textContent = `Summe Gericht:\n${lineFull(t.price, t.kcal, t.protein, t.carbs, t.fat)}`;
    }

    renderRecipeEditorIngredientsInModal();

    const addBtn = form.querySelector("#mAddIngredientToRecipe");
    addBtn.addEventListener("click", () => {
      if (state.ingredients.length === 0) {
alert(t("needIngredientsFirst"));
        return;
      }

      window.__recipeDraft.name = nameEl.value;

      openIngredientPickerForRecipe(() => {
        openRecipeEditorModal(editingRecipeId, true);
      });
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const name = nameEl.value.trim();
      if (!name) return alert("Name fehlt.");

      const draft = window.__recipeDraft;
      draft.name = name;

      if (!draft.items || draft.items.length === 0) {
        alert("Füge mindestens eine Zutat hinzu.");
        return;
      }

      if (editingRecipeId) {
        const idx = state.recipes.findIndex(x => x.id === editingRecipeId);
        if (idx >= 0) state.recipes[idx] = { id: editingRecipeId, name: draft.name, items: draft.items };
      } else {
        state.recipes.push({ id: uid(), name: draft.name, items: draft.items });
        resetRecipeDraft();
      }

      saveState();
      closeModal();
      renderAll();
    });

    const delBtn = form.querySelector("#mDeleteRecipe");
    if (delBtn) {
      delBtn.addEventListener("click", () => {
        const r = state.recipes.find(x => x.id === editingRecipeId);
        if (!r) return;

        // Keep dayLogs entries; rendering ignores missing recipe IDs.
        state.recipes = state.recipes.filter(x => x.id !== r.id);

        saveState();
        closeModal();
        renderAll();
      });
    }
  });
}

function openIngredientPickerForRecipe(onDone) {
  openModal(t("addIngredient"), (container) => {

    const search = document.createElement("input");
    search.className = "searchInput";
search.placeholder = t("searchPlaceholder");
    search.inputMode = "search";
    container.appendChild(search);

    const list = document.createElement("div");
    list.className = "list";
    container.appendChild(list);

    function render(filter) {
      list.innerHTML = "";
      const f = (filter || "").toLowerCase();
      const items = state.ingredients
        .slice()
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        .filter(i => (i.name || "").toLowerCase().includes(f) || (i.brand || "").toLowerCase().includes(f));

      for (const ing of items) {
        const row = document.createElement("div");
        row.className = "modalRow";

        row.innerHTML = `
          <div class="row row--space">
            <div>
              <strong>${escapeHtml(ing.name)}</strong>
              <div class="item__sub">${escapeHtml(ing.brand || "")}</div>
            </div>
            <div class="item__right">${escapeHtml(unitLabel(ing.unitType))}</div>
          </div>
          <div class="item__sub">${escapeHtml(lineFull(ing.price, ing.kcal, ing.protein, ing.carbs, ing.fat))}</div>
        `;

        const amount = document.createElement("input");
        amount.className = "searchInput";
        amount.type = "text";
        amount.inputMode = "decimal";
        amount.placeholder = amountPlaceholder(ing.unitType);
        row.appendChild(amount);

        const btn = document.createElement("button");
        btn.className = "btn";
btn.textContent = t("addButtonToRecipe");
        btn.addEventListener("click", () => {
          const n = parseNumber(amount.value);
          if (!Number.isFinite(n) || n <= 0) {
            alert("Menge muss > 0 sein.");
            return;
          }
          window.__recipeDraft.items.push({ ingredientId: ing.id, amount: n });
          closeModal();
          if (typeof onDone === "function") onDone();
        });
        row.appendChild(btn);

        list.appendChild(row);
      }

      if (items.length === 0) {
        const h = document.createElement("div");
        h.className = "hint";
h.textContent = t("noHits");
        list.appendChild(h);
      }
    }

    search.addEventListener("input", () => render(search.value));
    render("");
  });
}

/* ===== Day UI: meal blocks overview + per-meal modal ===== */
const mealBlocks = $("#mealBlocks");
const dayEmptyHint = $("#dayEmptyHint");

const dayKcalValue = $("#dayKcalValue");
const dayKcalPct = $("#dayKcalPct");
const dayProteinValue = $("#dayProteinValue");
const dayProteinPct = $("#dayProteinPct");
const dayPriceValue = $("#dayPriceValue");
const dayPricePct = $("#dayPricePct");
const dayCarbsValue = $("#dayCarbsValue");
const dayCarbsPct = $("#dayCarbsPct");
const dayFatValue = $("#dayFatValue");
const dayFatPct = $("#dayFatPct");

function openMealModal(mealKey) {
  const meal = MEALS.find(m => m.key === mealKey);
const mealLabel = meal ? t(meal.labelKey) : t("entries");
const dateLabelText =
  (selectedDayKey === nowDayKeyRollover0430())
    ? t("today")
    : formatDateKeyGerman(selectedDayKey);

const title = `${mealLabel} · ${dateLabelText}`;

  openModal(title, (container) => {
    const actions = document.createElement("div");
    actions.className = "row wrap";
    actions.innerHTML = `
  <button class="btn btn--big" id="mAddIng">${escapeHtml(t("addIngredient"))}</button>
  <button class="btn btn--big" id="mAddRec">${escapeHtml(t("addRecipe"))}</button>
`;

    container.appendChild(actions);

    const list = document.createElement("div");
    list.className = "list";
    container.appendChild(list);

    const hint = document.createElement("div");
    hint.className = "hint";
hint.textContent = t("noEntries");
    container.appendChild(hint);

    function getVisibleEntriesForMeal() {
      const log = getDayLog(selectedDayKey) || [];
      return log.filter(e => normalizeEntryMeal(e) === mealKey);
    }

    function renderMealList() {
      list.innerHTML = "";
      const entries = getVisibleEntriesForMeal();

      // filter missing IDs: do not show them
      const visible = entries.filter(entry => {
        if (entry.type === "ingredient") {
          return state.ingredients.some(x => x.id === entry.refId);
        }
        return state.recipes.some(x => x.id === entry.refId);
      });

      hint.classList.toggle("hidden", visible.length > 0);

      for (const entry of visible) {
        let titleText = "";
        let subText = "";
        let price = 0;

        if (entry.type === "ingredient") {
          const ing = state.ingredients.find(x => x.id === entry.refId);
          if (!ing) continue;

          const a = calcIngredientTotals(ing, entry.amount);
          price = a.price;

          titleText = ing.name;
          subText = `${amountLabel(ing.unitType, entry.amount)} · ${lineFull(a.price, a.kcal, a.protein, a.carbs, a.fat)}`;
        } else {
          const r = state.recipes.find(x => x.id === entry.refId);
          if (!r) continue;

          const t = calcRecipeTotals(r);
          const f = entry.amount;

          price = t.price * f;

          titleText = r.name;
          subText = `Faktor ${f} · ${lineFull(price, t.kcal * f, t.protein * f, t.carbs * f, t.fat * f)}`;
        }

        const row = document.createElement("div");
        row.className = "item";
        row.style.cursor = "default";

        row.innerHTML = `
          <div class="item__top">
            <div>
              <div class="item__title">${escapeHtml(titleText)}</div>
              <div class="item__sub">${escapeHtml(subText)}</div>
            </div>
            <div class="item__right">${escapeHtml(euro(price))}</div>
          </div>
        `;

        const btnDel = document.createElement("button");
        btnDel.className = "btn btn--danger";
        btnDel.type = "button";
        btnDel.textContent = "Löschen";
        btnDel.addEventListener("click", () => {
          const log = getDayLog(selectedDayKey);
          state.dayLogs[selectedDayKey] = (log || []).filter(e => e.id !== entry.id);
          saveState();
          renderAll();
          renderMealList();
        });

        row.appendChild(btnDel);
        list.appendChild(row);
      }
    }

    renderMealList();

    const btnIng = actions.querySelector("#mAddIng");
    const btnRec = actions.querySelector("#mAddRec");

    btnIng.addEventListener("click", () => {
      if (state.ingredients.length === 0) {
        alert("Du brauchst zuerst Zutaten.");
        setTab("ingredients");
        closeModal();
        return;
      }
      openIngredientPickerForDay(mealKey, () => {
        renderAll();
        renderMealList();
      });
    });

    btnRec.addEventListener("click", () => {
      if (state.recipes.length === 0) {
alert(t("needRecipeFirst"));
        setTab("recipes");
        closeModal();
        return;
      }
      openRecipePickerForDay(mealKey, () => {
        renderAll();
        renderMealList();
      });
    });
  });
}

function openIngredientPickerForDay(mealKey, onDone) {
  openModal(t("addIngredient"), (container) => {
    const search = document.createElement("input");
    search.className = "searchInput";
search.placeholder = t("searchPlaceholder");
    search.inputMode = "search";
    container.appendChild(search);

    const list = document.createElement("div");
    list.className = "list";
    container.appendChild(list);

    function render(filter) {
      list.innerHTML = "";
      const f = (filter || "").toLowerCase();
      const items = state.ingredients
        .slice()
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        .filter(i => (i.name || "").toLowerCase().includes(f) || (i.brand || "").toLowerCase().includes(f));

      for (const ing of items) {
        const row = document.createElement("div");
        row.className = "modalRow";

        row.innerHTML = `
          <div class="row row--space">
            <div>
              <strong>${escapeHtml(ing.name)}</strong>
              <div class="item__sub">${escapeHtml(ing.brand || "")}</div>
            </div>
            <div class="item__right">${escapeHtml(unitLabel(ing.unitType))}</div>
          </div>
          <div class="item__sub">${escapeHtml(lineFull(ing.price, ing.kcal, ing.protein, ing.carbs, ing.fat))}</div>
        `;

        const amount = document.createElement("input");
        amount.className = "searchInput";
        amount.type = "text";
        amount.inputMode = "decimal";
        amount.placeholder = amountPlaceholder(ing.unitType);
        row.appendChild(amount);

        const btn = document.createElement("button");
        btn.className = "btn";
btn.textContent = t("addButton");
        btn.addEventListener("click", () => {
          const n = parseNumber(amount.value);
          if (!Number.isFinite(n) || n <= 0) {
            alert("Menge muss > 0 sein.");
            return;
          }

          getDayLog(selectedDayKey).push({
            id: uid(),
            type: "ingredient",
            refId: ing.id,
            amount: n,
            meal: mealKey
          });

          saveState();
          closeModal();
          if (typeof onDone === "function") onDone();
        });
        row.appendChild(btn);

        list.appendChild(row);
      }

      if (items.length === 0) {
        const h = document.createElement("div");
        h.className = "hint";
h.textContent = t("noHits");
        list.appendChild(h);
      }
    }

    search.addEventListener("input", () => render(search.value));
    render("");
  });
}

function openRecipePickerForDay(mealKey, onDone) {
  openModal(t("addRecipe"), (container) => {
    const search = document.createElement("input");
    search.className = "searchInput";
    search.placeholder = t("searchPlaceholder");
    search.inputMode = "search";
    container.appendChild(search);

    const list = document.createElement("div");
    list.className = "list";
    container.appendChild(list);

    function render(filter) {
      list.innerHTML = "";
      const f = (filter || "").toLowerCase();

      const items = state.recipes
        .slice()
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        .filter(r => (r.name || "").toLowerCase().includes(f));

      for (const r of items) {
        const row = document.createElement("div");
        row.className = "modalRow";

        const totals = calcRecipeTotals(r); // <-- NICHT "t" nennen!

        row.innerHTML = `
          <div class="row row--space">
            <div>
              <strong>${escapeHtml(r.name)}</strong>
              <div class="item__sub">${escapeHtml(lineFull(totals.price, totals.kcal, totals.protein, totals.carbs, totals.fat))}</div>
            </div>
            <div class="item__right">${escapeHtml(euro(totals.price))}</div>
          </div>
        `;

        const factor = document.createElement("input");
        factor.className = "searchInput";
        factor.type = "text";
        factor.inputMode = "decimal";
        factor.placeholder = (loadLanguage() === "en")
          ? "Amount as factor (1 normal, 0.5 half, 2 double)"
          : "Menge als Faktor (1 normal, 0,5 halb, 2 doppelt)";
        row.appendChild(factor);

        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = t("addButton");
        btn.addEventListener("click", () => {
          const n = parseNumber(factor.value);
          if (!Number.isFinite(n) || n <= 0) {
            alert((loadLanguage() === "en") ? "Factor must be > 0." : "Faktor muss > 0 sein.");
            return;
          }

          getDayLog(selectedDayKey).push({
            id: uid(),
            type: "recipe",
            refId: r.id,
            amount: n,
            meal: mealKey
          });

          saveState();
          closeModal();
          if (typeof onDone === "function") onDone();
        });
        row.appendChild(btn);

        list.appendChild(row);
      }

      if (items.length === 0) {
        const h = document.createElement("div");
        h.className = "hint";
        h.textContent = t("noHits");
        list.appendChild(h);
      }
    }

    search.addEventListener("input", () => render(search.value));
    render("");
  });
}


/* ===== Rendering ===== */
function renderAll() {
  // If time has moved to a new rollover day and selected is "today", keep it synced.
  const todayKey = nowDayKeyRollover0430();
  if (selectedDayKey === todayKeyFromLastRender && todayKey !== todayKeyFromLastRender) {
    selectedDayKey = todayKey;
  }

  renderDay();
  renderIngredients();
  renderRecipes();
  updateDateBar();

  todayKeyFromLastRender = todayKey;
}

let todayKeyFromLastRender = nowDayKeyRollover0430();

function getVisibleDayEntries(key) {
  const log = getDayLog(key) || [];

  // Skip entries whose refId no longer exists
  return log.filter(entry => {
    if (entry.type === "ingredient") {
      return state.ingredients.some(x => x.id === entry.refId);
    }
    return state.recipes.some(x => x.id === entry.refId);
  });
}

function calcTotalsForEntries(entries) {
  let totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, price: 0 };

  for (const entry of entries) {
    if (entry.type === "ingredient") {
      const ing = state.ingredients.find(x => x.id === entry.refId);
      if (!ing) continue;
      const a = calcIngredientTotals(ing, entry.amount);
      totals.kcal += a.kcal;
      totals.protein += a.protein;
      totals.carbs += a.carbs;
      totals.fat += a.fat;
      totals.price += a.price;
    } else {
      const r = state.recipes.find(x => x.id === entry.refId);
      if (!r) continue;
      const t = calcRecipeTotals(r);
      totals.kcal += t.kcal * entry.amount;
      totals.protein += t.protein * entry.amount;
      totals.carbs += t.carbs * entry.amount;
      totals.fat += t.fat * entry.amount;
      totals.price += t.price * entry.amount;
    }
  }

  return totals;
}

function pctOfGoal(value, goal) {
  if (!Number.isFinite(value) || !Number.isFinite(goal) || goal <= 0) return 0;
  return clampPct(Math.round((value / goal) * 100));
}

function eurosPer100gProtein(totals) {
  if (!totals || totals.protein <= 0) return NaN;
  return (totals.price / totals.protein) * 100;
}

function eurosPer100kcal(totals) {
  if (!totals || totals.kcal <= 0) return NaN;
  return (totals.price / totals.kcal) * 100;
}

function renderDay() {
  const visibleEntries = getVisibleDayEntries(selectedDayKey);

  // Day totals
  const dayTotals = calcTotalsForEntries(visibleEntries);

  // Day headline metrics
  dayKcalValue.textContent = String(Math.round(dayTotals.kcal));
  dayKcalPct.textContent = `${pctOfGoal(dayTotals.kcal, state.goals.kcal)}%`;

  dayProteinValue.textContent = `${round1(dayTotals.protein).replace(".", ",")}`;
  dayProteinPct.textContent = `${pctOfGoal(dayTotals.protein, state.goals.protein)}%`;

  dayPriceValue.textContent = euroPlain(dayTotals.price);
  dayPricePct.textContent = `${pctOfGoal(dayTotals.price, state.goals.price)}%`;

  dayCarbsValue.textContent = `${round1(dayTotals.carbs).replace(".", ",")}`;
  dayCarbsPct.textContent = `${pctOfGoal(dayTotals.carbs, state.goals.carbs)}%`;

  dayFatValue.textContent = `${round1(dayTotals.fat).replace(".", ",")}`;
  dayFatPct.textContent = `${pctOfGoal(dayTotals.fat, state.goals.fat)}%`;

  // Empty hint
const hasAny = visibleEntries.length > 0;
dayEmptyHint.textContent = t("noEntries");
dayEmptyHint.classList.toggle("hidden", hasAny);


// Fixed daily reference ratios (based on goals)
const dayRefP100prot = (state.goals.protein > 0)
  ? (state.goals.price / state.goals.protein) * 100
  : NaN;

const dayRefP100kcal = (state.goals.kcal > 0)
  ? (state.goals.price / state.goals.kcal) * 100
  : NaN;


  // Render meal blocks overview
  mealBlocks.innerHTML = "";

    // Render meal blocks overview
  mealBlocks.innerHTML = "";

  for (const meal of MEALS) {
    const mealEntries = visibleEntries.filter(e => normalizeEntryMeal(e) === meal.key);
    const totals = calcTotalsForEntries(mealEntries);

    const p100prot = eurosPer100gProtein(totals);
    const p100kcal = eurosPer100kcal(totals);

    const protPer100kcal = (totals.kcal > 0) ? (totals.protein / totals.kcal) * 100 : NaN;
const protPer100kcalText = Number.isFinite(protPer100kcal)
  ? `${round1(protPer100kcal).replace(".", ",")} g`
  : "n/a";


    const block = document.createElement("div");
    block.className = "mealBlock";
    block.addEventListener("click", () => openMealModal(meal.key));

    const priceText = euroPlain(totals.price);

    const kcalText = `${Math.round(totals.kcal)}`;
    const protText = `${round1(totals.protein).replace(".", ",")}`;
    const carbsText = `${round1(totals.carbs).replace(".", ",")}`;
    const fatText = `${round1(totals.fat).replace(".", ",")}`;

    const kcalPct = `${pctOfGoal(totals.kcal, state.goals.kcal)}%`;
    const protPct = `${pctOfGoal(totals.protein, state.goals.protein)}%`;
    const carbsPct = `${pctOfGoal(totals.carbs, state.goals.carbs)}%`;
    const fatPct = `${pctOfGoal(totals.fat, state.goals.fat)}%`;
    const pricePct = `${pctOfGoal(totals.price, state.goals.price)}%`;

    const p100protText = Number.isFinite(p100prot) ? euroPlain(p100prot) : "n/a";
    const p100kcalText = Number.isFinite(p100kcal) ? euroPlain(p100kcal) : "n/a";

        const refProtLabel = Number.isFinite(dayRefP100prot) ? ` (Ø ${euroPlain(dayRefP100prot)})` : "";
    const refKcalLabel = Number.isFinite(dayRefP100kcal) ? ` (Ø ${euroPlain(dayRefP100kcal)})` : "";


    const protColor = ratioColor(p100prot, dayRefP100prot);
    const kcalColor = ratioColor(p100kcal, dayRefP100kcal);

    block.innerHTML = `
      <div class="mealTop">
        <div class="mealTitle">${escapeHtml(t(meal.labelKey))}</div>
        <div class="mealPrice">${escapeHtml(priceText)} €</div>
      </div>

      <div class="mealGrid">
        <div class="mealLine">
          <div class="mealLineLabel">kcal</div>
          <div class="mealLineValue">${escapeHtml(kcalText)}</div>
          <div class="mealLinePct">${escapeHtml(kcalPct)}</div>
        </div>

        <div class="mealLine">
<div class="mealLineLabel">${escapeHtml(t("proteinLabel"))}</div>
          <div class="mealLineValue">${escapeHtml(protText)}</div>
          <div class="mealLinePct">${escapeHtml(protPct)}</div>
        </div>

        <div class="mealLine">
<div class="mealLineLabel">${escapeHtml(t("carbsLabel"))}</div>
          <div class="mealLineValue">${escapeHtml(carbsText)}</div>
          <div class="mealLinePct">${escapeHtml(carbsPct)}</div>
        </div>

        <div class="mealLine">
<div class="mealLineLabel">${escapeHtml(t("fatLabel"))}</div>
          <div class="mealLineValue">${escapeHtml(fatText)}</div>
          <div class="mealLinePct">${escapeHtml(fatPct)}</div>
        </div>
      </div>

      <div class="mealRatios">
        <div class="mealRatioRow">
                    <div class="mealRatioLabel">${escapeHtml(t("ratioProteinLabel") + refProtLabel)}</div>
          <div class="mealRatioValue" style="color:${escapeHtml(protColor)}">
            ${escapeHtml(p100protText)}
          </div>

        </div>

        <div class="mealRatioRow">
                    <div class="mealRatioLabel">${escapeHtml(t("ratioKcalLabel") + refKcalLabel)}</div>
          <div class="mealRatioValue" style="color:${escapeHtml(kcalColor)}">
            ${escapeHtml(p100kcalText)}
          </div>

        </div>

        <div class="mealRatioRow">
  <div class="mealRatioLabel">${escapeHtml(t("proteinPer100kcal"))}</div>
  <div class="mealRatioValue">${escapeHtml(protPer100kcalText)}</div>
</div>


        <div class="mealRatioRow">
<div class="mealRatioLabel">${escapeHtml(t("ratioPricePctLabel"))}</div>
          <div class="mealRatioValue">${escapeHtml(pricePct)}</div>
        </div>
      </div>
    `;

    mealBlocks.appendChild(block);
  }

}

/* ===== Ingredients tab render ===== */
function renderIngredients() {
  ingredientsList.innerHTML = "";

  const items = state.ingredients
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .filter(ing => {
      if (!ingredientsFilter) return true;
      const n = (ing.name || "").toLowerCase();
      const b = (ing.brand || "").toLowerCase();
      return n.includes(ingredientsFilter) || b.includes(ingredientsFilter);
    });

  if (items.length === 0) ingredientsEmptyHint.classList.remove("hidden");
  else ingredientsEmptyHint.classList.add("hidden");

  for (const ing of items) {
    const row = document.createElement("div");
    row.className = "item";
    row.addEventListener("click", () => openIngredientEditorModal(ing.id));

    const brand = ing.brand ? ing.brand : "";

    row.innerHTML = `
      <div class="item__top">
        <div>
          <div class="item__title">${escapeHtml(ing.name)}</div>
          <div class="item__sub">${escapeHtml(brand)}</div>
        </div>
        <div class="item__right">${escapeHtml(unitLabel(ing.unitType))}</div>
      </div>
      <div class="item__sub">${escapeHtml(lineFull(ing.price, ing.kcal, ing.protein, ing.carbs, ing.fat))}</div>
    `;

    ingredientsList.appendChild(row);
  }
}

/* ===== Recipes tab render ===== */
function renderRecipes() {
  recipesList.innerHTML = "";

  const items = state.recipes
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .filter(r => {
      if (!recipesFilter) return true;
      return (r.name || "").toLowerCase().includes(recipesFilter);
    });

  if (items.length === 0) recipesEmptyHint.classList.remove("hidden");
  else recipesEmptyHint.classList.add("hidden");

  for (const r of items) {
    const t = calcRecipeTotals(r);

    const row = document.createElement("div");
    row.className = "item";
    row.addEventListener("click", () => openRecipeEditorModal(r.id));

    row.innerHTML = `
      <div class="item__top">
        <div>
          <div class="item__title">${escapeHtml(r.name)}</div>
          <div class="item__sub">${r.items.length} Zutaten</div>
        </div>
        <div class="item__right">${escapeHtml(euro(t.price))}</div>
      </div>
      <div class="item__sub">${escapeHtml(lineFull(t.price, t.kcal, t.protein, t.carbs, t.fat))}</div>
    `;

    recipesList.appendChild(row);
  }
}

/* ===== Language (de/en) ===== */
const LANG_KEY = "kcal_tracker_lang"; // "de" | "en"

const I18N = {
  de: {

    kcalLabel: "kcal",
    proteinLabel: "Protein (g)",
    priceLabel: "Preis (€)",
    carbsLabel: "Kohlenhydrate (g)",
    fatLabel: "Fett (g)",
    dataLabel: "Daten",

    proteinPer100kcal: "Protein / 100 kcal",

    addIngredient: "Zutat hinzufügen",
    addRecipe: "Gericht hinzufügen",
    addButton: "Eintragen",
    addButtonRecipe: "Eintragen",
    addButtonToRecipe: "Hinzufügen",
    removeButton: "Entfernen",
    deleteButton: "Löschen",

    noEntries: "Noch keine Einträge.",
    noHits: "Keine Treffer.",
    searchPlaceholder: "Suchen...",

    ratioProteinLabel: "€ / 100 g Protein",
    ratioKcalLabel: "€ / 100 kcal",
    ratioPricePctLabel: "Preis % Tagesziel",

    today: "Heute",
    goals: "Ziele",
    dark: "Dark",
    light: "Light",

    tabDay: "Tag",
    tabRecipes: "Gerichte",
    tabIngredients: "Zutaten",

    recipesTitle: "Gerichte",
    newRecipe: "Neues Gericht",
    searchRecipes: "Gerichte suchen...",
    emptyRecipes: "Noch keine Gerichte.",

    ingredientsTitle: "Zutaten",
    newIngredient: "Neue Zutat",
    searchIngredients: "Zutaten suchen...",
    emptyIngredients: "Noch keine Zutaten.",

    modalClose: "Schließen",
    data: "Daten",
    export: "Export",
    import: "Import",

    // meals
    breakfast: "Frühstück",
    lunch: "Mittagessen",
    snacks: "Snacks",
    dinner: "Abendessen",

    // common strings (alerts)
    needIngredientsFirst: "Du brauchst zuerst Zutaten.",
    needRecipeFirst: "Du brauchst zuerst ein Gericht.",
    importFailed: "Import fehlgeschlagen. Bitte eine gültige Export JSON Datei wählen."
  },
  en: {

    kcalLabel: "kcal",
    proteinLabel: "Protein (g)",
    priceLabel: "Price (€)",
    carbsLabel: "Carbs (g)",
    fatLabel: "Fat (g)",
    dataLabel: "Data",

    proteinPer100kcal: "Protein per 100 kcal",

    addIngredient: "Add ingredient",
    addRecipe: "Add recipe",
    addButton: "Log",
    addButtonRecipe: "Log",
    addButtonToRecipe: "Add",
    removeButton: "Remove",
    deleteButton: "Delete",

    noEntries: "No entries yet.",
    noHits: "No results.",
    searchPlaceholder: "Search...",

    ratioProteinLabel: "€ / 100 g protein",
    ratioKcalLabel: "€ / 100 kcal",
    ratioPricePctLabel: "Price % daily goal",

    today: "Today",
    goals: "Goals",
    dark: "Dark",
    light: "Light",

    tabDay: "Day",
    tabRecipes: "Recipes",
    tabIngredients: "Ingredients",

    recipesTitle: "Recipes",
    newRecipe: "New recipe",
    searchRecipes: "Search recipes...",
    emptyRecipes: "No recipes yet.",

    ingredientsTitle: "Ingredients",
    newIngredient: "New ingredient",
    searchIngredients: "Search ingredients...",
    emptyIngredients: "No ingredients yet.",

    modalClose: "Close",
    data: "Data",
    export: "Export",
    import: "Import",

    breakfast: "Breakfast",
    lunch: "Lunch",
    snacks: "Snacks",
    dinner: "Dinner",

    needIngredientsFirst: "You need ingredients first.",
    needRecipeFirst: "You need a recipe first.",
    importFailed: "Import failed. Please select a valid export JSON file."
  }
};

function loadLanguage() {
  const l = localStorage.getItem(LANG_KEY);
  return (l === "de" || l === "en") ? l : "de";
}

function setLanguage(lang) {
  localStorage.setItem(LANG_KEY, lang);
  applyLanguage(lang);
}

function t(key) {
  const lang = loadLanguage();
  return (I18N[lang] && I18N[lang][key]) ? I18N[lang][key] : key;
}

function applyLanguage(lang) {
  // html lang attribute
  document.documentElement.lang = (lang === "en") ? "en" : "de";

  // Toggle buttons
  const bDe = document.querySelector("#btnLangDE");
  const bEn = document.querySelector("#btnLangEN");
  if (bDe) bDe.classList.toggle("langBtn--active", lang === "de");
  if (bEn) bEn.classList.toggle("langBtn--active", lang === "en");

  // Static UI texts (by ids)
  const elGoals = document.querySelector("#btnOpenGoals");
  if (elGoals) elGoals.textContent = t("goals");

  const elDark = document.querySelector("#btnThemeDark");
  const elLight = document.querySelector("#btnThemeLight");
  if (elDark) elDark.textContent = t("dark");
  if (elLight) elLight.textContent = t("light");

  const elExport = document.querySelector("#btnExport");
  const elImport = document.querySelector("#btnImport");
  if (elExport) elExport.textContent = t("export");
  if (elImport) elImport.textContent = t("import");

  const elModalClose = document.querySelector("#modalClose");
  if (elModalClose) elModalClose.textContent = t("modalClose");

  // Tab buttons (bottom nav)
  const tabBtns = Array.from(document.querySelectorAll(".tabBtn"));
  tabBtns.forEach(btn => {
    const nav = btn.dataset.nav;
    if (nav === "day") btn.textContent = t("tabDay");
    if (nav === "recipes") btn.textContent = t("tabRecipes");
    if (nav === "ingredients") btn.textContent = t("tabIngredients");
  });

  // Titles and placeholders
  const recipesTitle = document.querySelector("#tab-recipes .h2");
  if (recipesTitle) recipesTitle.textContent = t("recipesTitle");
  const ingredientsTitle = document.querySelector("#tab-ingredients .h2");
  if (ingredientsTitle) ingredientsTitle.textContent = t("ingredientsTitle");

  const btnNewRecipe = document.querySelector("#btnNewRecipe");
  if (btnNewRecipe) btnNewRecipe.textContent = t("newRecipe");
  const btnNewIngredient = document.querySelector("#btnNewIngredient");
  if (btnNewIngredient) btnNewIngredient.textContent = t("newIngredient");

  const recipesSearch = document.querySelector("#recipesSearch");
  if (recipesSearch) recipesSearch.placeholder = t("searchRecipes");
  const ingredientsSearch = document.querySelector("#ingredientsSearch");
  if (ingredientsSearch) ingredientsSearch.placeholder = t("searchIngredients");

  const recipesEmpty = document.querySelector("#recipesEmptyHint");
  if (recipesEmpty) recipesEmpty.textContent = t("emptyRecipes");
  const ingredientsEmpty = document.querySelector("#ingredientsEmptyHint");
  if (ingredientsEmpty) ingredientsEmpty.textContent = t("emptyIngredients");


    const lblKcal = document.querySelector("#lblKcal");
  if (lblKcal) lblKcal.textContent = t("kcalLabel");

  const lblProtein = document.querySelector("#lblProtein");
  if (lblProtein) lblProtein.textContent = t("proteinLabel");

  const lblPrice = document.querySelector("#lblPrice");
  if (lblPrice) lblPrice.textContent = t("priceLabel");

  const lblCarbs = document.querySelector("#lblCarbs");
  if (lblCarbs) lblCarbs.textContent = t("carbsLabel");

  const lblFat = document.querySelector("#lblFat");
  if (lblFat) lblFat.textContent = t("fatLabel");

  const lblData = document.querySelector("#lblData");
  if (lblData) lblData.textContent = t("dataLabel");


  // Rerender dynamic parts (meal labels etc.)
  renderAll();
}


/* ===== Theme toggle (dark/light) ===== */
const THEME_KEY = "kcal_tracker_theme"; // "dark" | "light"

function applyTheme(theme) {
  const isLight = theme === "light";

  document.documentElement.classList.toggle("theme--light", isLight);
  document.body.classList.toggle("theme--light", isLight); // wichtig, wenn CSS body:not(...)

  const bDark = document.querySelector("#btnThemeDark");
  const bLight = document.querySelector("#btnThemeLight");
  if (bDark) bDark.classList.toggle("themeBtn--active", !isLight);
  if (bLight) bLight.classList.toggle("themeBtn--active", isLight);
}



function loadTheme() {
  const t = localStorage.getItem(THEME_KEY);
  return (t === "light" || t === "dark") ? t : "dark";
}

function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

/* init theme */
applyTheme(loadTheme());

applyLanguage(loadLanguage());


/* wire buttons */
const btnThemeDark = document.querySelector("#btnThemeDark");
const btnThemeLight = document.querySelector("#btnThemeLight");

if (btnThemeDark) btnThemeDark.addEventListener("click", () => setTheme("dark"));
if (btnThemeLight) btnThemeLight.addEventListener("click", () => setTheme("light"));

const btnLangDE = document.querySelector("#btnLangDE");
const btnLangEN = document.querySelector("#btnLangEN");

if (btnLangDE) btnLangDE.addEventListener("click", () => setLanguage("de"));
if (btnLangEN) btnLangEN.addEventListener("click", () => setLanguage("en"));


/* ===== Initial ===== */
renderAll();
setTab("day");

