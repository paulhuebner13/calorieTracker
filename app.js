"use strict";

console.log("app.js loaded");


const LS_KEY = "kcal_tracker_v3";

/*
  State:
  - ingredients: { id, name, brand, unitType, kcal, protein, carbs, fat, price }  (per base)
  - recipes: { id, name, items: [{ ingredientId, amount }] }                     (amount in g/ml/pieces)
  - dayLogs: { [dateKey]: [{ id, type, refId?, amount?, meal?, name?, kcal?, protein?, carbs?, fat?, price? }] }
  - goals: { kcal, protein, price, carbs, fat }
  - goalRelevant: { kcal, protein, price, carbs, fat } (booleans for daily completion)
  - supplements: [{ id, name, amount, unit, relevant }]
  - supplementLogs: { [dateKey]: [supplementId, ...] }

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

const GOAL_KEYS = ["kcal", "protein", "price", "carbs", "fat"];
const DEFAULT_GOALS = { kcal: 2500, protein: 160, price: 15, carbs: 300, fat: 80 };
const DEFAULT_GOAL_RELEVANT = { kcal: true, protein: true, price: true, carbs: true, fat: true };


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

  const protPer100kcal = (kcal > 0) ? (protein / kcal) * 100 : NaN;

  // Reference values from DAILY GOALS (computed "average" target)
  const refP100prot = (state?.goals?.protein > 0) ? (state.goals.price / state.goals.protein) * 100 : NaN;
  const refP100kcal = (state?.goals?.kcal > 0) ? (state.goals.price / state.goals.kcal) * 100 : NaN;
  const refProtPer100kcal = (state?.goals?.kcal > 0) ? (state.goals.protein / state.goals.kcal) * 100 : NaN;

  const a = Number.isFinite(p100prot) ? euroPlain(p100prot) : "n/a";
  const b = Number.isFinite(p100kcal) ? euroPlain(p100kcal) : "n/a";

  const aRef = Number.isFinite(refP100prot) ? ` (Ø ${euroPlain(refP100prot)})` : "";
  const bRef = Number.isFinite(refP100kcal) ? ` (Ø ${euroPlain(refP100kcal)})` : "";

  const c = Number.isFinite(protPer100kcal)
    ? `${round1(protPer100kcal).replace(".", ",")} g`
    : "n/a";

  const cRef = Number.isFinite(refProtPer100kcal)
    ? ` (Ø ${round1(refProtPer100kcal).replace(".", ",")} g)`
    : "";

  return `· € / 100 g Protein ${a}${aRef} · € / 100 kcal ${b}${bRef} · ${t("proteinPer100kcal")} ${c}${cRef}`;
}




function lineFull(price, kcal, protein, carbs, fat) {
  return `Preis ${euro(price)} · kcal ${Math.round(kcal)} · Protein ${round1(protein).replace(".", ",")} g · KH ${round1(carbs).replace(".", ",")} g · Fett ${round1(fat).replace(".", ",")} g ${ratiosText(price, kcal, protein)}`;
}

function pickerStatsHtml(price, kcal, protein, carbs, fat) {
  return `
    <div class="pickerStats">
      <div class="pickerStat pickerStat--price"><div class="pickerStat__label">${escapeHtml(t("priceLabel"))}</div><div class="pickerStat__value">${escapeHtml(euro(price))}</div></div>
      <div class="pickerStat itemStat--kcal"><div class="pickerStat__label">kcal</div><div class="pickerStat__value">${escapeHtml(String(Math.round(kcal)))}</div></div>
      <div class="pickerStat itemStat--protein"><div class="pickerStat__label">${escapeHtml(t("proteinLabel"))}</div><div class="pickerStat__value">${escapeHtml(round1(protein).replace(".", ","))} g</div></div>
      <div class="pickerStat itemStat--carbs"><div class="pickerStat__label">${escapeHtml(t("carbsLabel"))}</div><div class="pickerStat__value">${escapeHtml(round1(carbs).replace(".", ","))} g</div></div>
      <div class="pickerStat itemStat--fat"><div class="pickerStat__label">${escapeHtml(t("fatLabel"))}</div><div class="pickerStat__value">${escapeHtml(round1(fat).replace(".", ","))} g</div></div>
    </div>
  `;
}

function itemStatsHtml(price, kcal, protein, carbs, fat) {
  const p100prot = metricP100prot(price, protein);
  const p100kcal = metricP100kcal(price, kcal);
  const protPer100kcal = metricProtPer100kcal(protein, kcal);

  const refP100prot = metricP100prot(state?.goals?.price, state?.goals?.protein);
  const refP100kcal = metricP100kcal(state?.goals?.price, state?.goals?.kcal);
  const refProtPer100kcal = metricProtPer100kcal(state?.goals?.protein, state?.goals?.kcal);

  const ratioValue = (value, digits = 2, suffix = "") => {
    if (!Number.isFinite(value)) return "n/a";
    const text = digits === 1 ? round1(value) : round2(value);
    return `${text.replace(".", ",")}${suffix}`;
  };

  const reference = (value, digits = 2, suffix = "") => {
    if (!Number.isFinite(value)) return "";
    const text = digits === 1 ? round1(value) : round2(value);
    return `<div class="itemStat__reference">Ø ${escapeHtml(text.replace(".", ",") + suffix)}</div>`;
  };

  const p100protColor = ratioColor(p100prot, refP100prot);
  const p100kcalColor = ratioColor(p100kcal, refP100kcal);
  const protPer100kcalColor = ratioColor(refProtPer100kcal, protPer100kcal);

  return `
    <div class="itemStats itemStats--main">
      <div class="itemStat itemStat--kcal"><div class="itemStat__label">kcal</div><div class="itemStat__value">${escapeHtml(String(Math.round(kcal)))}</div></div>
      <div class="itemStat itemStat--protein"><div class="itemStat__label">${escapeHtml(t("proteinLabel"))}</div><div class="itemStat__value">${escapeHtml(round1(protein).replace(".", ","))} g</div></div>
      <div class="itemStat itemStat--carbs"><div class="itemStat__label">${escapeHtml(t("carbsLabel"))}</div><div class="itemStat__value">${escapeHtml(round1(carbs).replace(".", ","))} g</div></div>
      <div class="itemStat itemStat--fat"><div class="itemStat__label">${escapeHtml(t("fatLabel"))}</div><div class="itemStat__value">${escapeHtml(round1(fat).replace(".", ","))} g</div></div>
    </div>
    <div class="itemStats itemStats--ratios">
      <div class="itemStat"><div class="itemStat__label">${escapeHtml(t("ratioProteinLabel"))}</div><div class="itemStat__value" style="color:${escapeHtml(p100protColor)}">${escapeHtml(ratioValue(p100prot))}</div>${reference(refP100prot)}</div>
      <div class="itemStat"><div class="itemStat__label">${escapeHtml(t("ratioKcalLabel"))}</div><div class="itemStat__value" style="color:${escapeHtml(p100kcalColor)}">${escapeHtml(ratioValue(p100kcal))}</div>${reference(refP100kcal)}</div>
      <div class="itemStat"><div class="itemStat__label">${escapeHtml(t("proteinPer100kcal"))}</div><div class="itemStat__value" style="color:${escapeHtml(protPer100kcalColor)}">${escapeHtml(ratioValue(protPer100kcal, 1, " g"))}</div>${reference(refProtPer100kcal, 1, " g")}</div>
    </div>
  `;
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
function normalizeStateObject(s) {
  const obj = (s && typeof s === "object") ? s : {};
  if (!Array.isArray(obj.ingredients)) obj.ingredients = [];
  if (!Array.isArray(obj.recipes)) obj.recipes = [];
  if (!obj.dayLogs || typeof obj.dayLogs !== "object") obj.dayLogs = {};
  if (!obj.goals || typeof obj.goals !== "object") obj.goals = { ...DEFAULT_GOALS };

  for (const key of GOAL_KEYS) {
    obj.goals[key] = Number.isFinite(obj.goals[key]) ? obj.goals[key] : DEFAULT_GOALS[key];
  }

  if (!obj.goalRelevant || typeof obj.goalRelevant !== "object") obj.goalRelevant = { ...DEFAULT_GOAL_RELEVANT };
  for (const key of GOAL_KEYS) {
    obj.goalRelevant[key] = (typeof obj.goalRelevant[key] === "boolean") ? obj.goalRelevant[key] : DEFAULT_GOAL_RELEVANT[key];
  }

  if (!Array.isArray(obj.supplements)) obj.supplements = [];
  obj.supplements = obj.supplements.map(sup => {
    const todayKey = nowDayKeyRollover0430();
    const createdOn = /^\d{4}-\d{2}-\d{2}$/.test(String(sup?.createdOn || ""))
      ? String(sup.createdOn)
      : todayKey;
    const relevant = Boolean(sup?.relevant);

    let relevancePeriods = Array.isArray(sup?.relevancePeriods)
      ? sup.relevancePeriods.map(period => ({
          from: /^\d{4}-\d{2}-\d{2}$/.test(String(period?.from || "")) ? String(period.from) : null,
          to: /^\d{4}-\d{2}-\d{2}$/.test(String(period?.to || "")) ? String(period.to) : null
        })).filter(period => period.from)
      : [];

    // Backward compatibility for supplements created with v8:
    // a relevant supplement starts counting only from the day it was created.
    if (relevancePeriods.length === 0 && relevant) {
      relevancePeriods = [{ from: createdOn, to: null }];
    }

    return {
      id: sup?.id || uid(),
      name: String(sup?.name || "").trim(),
      amount: Number.isFinite(Number(sup?.amount)) ? Number(sup.amount) : 1,
      unit: sup?.unit === "g" ? "g" : "piece",
      relevant,
      createdOn,
      relevancePeriods
    };
  }).filter(sup => sup.name);

  if (!obj.supplementLogs || typeof obj.supplementLogs !== "object") obj.supplementLogs = {};
  for (const [key, ids] of Object.entries(obj.supplementLogs)) {
    obj.supplementLogs[key] = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
  }

  return obj;
}

function loadState() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) {
    return normalizeStateObject({
      ingredients: [], recipes: [], dayLogs: {}, goals: { ...DEFAULT_GOALS },
      goalRelevant: { ...DEFAULT_GOAL_RELEVANT }, supplements: [], supplementLogs: {}
    });
  }

  try {
    return normalizeStateObject(JSON.parse(raw));
  } catch {
    return normalizeStateObject({
      ingredients: [], recipes: [], dayLogs: {}, goals: { ...DEFAULT_GOALS },
      goalRelevant: { ...DEFAULT_GOAL_RELEVANT }, supplements: [], supplementLogs: {}
    });
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


function getSupplementLog(key) {
  if (!state.supplementLogs[key]) state.supplementLogs[key] = [];
  return state.supplementLogs[key];
}

function isSupplementTaken(supplementId, key = selectedDayKey) {
  const ids = state.supplementLogs?.[key];
  return Array.isArray(ids) && ids.includes(String(supplementId));
}

function toggleSupplementTaken(supplementId, key = selectedDayKey) {
  const id = String(supplementId);
  const current = getSupplementLog(key);
  state.supplementLogs[key] = current.includes(id)
    ? current.filter(x => x !== id)
    : [...current, id];
  saveState();
}

function supplementAmountText(sup) {
  const amount = Number(sup.amount) || 0;
  const clean = String(Math.round(amount * 100) / 100).replace(".", ",");
  if (sup.unit === "g") return `${clean} g`;
  if (loadLanguage() === "en") return `${clean} ${Math.abs(amount - 1) < 0.0001 ? "piece" : "pieces"}`;
  return `${clean} Stück`;
}

function previousDayKey(key) {
  return dayKeyFromDate(addDays(dateFromDayKey(key), -1));
}

function isSupplementRelevantOn(sup, key) {
  const periods = Array.isArray(sup?.relevancePeriods) ? sup.relevancePeriods : [];
  return periods.some(period => {
    if (!period?.from || period.from > key) return false;
    return !period.to || key <= period.to;
  });
}

function updateSupplementRelevance(sup, nextRelevant, effectiveKey = nowDayKeyRollover0430()) {
  const currentRelevant = Boolean(sup.relevant);
  const next = Boolean(nextRelevant);
  if (currentRelevant === next) return;

  if (!Array.isArray(sup.relevancePeriods)) sup.relevancePeriods = [];

  if (next) {
    sup.relevancePeriods.push({ from: effectiveKey, to: null });
  } else {
    const openIndex = [...sup.relevancePeriods].map((period, index) => ({ period, index }))
      .reverse()
      .find(x => !x.period.to)?.index;

    if (Number.isInteger(openIndex)) {
      const open = sup.relevancePeriods[openIndex];
      const to = previousDayKey(effectiveKey);
      if (to < open.from) {
        sup.relevancePeriods.splice(openIndex, 1);
      } else {
        open.to = to;
      }
    }
  }

  sup.relevant = next;
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

function syncBottomAreaHeight() {
  const bottomArea = document.querySelector(".bottomArea");
  if (!bottomArea) return;
  const h = Math.ceil(bottomArea.getBoundingClientRect().height);
  if (h > 0) document.documentElement.style.setProperty("--bottom-area-height", `${h}px`);
}

window.addEventListener("resize", syncBottomAreaHeight);
window.addEventListener("orientationchange", syncBottomAreaHeight);
requestAnimationFrame(syncBottomAreaHeight);

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
  requestAnimationFrame(syncBottomAreaHeight);
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
const btnCalendar = $("#btnCalendar");
const dateLabel = $("#dateLabel");

function getStoredDayKeysSorted() {
  const keys = new Set([
    ...Object.keys(state.dayLogs || {}),
    ...Object.keys(state.supplementLogs || {})
  ]);
  return [...keys].sort();
}

function getOldestStoredDayKeyOrNull() {
  const keys = getStoredDayKeysSorted().filter(k => {
    const food = state.dayLogs?.[k];
    const supplements = state.supplementLogs?.[k];
    return (Array.isArray(food) && food.length > 0) || (Array.isArray(supplements) && supplements.length > 0);
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


function startOfWeekMonday(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

function endOfWeekSunday(date) {
  return addDays(startOfWeekMonday(date), 6);
}

function calendarDayStatus(key) {
  const todayKey = nowDayKeyRollover0430();
  if (key > todayKey) return "future";
  if (key === todayKey) return isDayGoalAchieved(key) ? "achieved" : "today-open";
  return isDayGoalAchieved(key) ? "achieved" : "missed";
}

function formatShortDay(d) {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

function weekNumberISO(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function openCalendarModal() {
  openModal(t("calendarTitle"), (container) => {
    const legend = document.createElement("div");
    legend.className = "calendarLegend";
    legend.innerHTML = `
      <span><i class="calendarDot calendarDot--achieved"></i>${escapeHtml(t("calendarAchieved"))}</span>
      <span><i class="calendarDot calendarDot--missed"></i>${escapeHtml(t("calendarMissed"))}</span>
      <span><i class="calendarDot calendarDot--today"></i>${escapeHtml(t("calendarTodayOpen"))}</span>
      <span><i class="calendarDot calendarDot--future"></i>${escapeHtml(t("calendarFuture"))}</span>
    `;
    container.appendChild(legend);

    const scroll = document.createElement("div");
    scroll.className = "calendarScroll";
    container.appendChild(scroll);

    const today = dateFromDayKey(nowDayKeyRollover0430());
    const storedKeys = getStoredDayKeysSorted();
    const storedYears = storedKeys.map(k => Number(String(k).slice(0, 4))).filter(Number.isFinite);
    const firstYear = storedYears.length ? Math.min(today.getFullYear(), ...storedYears) : today.getFullYear();
    const start = startOfWeekMonday(new Date(firstYear, 0, 1));
    const end = endOfWeekSunday(new Date(today.getFullYear(), 11, 31));
    const currentWeekKey = dayKeyFromDate(startOfWeekMonday(today));

    const weekdayLabels = loadLanguage() === "en"
      ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      : ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

    for (let weekStart = new Date(start); weekStart <= end; weekStart = addDays(weekStart, 7)) {
      const week = document.createElement("div");
      const weekKey = dayKeyFromDate(weekStart);
      week.className = "calendarWeek" + (weekKey === currentWeekKey ? " calendarWeek--current" : "");

      const weekEnd = addDays(weekStart, 6);
      week.innerHTML = `<div class="calendarWeek__title">${escapeHtml(t("weekShort"))} ${weekNumberISO(weekStart)} · ${formatShortDay(weekStart)}–${formatShortDay(weekEnd)}</div>`;
      const days = document.createElement("div");
      days.className = "calendarDays";

      for (let i = 0; i < 7; i++) {
        const d = addDays(weekStart, i);
        const key = dayKeyFromDate(d);
        const status = calendarDayStatus(key);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `calendarDay calendarDay--${status}` + (key === selectedDayKey ? " calendarDay--selected" : "");
        btn.disabled = status === "future";
        btn.innerHTML = `<span class="calendarDay__weekday">${weekdayLabels[i]}</span><span class="calendarDay__date">${d.getDate()}</span>`;
        if (!btn.disabled) {
          btn.addEventListener("click", () => {
            selectedDayKey = key;
            closeModal();
            setTab("day");
            renderAll();
          });
        }
        days.appendChild(btn);
      }
      week.appendChild(days);
      scroll.appendChild(week);
    }

    requestAnimationFrame(() => {
      const current = scroll.querySelector(".calendarWeek--current");
      if (current) {
        const scroller = modalContent;
        const sr = scroller.getBoundingClientRect();
        const cr = current.getBoundingClientRect();
        const currentTop = cr.top - sr.top + scroller.scrollTop;
        scroller.scrollTop = Math.max(0, currentTop - (scroller.clientHeight - cr.height) / 2);
      }
    });
  });
}

if (btnCalendar) btnCalendar.addEventListener("click", openCalendarModal);

/* ===== Export / Import ===== */
const btnExport = $("#btnExport");
const btnImport = $("#btnImport");
const importFile = $("#importFile");

btnExport.addEventListener("click", () => {
  // Add optional schemaVersion, but keep structure identical so old importers still work
  const payload = { ...state, schemaVersion: 5 };
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

    state = normalizeStateObject(parsed);
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
    form.className = "goalEditor";

    const fields = [
      { key: "kcal", label: t("goalKcal"), placeholder: "2500" },
      { key: "protein", label: t("goalProtein"), placeholder: "160" },
      { key: "price", label: t("goalPrice"), placeholder: "15" },
      { key: "carbs", label: t("goalCarbs"), placeholder: "300" },
      { key: "fat", label: t("goalFat"), placeholder: "80" }
    ];

    form.innerHTML = fields.map(f => `
      <div class="goalEditorRow">
        <label class="goalEditorCheck" title="${escapeHtml(t("goalRelevantHint"))}">
          <input type="checkbox" data-relevant="${f.key}">
          <span>${escapeHtml(t("goalRelevant"))}</span>
        </label>
        <label class="field goalEditorField">
          <span>${escapeHtml(f.label)}</span>
          <input class="searchInput" type="text" inputmode="decimal" data-goal="${f.key}" placeholder="${escapeHtml(f.placeholder)}">
        </label>
      </div>
    `).join("") + `<button class="btn btn--big" type="submit">${escapeHtml(t("saveButton"))}</button>`;

    container.appendChild(form);

    for (const f of fields) {
      form.querySelector(`[data-goal="${f.key}"]`).value = String(state.goals[f.key] ?? "");
      form.querySelector(`[data-relevant="${f.key}"]`).checked = Boolean(state.goalRelevant[f.key]);
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const nextGoals = {};
      const nextRelevant = {};

      for (const f of fields) {
        const value = parseNumber(form.querySelector(`[data-goal="${f.key}"]`).value);
        if (!Number.isFinite(value) || value <= 0) {
          alert(`${f.label}: ${t("goalPositive")}`);
          return;
        }
        nextGoals[f.key] = value;
        nextRelevant[f.key] = form.querySelector(`[data-relevant="${f.key}"]`).checked;
      }

      state.goals = nextGoals;
      state.goalRelevant = nextRelevant;
      saveState();
      closeModal();
      renderAll();
    });
  });
});

/* ===== SEARCH (tabs) ===== */
const ingredientsSearch = $("#ingredientsSearch");
const recipesSearch = $("#recipesSearch");

const ingredientsSort = $("#ingredientsSort");
const ingredientsSortDir = $("#ingredientsSortDir");
const recipesSort = $("#recipesSort");
const recipesSortDir = $("#recipesSortDir");


let ingredientsFilter = "";
let recipesFilter = "";

let ingredientsSortKey = "name";
let recipesSortKey = "name";
let ingredientsSortAsc = true;
let recipesSortAsc = true;


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

/* ===== SORT (tabs) ===== */

function updateSortDirButton(btn, asc) {
  if (!btn) return;
  btn.textContent = asc ? "↑" : "↓";
}

if (ingredientsSort) {
  ingredientsSort.addEventListener("change", () => {
    ingredientsSortKey = ingredientsSort.value || "name";
    renderIngredients();
  });
}
if (ingredientsSortDir) {
  ingredientsSortDir.addEventListener("click", () => {
    ingredientsSortAsc = !ingredientsSortAsc;
    updateSortDirButton(ingredientsSortDir, ingredientsSortAsc);
    renderIngredients();
  });
}

if (recipesSort) {
  recipesSort.addEventListener("change", () => {
    recipesSortKey = recipesSort.value || "name";
    renderRecipes();
  });
}
if (recipesSortDir) {
  recipesSortDir.addEventListener("click", () => {
    recipesSortAsc = !recipesSortAsc;
    updateSortDirButton(recipesSortDir, recipesSortAsc);
    renderRecipes();
  });
}

// init arrows
updateSortDirButton(ingredientsSortDir, ingredientsSortAsc);
updateSortDirButton(recipesSortDir, recipesSortAsc);


/* ===== Sort helpers ===== */

function metricP100prot(price, protein) {
  return (protein > 0) ? (price / protein) * 100 : NaN;
}

function metricP100kcal(price, kcal) {
  return (kcal > 0) ? (price / kcal) * 100 : NaN;
}

function metricProtPer100kcal(protein, kcal) {
  return (kcal > 0) ? (protein / kcal) * 100 : NaN;
}

function sortByKey(items, key, asc, valueFnName, valueFnMetric) {
  const dir = asc ? 1 : -1;

  return items.slice().sort((a, b) => {
    if (key === "name") {
      return dir * ((a.name || "").localeCompare(b.name || ""));
    }

    const va = valueFnMetric(a);
    const vb = valueFnMetric(b);

    const aOk = Number.isFinite(va);
    const bOk = Number.isFinite(vb);

    if (aOk && bOk) return dir * (va - vb);
    if (aOk && !bOk) return -1;
    if (!aOk && bOk) return 1;
    return dir * ((a.name || "").localeCompare(b.name || ""));
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

        row.classList.add("pickerCard");
        row.innerHTML = `
          <div class="pickerCard__head">
            <div>
              <strong>${escapeHtml(ing.name)}</strong>
              ${ing.brand ? `<div class="pickerCard__sub">${escapeHtml(ing.brand)}</div>` : ""}
            </div>
          </div>
          ${pickerStatsHtml(ing.price, ing.kcal, ing.protein, ing.carbs, ing.fat)}
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

const dayKcalRemaining = $("#dayKcalRemaining");
const dayProteinRemaining = $("#dayProteinRemaining");
const dayPriceRemaining = $("#dayPriceRemaining");
const dayCarbsRemaining = $("#dayCarbsRemaining");
const dayFatRemaining = $("#dayFatRemaining");

const dayKcalProgress = $("#dayKcalProgress");
const dayProteinProgress = $("#dayProteinProgress");
const dayPriceProgress = $("#dayPriceProgress");
const dayCarbsProgress = $("#dayCarbsProgress");
const dayFatProgress = $("#dayFatProgress");

const dayP100ProtValue = $("#dayP100ProtValue");
const dayP100KcalValue = $("#dayP100KcalValue");
const dayProtPer100kcalValue = $("#dayProtPer100kcalValue");


function openMealModal(mealKey) {
  const meal = MEALS.find(m => m.key === mealKey);
  const mealLabel = meal ? t(meal.labelKey) : t("entries");
  const dateLabelText = (selectedDayKey === nowDayKeyRollover0430()) ? t("today") : formatDateKeyGerman(selectedDayKey);
  const title = `${mealLabel} · ${dateLabelText}`;

  openModal(title, (container) => {
    const actions = document.createElement("div");
    actions.className = "mealModalActions";
    actions.innerHTML = `
      <button class="btn btn--big" id="mAddIng">${escapeHtml(t("addIngredient"))}</button>
      <button class="btn btn--big" id="mAddRec">${escapeHtml(t("addRecipe"))}</button>
      <button class="btn btn--big btn--ghost" id="mAddManual">${escapeHtml(t("addManual"))}</button>
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
      const visible = getVisibleEntriesForMeal().filter(entry => {
        if (entry.type === "manual") return true;
        if (entry.type === "ingredient") return state.ingredients.some(x => x.id === entry.refId);
        if (entry.type === "recipe") return state.recipes.some(x => x.id === entry.refId);
        return false;
      });
      hint.classList.toggle("hidden", visible.length > 0);

      for (const entry of visible) {
        let titleText = "";
        let amountText = "";
        let totals = { price: 0, kcal: 0, protein: 0, carbs: 0, fat: 0 };

        if (entry.type === "ingredient") {
          const ing = state.ingredients.find(x => x.id === entry.refId);
          if (!ing) continue;
          totals = calcIngredientTotals(ing, entry.amount);
          titleText = ing.name;
          amountText = amountLabel(ing.unitType, entry.amount);
        } else if (entry.type === "recipe") {
          const r = state.recipes.find(x => x.id === entry.refId);
          if (!r) continue;
          const base = calcRecipeTotals(r);
          const f = Number(entry.amount) || 0;
          titleText = r.name;
          const factorText = round2(f).replace(/([,.]\d*?[1-9])0+$|[,.]0+$/, "$1").replace(".", ",");
          amountText = `${factorText} ${loadLanguage() === "en" ? (Math.abs(f - 1) < 0.0001 ? "portion" : "portions") : (Math.abs(f - 1) < 0.0001 ? "Portion" : "Portionen")}`;
          totals = { price: base.price*f, kcal: base.kcal*f, protein: base.protein*f, carbs: base.carbs*f, fat: base.fat*f };
        } else if (entry.type === "manual") {
          titleText = (entry.name || "").trim() || t("manualEntry");
          totals = {
            price: Number(entry.price) || 0, kcal: Number(entry.kcal) || 0,
            protein: Number(entry.protein) || 0, carbs: Number(entry.carbs) || 0, fat: Number(entry.fat) || 0
          };
        } else continue;

        const row = document.createElement("div");
        row.className = "modalRow pickerCard mealEntryCard";
        row.innerHTML = `
          <div class="pickerCard__head mealEntryHead">
            <div class="mealEntryHeading">
              <strong>${escapeHtml(titleText)}</strong>
              ${amountText ? `<div class="mealEntryAmount">${escapeHtml(amountText)}</div>` : ""}
            </div>
            <div class="mealEntryActions">
              <button class="btn btn--ghost mealEntryEdit" type="button">${escapeHtml(t("editButton"))}</button>
              <button class="btn btn--danger mealEntryDelete" type="button">${escapeHtml(t("deleteButton"))}</button>
            </div>
          </div>
          ${pickerStatsHtml(totals.price, totals.kcal, totals.protein, totals.carbs, totals.fat)}
        `;

        row.querySelector(".mealEntryDelete").addEventListener("click", () => {
          const log = getDayLog(selectedDayKey);
          state.dayLogs[selectedDayKey] = (log || []).filter(e => e.id !== entry.id);
          saveState();
          renderAll();
          renderMealList();
        });

        row.querySelector(".mealEntryEdit").addEventListener("click", () => {
          openDayEntryEditor(entry, mealKey);
        });

        list.appendChild(row);
      }
    }

    renderMealList();

    actions.querySelector("#mAddIng").addEventListener("click", () => {
      if (state.ingredients.length === 0) {
        alert(t("needIngredientsFirst"));
        setTab("ingredients"); closeModal(); return;
      }
      openIngredientPickerForDay(mealKey, () => { renderAll(); });
    });

    actions.querySelector("#mAddRec").addEventListener("click", () => {
      if (state.recipes.length === 0) {
        alert(t("needRecipeFirst"));
        setTab("recipes"); closeModal(); return;
      }
      openRecipePickerForDay(mealKey, () => { renderAll(); });
    });

    actions.querySelector("#mAddManual").addEventListener("click", () => {
      openManualEntryForDay(mealKey, () => { renderAll(); });
    });
  });
}

function openDayEntryEditor(entry, mealKey) {
  const reopen = () => { renderAll(); openMealModal(mealKey); };

  if (entry.type === "ingredient") {
    const ing = state.ingredients.find(x => x.id === entry.refId);
    if (!ing) return;
    openModal(`${t("editButton")} · ${ing.name}`, (container) => {
      const form = document.createElement("form");
      form.className = "modalRow";
      form.innerHTML = `
        <label class="field"><span>${escapeHtml(t("amountLabel"))}</span>
          <input class="searchInput" id="mEditAmount" type="text" inputmode="decimal" value="${escapeHtml(String(entry.amount).replace(".", ","))}" placeholder="${escapeHtml(amountPlaceholder(ing.unitType))}">
        </label>
        <button class="btn btn--big" type="submit">${escapeHtml(t("saveButton"))}</button>`;
      container.appendChild(form);
      form.addEventListener("submit", e => {
        e.preventDefault();
        const n = parseNumber(form.querySelector("#mEditAmount").value);
        if (!Number.isFinite(n) || n <= 0) return alert(t("amountPositive"));
        entry.amount = n; saveState(); closeModal(); reopen();
      });
    });
    return;
  }

  if (entry.type === "recipe") {
    const recipe = state.recipes.find(x => x.id === entry.refId);
    if (!recipe) return;
    openModal(`${t("editButton")} · ${recipe.name}`, (container) => {
      const form = document.createElement("form");
      form.className = "modalRow";
      form.innerHTML = `
        <label class="field"><span>${escapeHtml(t("portionAmount"))}</span>
          <input class="searchInput" id="mEditAmount" type="text" inputmode="decimal" value="${escapeHtml(String(entry.amount).replace(".", ","))}">
        </label>
        <button class="btn btn--big" type="submit">${escapeHtml(t("saveButton"))}</button>`;
      container.appendChild(form);
      form.addEventListener("submit", e => {
        e.preventDefault();
        const n = parseNumber(form.querySelector("#mEditAmount").value);
        if (!Number.isFinite(n) || n <= 0) return alert(t("amountPositive"));
        entry.amount = n; saveState(); closeModal(); reopen();
      });
    });
    return;
  }

  if (entry.type === "manual") {
    openModal(t("editManual"), (container) => {
      const form = document.createElement("form");
      form.className = "modalRow";
      form.innerHTML = `
        <label class="field"><span>${escapeHtml(t("manualName"))}</span><input id="eName" type="text" value="${escapeHtml(entry.name || "")}"></label>
        <div class="grid2">
          <label class="field"><span>kcal</span><input id="eKcal" type="text" inputmode="decimal" value="${escapeHtml(String(entry.kcal ?? 0).replace(".", ","))}"></label>
          <label class="field"><span>${escapeHtml(t("proteinLabel"))}</span><input id="eProtein" type="text" inputmode="decimal" value="${escapeHtml(String(entry.protein ?? 0).replace(".", ","))}"></label>
          <label class="field"><span>${escapeHtml(t("carbsLabel"))}</span><input id="eCarbs" type="text" inputmode="decimal" value="${escapeHtml(String(entry.carbs ?? 0).replace(".", ","))}"></label>
          <label class="field"><span>${escapeHtml(t("fatLabel"))}</span><input id="eFat" type="text" inputmode="decimal" value="${escapeHtml(String(entry.fat ?? 0).replace(".", ","))}"></label>
        </div>
        <label class="field"><span>${escapeHtml(t("priceLabel"))}</span><input id="ePrice" type="text" inputmode="decimal" value="${escapeHtml(String(entry.price ?? 0).replace(".", ","))}"></label>
        <button class="btn btn--big" type="submit">${escapeHtml(t("saveButton"))}</button>`;
      container.appendChild(form);
      form.addEventListener("submit", e => {
        e.preventDefault();
        const values = {
          kcal: parseNumber(form.querySelector("#eKcal").value), protein: parseNumber(form.querySelector("#eProtein").value),
          carbs: parseNumber(form.querySelector("#eCarbs").value), fat: parseNumber(form.querySelector("#eFat").value),
          price: parseNumber(form.querySelector("#ePrice").value)
        };
        if (Object.values(values).some(v => !Number.isFinite(v) || v < 0)) return alert(t("numberNonNegative"));
        Object.assign(entry, values, { name: form.querySelector("#eName").value.trim() });
        saveState(); closeModal(); reopen();
      });
    });
  }
}

function openManualEntryForDay(mealKey, onDone) {
  openModal(t("manualEntryTitle"), (container) => {
    const form = document.createElement("form");
    form.className = "modalRow";
    form.innerHTML = `
      <label class="field">
        <span>${escapeHtml(t("manualName"))}</span>
        <input type="text" id="mManualName" placeholder="${escapeHtml(t("manualNamePlaceholder"))}" />
      </label>
      <div class="grid2">
        <label class="field">
          <span>kcal</span>
          <input type="text" inputmode="decimal" id="mManualKcal" required placeholder="500" />
        </label>
        <label class="field">
          <span>${escapeHtml(t("proteinLabel"))}</span>
          <input type="text" inputmode="decimal" id="mManualProtein" required placeholder="30" />
        </label>
        <label class="field">
          <span>${escapeHtml(t("carbsLabel"))}</span>
          <input type="text" inputmode="decimal" id="mManualCarbs" required placeholder="60" />
        </label>
        <label class="field">
          <span>${escapeHtml(t("fatLabel"))}</span>
          <input type="text" inputmode="decimal" id="mManualFat" required placeholder="15" />
        </label>
      </div>
      <label class="field">
        <span>${escapeHtml(t("manualPrice"))}</span>
        <input type="text" inputmode="decimal" id="mManualPrice" placeholder="0,00" />
      </label>
      <button class="btn btn--big" type="submit">${escapeHtml(t("saveButton"))}</button>
    `;
    container.appendChild(form);

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const name = form.querySelector("#mManualName").value.trim();
      const kcal = parseNumber(form.querySelector("#mManualKcal").value);
      const protein = parseNumber(form.querySelector("#mManualProtein").value);
      const carbs = parseNumber(form.querySelector("#mManualCarbs").value);
      const fat = parseNumber(form.querySelector("#mManualFat").value);
      const rawPrice = form.querySelector("#mManualPrice").value.trim();
      const price = rawPrice === "" ? 0 : parseNumber(rawPrice);

      for (const [label, value] of [["kcal", kcal], [t("proteinLabel"), protein], [t("carbsLabel"), carbs], [t("fatLabel"), fat], [t("priceLabel"), price]]) {
        if (!Number.isFinite(value) || value < 0) {
          alert(`${label}: ${t("numberNonNegative")}`);
          return;
        }
      }

      getDayLog(selectedDayKey).push({
        id: uid(),
        type: "manual",
        meal: mealKey,
        name,
        kcal,
        protein,
        carbs,
        fat,
        price
      });

      saveState();
      closeModal();
      if (typeof onDone === "function") onDone();
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

        row.classList.add("pickerCard");
        row.innerHTML = `
          <div class="pickerCard__head">
            <div>
              <strong>${escapeHtml(ing.name)}</strong>
              ${ing.brand ? `<div class="pickerCard__sub">${escapeHtml(ing.brand)}</div>` : ""}
            </div>
          </div>
          ${pickerStatsHtml(ing.price, ing.kcal, ing.protein, ing.carbs, ing.fat)}
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

        row.classList.add("pickerCard");
        row.innerHTML = `
          <div class="pickerCard__head">
            <strong>${escapeHtml(r.name)}</strong>
          </div>
          ${pickerStatsHtml(totals.price, totals.kcal, totals.protein, totals.carbs, totals.fat)}
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



/* ===== Supplements ===== */
function syncSupplementOrderFromManageList(list) {
  const ids = [...list.querySelectorAll(".supplementManageRow")]
    .map(row => row.dataset.supplementId)
    .filter(Boolean);
  if (ids.length !== state.supplements.length) return;

  const byId = new Map(state.supplements.map(sup => [String(sup.id), sup]));
  state.supplements = ids.map(id => byId.get(String(id))).filter(Boolean);
}

function attachSupplementDrag(handle, row, list) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();

    let moved = false;
    row.classList.add("supplementManageRow--dragging");
    handle.setPointerCapture?.(event.pointerId);

    const move = (e) => {
      e.preventDefault();
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const target = hit?.closest?.(".supplementManageRow");
      if (!target || target === row || target.parentElement !== list) return;

      const rect = target.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      if (after) {
        list.insertBefore(row, target.nextSibling);
      } else {
        list.insertBefore(row, target);
      }
      moved = true;
    };

    const finish = (e) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      row.classList.remove("supplementManageRow--dragging");
      try { handle.releasePointerCapture?.(e.pointerId); } catch {}

      if (moved) {
        syncSupplementOrderFromManageList(list);
        saveState();
        renderAll();
      }
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });
}

function openSupplementsModal() {
  const dateText = selectedDayKey === nowDayKeyRollover0430() ? t("today") : formatDateKeyGerman(selectedDayKey);
  openModal(`${t("supplements")} · ${dateText}`, (container) => {
    const list = document.createElement("div");
    list.className = "supplementManageList";
    container.appendChild(list);

    function renderList() {
      list.innerHTML = "";

      if (state.supplements.length === 0) {
        const hint = document.createElement("div");
        hint.className = "hint supplementEmpty";
        hint.textContent = t("noSupplements");
        list.appendChild(hint);
      } else if (state.supplements.length > 1) {
        const hint = document.createElement("div");
        hint.className = "supplementReorderHint";
        hint.textContent = t("supplementReorderHint");
        list.appendChild(hint);
      }

      for (const sup of state.supplements) {
        const taken = isSupplementTaken(sup.id);
        const row = document.createElement("div");
        row.className = `supplementManageRow${taken ? " supplementManageRow--taken" : ""}`;
        row.dataset.supplementId = String(sup.id);
        row.innerHTML = `
          <button class="supplementDragHandle" type="button" aria-label="${escapeHtml(t("supplementReorder"))}" title="${escapeHtml(t("supplementReorder"))}">↕</button>
          <button class="supplementToggle" type="button" aria-pressed="${taken ? "true" : "false"}">
            <span class="supplementCheck">${taken ? "✓" : ""}</span>
            <span class="supplementManageText">
              <strong>${escapeHtml(sup.name)}</strong>
              <small>${escapeHtml(supplementAmountText(sup))}${sup.relevant ? ` · ${escapeHtml(t("goalRelevant"))}` : ""}</small>
            </span>
          </button>
          <div class="supplementManageActions">
            <button class="btn btn--ghost supplementEdit" type="button">${escapeHtml(t("editButton"))}</button>
            <button class="btn btn--danger supplementDelete" type="button">${escapeHtml(t("deleteButton"))}</button>
          </div>`;

        const dragHandle = row.querySelector(".supplementDragHandle");
        attachSupplementDrag(dragHandle, row, list);

        row.querySelector(".supplementToggle").addEventListener("click", () => {
          toggleSupplementTaken(sup.id);
          renderAll();
          renderList();
        });

        row.querySelector(".supplementEdit").addEventListener("click", () => {
          openSupplementEditor(sup);
        });

        row.querySelector(".supplementDelete").addEventListener("click", () => {
          state.supplements = state.supplements.filter(x => x.id !== sup.id);
          for (const key of Object.keys(state.supplementLogs || {})) {
            state.supplementLogs[key] = (state.supplementLogs[key] || []).filter(id => id !== String(sup.id));
          }
          saveState();
          renderAll();
          renderList();
        });

        list.appendChild(row);
      }
    }

    renderList();

    const create = document.createElement("button");
    create.className = "btn btn--big supplementCreateBtn";
    create.type = "button";
    create.textContent = t("createSupplement");
    create.addEventListener("click", openSupplementCreator);
    container.appendChild(create);
  });
}

function openSupplementCreator() {
  openSupplementEditor(null);
}

function openSupplementEditor(sup = null) {
  const editing = Boolean(sup);
  openModal(editing ? t("editSupplement") : t("createSupplement"), (container) => {
    const form = document.createElement("form");
    form.className = "modalRow";
    form.innerHTML = `
      <label class="field"><span>${escapeHtml(t("supplementName"))}</span><input id="supName" type="text" required placeholder="${escapeHtml(t("supplementNamePlaceholder"))}"></label>
      <div class="supplementAmountEditor">
        <label class="field"><span>${escapeHtml(t("supplementAmount"))}</span><input id="supAmount" type="text" inputmode="decimal" required placeholder="1"></label>
        <label class="field"><span>${escapeHtml(t("unit"))}</span><select id="supUnit"><option value="piece">${escapeHtml(t("pieces"))}</option><option value="g">g</option></select></label>
      </div>
      <label class="checkRow"><input id="supRelevant" type="checkbox"><span>${escapeHtml(t("supplementRelevant"))}</span></label>
      <div class="supplementRelevanceNote">${escapeHtml(t("supplementRelevantFromNow"))}</div>
      <button class="btn btn--big" type="submit">${escapeHtml(t("saveButton"))}</button>`;
    container.appendChild(form);

    const nameInput = form.querySelector("#supName");
    const amountInput = form.querySelector("#supAmount");
    const unitInput = form.querySelector("#supUnit");
    const relevantInput = form.querySelector("#supRelevant");

    if (editing) {
      nameInput.value = sup.name || "";
      amountInput.value = String(sup.amount ?? "").replace(".", ",");
      unitInput.value = sup.unit === "g" ? "g" : "piece";
      relevantInput.checked = Boolean(sup.relevant);
    }

    form.addEventListener("submit", e => {
      e.preventDefault();
      const name = nameInput.value.trim();
      const amount = parseNumber(amountInput.value);
      const unit = unitInput.value === "g" ? "g" : "piece";
      const relevant = relevantInput.checked;
      if (!name) return alert(t("supplementNameRequired"));
      if (!Number.isFinite(amount) || amount <= 0) return alert(t("amountPositive"));

      const effectiveKey = nowDayKeyRollover0430();

      if (editing) {
        sup.name = name;
        sup.amount = amount;
        sup.unit = unit;
        updateSupplementRelevance(sup, relevant, effectiveKey);
      } else {
        state.supplements.push({
          id: uid(),
          name,
          amount,
          unit,
          relevant,
          createdOn: effectiveKey,
          relevancePeriods: relevant ? [{ from: effectiveKey, to: null }] : []
        });
      }

      saveState();
      closeModal();
      renderAll();
      openSupplementsModal();
    });
  });
}

function renderSupplementsOverview() {
  const block = document.createElement("div");
  block.className = "supplementBlock";
  block.addEventListener("click", openSupplementsModal);

  const title = document.createElement("div");
  title.className = "supplementBlock__title";
  title.textContent = t("supplements");
  block.appendChild(title);

  if (state.supplements.length === 0) {
    const empty = document.createElement("div");
    empty.className = "supplementBlock__empty";
    empty.textContent = t("tapToCreateSupplement");
    block.appendChild(empty);
    return block;
  }

  const grid = document.createElement("div");
  grid.className = "supplementGrid";

  const count = state.supplements.length;
  const rowCount = Math.ceil(count / 4);
  const baseSize = Math.floor(count / rowCount);
  const extra = count % rowCount;
  const rowSizes = Array.from({ length: rowCount }, (_, index) => baseSize + (index < extra ? 1 : 0));

  let offset = 0;
  for (const rowSize of rowSizes) {
    const row = document.createElement("div");
    row.className = "supplementGridRow";
    row.style.setProperty("--supp-row-cols", String(rowSize));

    for (const sup of state.supplements.slice(offset, offset + rowSize)) {
      const taken = isSupplementTaken(sup.id);
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = `supplementTile${taken ? " supplementTile--taken" : ""}`;
      tile.title = `${sup.name} · ${supplementAmountText(sup)}`;
      tile.innerHTML = `<span>${escapeHtml(sup.name)}</span>`;
      tile.addEventListener("click", e => {
        e.stopPropagation();
        toggleSupplementTaken(sup.id);
        renderAll();
      });
      row.appendChild(tile);
    }

    grid.appendChild(row);
    offset += rowSize;
  }

  block.appendChild(grid);
  return block;
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
  const log = state.dayLogs?.[key] || [];

  // Skip entries whose refId no longer exists
  return log.filter(entry => {
    if (entry.type === "manual") return true;
    if (entry.type === "ingredient") {
      return state.ingredients.some(x => x.id === entry.refId);
    }
    if (entry.type === "recipe") {
      return state.recipes.some(x => x.id === entry.refId);
    }
    return false;
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
    } else if (entry.type === "recipe") {
      const r = state.recipes.find(x => x.id === entry.refId);
      if (!r) continue;
      const t = calcRecipeTotals(r);
      totals.kcal += t.kcal * entry.amount;
      totals.protein += t.protein * entry.amount;
      totals.carbs += t.carbs * entry.amount;
      totals.fat += t.fat * entry.amount;
      totals.price += t.price * entry.amount;
    } else if (entry.type === "manual") {
      totals.kcal += Number(entry.kcal) || 0;
      totals.protein += Number(entry.protein) || 0;
      totals.carbs += Number(entry.carbs) || 0;
      totals.fat += Number(entry.fat) || 0;
      totals.price += Number(entry.price) || 0;
    }
  }

  return totals;
}

function pctOfGoal(value, goal) {
  if (!Number.isFinite(value) || !Number.isFinite(goal) || goal <= 0) return 0;
  return clampPct(Math.round((value / goal) * 100));
}

function updateGoalProgress(el, pct) {
  if (!el) return;
  const safePct = Math.max(0, Number(pct) || 0);
  const isOver = safePct > 100;

  if (isOver) {
    // The whole bar represents the current value; the marker shows where 100% sits inside it.
    el.style.setProperty("--progress-fill", "100%");
    el.style.setProperty("--goal-pos", `${Math.max(0, Math.min(100, (100 / safePct) * 100))}%`);
  } else {
    el.style.setProperty("--progress-fill", `${Math.min(100, safePct)}%`);
    el.style.setProperty("--goal-pos", "100%");
  }

  el.classList.toggle("metricProgress--over", isOver);
}

function eurosPer100gProtein(totals) {
  if (!totals || totals.protein <= 0) return NaN;
  return (totals.price / totals.protein) * 100;
}

function eurosPer100kcal(totals) {
  if (!totals || totals.kcal <= 0) return NaN;
  return (totals.price / totals.kcal) * 100;
}


function isDayGoalAchieved(key) {
  const totals = calcTotalsForEntries(getVisibleDayEntries(key));
  let criteria = 0;
  let ok = true;

  for (const goalKey of GOAL_KEYS) {
    if (!state.goalRelevant?.[goalKey]) continue;
    criteria++;
    const goal = Number(state.goals?.[goalKey]) || 0;
    const value = Number(totals?.[goalKey]) || 0;
    if (!(goal > 0 && value >= goal * 0.9)) ok = false;
  }

  const relevantSupplements = (state.supplements || []).filter(s => isSupplementRelevantOn(s, key));
  const taken = new Set((state.supplementLogs?.[key] || []).map(String));
  for (const sup of relevantSupplements) {
    criteria++;
    if (!taken.has(String(sup.id))) ok = false;
  }

  return criteria > 0 && ok;
}

function remainingText(value, goal, type) {
  const remaining = Math.max(0, (Number(goal) || 0) - (Number(value) || 0));
  if (type === "kcal") return `${t("remaining")} ${Math.round(remaining)} kcal`;
  if (type === "price") return `${t("remaining")} ${euroPlain(remaining)} €`;
  return `${t("remaining")} ${round1(remaining).replace(".", ",")} g`;
}

function renderDay() {
  const visibleEntries = getVisibleDayEntries(selectedDayKey);

  // Day totals
  const dayTotals = calcTotalsForEntries(visibleEntries);

  // Day headline metrics
  const kcalPctValue = pctOfGoal(dayTotals.kcal, state.goals.kcal);
  const proteinPctValue = pctOfGoal(dayTotals.protein, state.goals.protein);
  const pricePctValue = pctOfGoal(dayTotals.price, state.goals.price);
  const carbsPctValue = pctOfGoal(dayTotals.carbs, state.goals.carbs);
  const fatPctValue = pctOfGoal(dayTotals.fat, state.goals.fat);

  dayKcalValue.textContent = String(Math.round(dayTotals.kcal));
  dayKcalPct.textContent = `${kcalPctValue}%`;
  if (dayKcalRemaining) dayKcalRemaining.textContent = remainingText(dayTotals.kcal, state.goals.kcal, "kcal");
  updateGoalProgress(dayKcalProgress, kcalPctValue);

  dayProteinValue.textContent = `${round1(dayTotals.protein).replace(".", ",")}`;
  dayProteinPct.textContent = `${proteinPctValue}%`;
  if (dayProteinRemaining) dayProteinRemaining.textContent = remainingText(dayTotals.protein, state.goals.protein, "protein");
  updateGoalProgress(dayProteinProgress, proteinPctValue);

  dayPriceValue.textContent = euroPlain(dayTotals.price);
  dayPricePct.textContent = `${pricePctValue}%`;
  if (dayPriceRemaining) dayPriceRemaining.textContent = remainingText(dayTotals.price, state.goals.price, "price");
  updateGoalProgress(dayPriceProgress, pricePctValue);

  dayCarbsValue.textContent = `${round1(dayTotals.carbs).replace(".", ",")}`;
  dayCarbsPct.textContent = `${carbsPctValue}%`;
  if (dayCarbsRemaining) dayCarbsRemaining.textContent = remainingText(dayTotals.carbs, state.goals.carbs, "carbs");
  updateGoalProgress(dayCarbsProgress, carbsPctValue);

  dayFatValue.textContent = `${round1(dayTotals.fat).replace(".", ",")}`;
  dayFatPct.textContent = `${fatPctValue}%`;
  if (dayFatRemaining) dayFatRemaining.textContent = remainingText(dayTotals.fat, state.goals.fat, "fat");
  updateGoalProgress(dayFatProgress, fatPctValue);

  // Empty hint
const hasAny = visibleEntries.length > 0 || (state.supplements || []).length > 0;
dayEmptyHint.textContent = t("noEntries");
dayEmptyHint.classList.toggle("hidden", hasAny);


// Fixed daily reference ratios (based on goals)
const dayRefP100prot = (state.goals.protein > 0)
  ? (state.goals.price / state.goals.protein) * 100
  : NaN;

const dayRefP100kcal = (state.goals.kcal > 0)
  ? (state.goals.price / state.goals.kcal) * 100
  : NaN;

const dayRefProtPer100kcal = (state.goals.kcal > 0)
  ? (state.goals.protein / state.goals.kcal) * 100
  : NaN;

// Day ratios from totals
const dayP100prot = eurosPer100gProtein(dayTotals);
const dayP100kcal = eurosPer100kcal(dayTotals);
const dayProtPer100kcal = (dayTotals.kcal > 0) ? (dayTotals.protein / dayTotals.kcal) * 100 : NaN;

// Text with averages
const dayP100protText = Number.isFinite(dayP100prot) ? `${euroPlain(dayP100prot)} (Ø ${euroPlain(dayRefP100prot)})` : "n/a";
const dayP100kcalText = Number.isFinite(dayP100kcal) ? `${euroPlain(dayP100kcal)} (Ø ${euroPlain(dayRefP100kcal)})` : "n/a";
const dayProtPer100kcalText = Number.isFinite(dayProtPer100kcal)
  ? `${round1(dayProtPer100kcal).replace(".", ",")} g (Ø ${round1(dayRefProtPer100kcal).replace(".", ",")} g)`
  : "n/a";

// Colors
const dayP100protColor = ratioColor(dayP100prot, dayRefP100prot);         // lower is better
const dayP100kcalColor = ratioColor(dayP100kcal, dayRefP100kcal);         // lower is better
const dayProtPer100kcalColor = ratioColor(dayRefProtPer100kcal, dayProtPer100kcal); // higher is better

if (dayP100ProtValue) {
  dayP100ProtValue.textContent = dayP100protText;
  dayP100ProtValue.style.color = dayP100protColor;
}
if (dayP100KcalValue) {
  dayP100KcalValue.textContent = dayP100kcalText;
  dayP100KcalValue.style.color = dayP100kcalColor;
}
if (dayProtPer100kcalValue) {
  dayProtPer100kcalValue.textContent = dayProtPer100kcalText;
  dayProtPer100kcalValue.style.color = dayProtPer100kcalColor;
}



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

    const refProtPer100kcalLabel = Number.isFinite(dayRefProtPer100kcal)
  ? ` (Ø ${round1(dayRefProtPer100kcal).replace(".", ",")} g)`
  : "";



    const protColor = ratioColor(p100prot, dayRefP100prot);
    const kcalColor = ratioColor(p100kcal, dayRefP100kcal);

    const protPer100kcalColor = ratioColor(dayRefProtPer100kcal, protPer100kcal); // higher is better


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
  <div class="mealRatioLabel">${escapeHtml(t("proteinPer100kcal") + refProtPer100kcalLabel)}</div>
  <div class="mealRatioValue" style="color:${escapeHtml(protPer100kcalColor)}">
    ${escapeHtml(protPer100kcalText)}
  </div>
</div>



        <div class="mealRatioRow">
<div class="mealRatioLabel">${escapeHtml(t("ratioPricePctLabel"))}</div>
          <div class="mealRatioValue">${escapeHtml(pricePct)}</div>
        </div>
      </div>
    `;

    mealBlocks.appendChild(block);
    if (meal.key === "lunch") mealBlocks.appendChild(renderSupplementsOverview());
  }

}

/* ===== Ingredients tab render ===== */
function renderIngredients() {
  ingredientsList.innerHTML = "";

    let items = state.ingredients
    .slice()
    .filter(ing => {
      if (!ingredientsFilter) return true;
      const n = (ing.name || "").toLowerCase();
      const b = (ing.brand || "").toLowerCase();
      return n.includes(ingredientsFilter) || b.includes(ingredientsFilter);
    });

  items = sortByKey(items, ingredientsSortKey, ingredientsSortAsc, "ingredients", (ing) => {
    if (ingredientsSortKey === "p100prot") return metricP100prot(ing.price, ing.protein);
    if (ingredientsSortKey === "p100kcal") return metricP100kcal(ing.price, ing.kcal);
    if (ingredientsSortKey === "protPer100kcal") return metricProtPer100kcal(ing.protein, ing.kcal);
    return NaN;
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
        <div class="item__heading">
          <div class="item__title">${escapeHtml(ing.name)}</div>
          ${brand ? `<div class="item__sub">${escapeHtml(brand)}</div>` : ""}
        </div>
        <div class="item__price">
          <div>${escapeHtml(euro(ing.price))}</div>
          <div class="item__unit">${escapeHtml(unitLabel(ing.unitType))}</div>
        </div>
      </div>
      ${itemStatsHtml(ing.price, ing.kcal, ing.protein, ing.carbs, ing.fat)}
    `;

    ingredientsList.appendChild(row);
  }
}

/* ===== Recipes tab render ===== */
function renderRecipes() {
  recipesList.innerHTML = "";

    let items = state.recipes
    .slice()
    .filter(r => {
      if (!recipesFilter) return true;
      return (r.name || "").toLowerCase().includes(recipesFilter);
    });

  items = sortByKey(items, recipesSortKey, recipesSortAsc, "recipes", (r) => {
    const totals = calcRecipeTotals(r);
    if (recipesSortKey === "p100prot") return metricP100prot(totals.price, totals.protein);
    if (recipesSortKey === "p100kcal") return metricP100kcal(totals.price, totals.kcal);
    if (recipesSortKey === "protPer100kcal") return metricProtPer100kcal(totals.protein, totals.kcal);
    return NaN;
  });


  if (items.length === 0) recipesEmptyHint.classList.remove("hidden");
  else recipesEmptyHint.classList.add("hidden");

  for (const r of items) {
    const totals = calcRecipeTotals(r);

    const row = document.createElement("div");
    row.className = "item";
    row.addEventListener("click", () => openRecipeEditorModal(r.id));

    row.innerHTML = `
      <div class="item__top">
        <div class="item__heading">
          <div class="item__title">${escapeHtml(r.name)}</div>
        </div>
        <div class="item__price">${escapeHtml(euro(totals.price))}</div>
      </div>
      ${itemStatsHtml(totals.price, totals.kcal, totals.protein, totals.carbs, totals.fat)}
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
    carbsLabel: "Kohlenhy. (g)",
    fatLabel: "Fett (g)",
    dataLabel: "Daten",

    proteinPer100kcal: "Protein / 100 kcal",

    addIngredient: "Zutat hinzufügen",
    addRecipe: "Gericht hinzufügen",
    addManual: "Manuell eintragen",
    manualEntryTitle: "Manueller Eintrag",
    manualEntry: "Manueller Eintrag",
    manualName: "Name (optional)",
    manualNamePlaceholder: "z.B. Snack unterwegs",
    manualPrice: "Preis in Euro (optional)",
    saveButton: "Speichern",
    numberNonNegative: "muss eine Zahl ≥ 0 sein.",
    factorLabel: "Faktor",
    ingredientsCountLabel: "Zutaten",
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
    export: "E",
    import: "I",
    editGoals: "Ziele bearbeiten",
    editButton: "Bearbeiten",
    editManual: "Manuellen Eintrag bearbeiten",
    amountLabel: "Menge",
    portionAmount: "Portion / Faktor",
    amountPositive: "Menge muss > 0 sein.",
    goalKcal: "kcal Ziel pro Tag",
    goalProtein: "Protein Ziel pro Tag (g)",
    goalPrice: "Preis Ziel pro Tag (€)",
    goalCarbs: "Kohlenhydrate Ziel pro Tag (g)",
    goalFat: "Fett Ziel pro Tag (g)",
    goalRelevant: "Tagesziel",
    goalRelevantHint: "Für die Tagesziel-Erfüllung berücksichtigen",
    goalPositive: "Ziel muss > 0 sein.",
    remaining: "Noch",
    supplements: "Supplements",
    noSupplements: "Noch keine Supplements.",
    tapToCreateSupplement: "Antippen zum Erstellen",
    createSupplement: "Supplement erstellen",
    editSupplement: "Supplement bearbeiten",
    supplementName: "Name",
    supplementNamePlaceholder: "z.B. Kreatin",
    supplementAmount: "Menge / Gewicht",
    unit: "Einheit",
    pieces: "Stück",
    supplementRelevant: "Relevant für Tagesziel",
    supplementRelevantFromNow: "Änderungen an der Tagesziel-Relevanz gelten ab heute und verändern frühere Tage nicht rückwirkend.",
    supplementReorder: "Reihenfolge ändern",
    supplementReorderHint: "Am Pfeil gedrückt halten und nach oben oder unten ziehen.",
    supplementNameRequired: "Bitte einen Namen eingeben.",
    calendarTitle: "Tagesziele im Kalender",
    calendarAchieved: "Erreicht",
    calendarMissed: "Nicht erreicht",
    calendarTodayOpen: "Heute offen",
    calendarFuture: "Zukünftig",
    weekShort: "KW",

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
    addManual: "Enter manually",
    manualEntryTitle: "Manual entry",
    manualEntry: "Manual entry",
    manualName: "Name (optional)",
    manualNamePlaceholder: "e.g. snack on the go",
    manualPrice: "Price in euros (optional)",
    saveButton: "Save",
    numberNonNegative: "must be a number ≥ 0.",
    factorLabel: "Factor",
    ingredientsCountLabel: "ingredients",
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
    export: "E",
    import: "I",
    editGoals: "Edit goals",
    editButton: "Edit",
    editManual: "Edit manual entry",
    amountLabel: "Amount",
    portionAmount: "Portion / factor",
    amountPositive: "Amount must be > 0.",
    goalKcal: "Daily kcal goal",
    goalProtein: "Daily protein goal (g)",
    goalPrice: "Daily price goal (€)",
    goalCarbs: "Daily carbs goal (g)",
    goalFat: "Daily fat goal (g)",
    goalRelevant: "Daily goal",
    goalRelevantHint: "Include in daily goal completion",
    goalPositive: "Goal must be > 0.",
    remaining: "Left",
    supplements: "Supplements",
    noSupplements: "No supplements yet.",
    tapToCreateSupplement: "Tap to create",
    createSupplement: "Create supplement",
    editSupplement: "Edit supplement",
    supplementName: "Name",
    supplementNamePlaceholder: "e.g. creatine",
    supplementAmount: "Amount / weight",
    unit: "Unit",
    pieces: "Pieces",
    supplementRelevant: "Relevant for daily goal",
    supplementRelevantFromNow: "Changes to daily-goal relevance apply from today and do not retroactively change earlier days.",
    supplementReorder: "Change order",
    supplementReorderHint: "Hold the arrow and drag up or down.",
    supplementNameRequired: "Please enter a name.",
    calendarTitle: "Daily goals calendar",
    calendarAchieved: "Achieved",
    calendarMissed: "Not achieved",
    calendarTodayOpen: "Today open",
    calendarFuture: "Future",
    weekShort: "Wk",

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

  const elCalendar = document.querySelector("#btnCalendar");
  if (elCalendar) {
    elCalendar.setAttribute("aria-label", t("calendarTitle"));
    elCalendar.setAttribute("title", t("calendarTitle"));
  }

  const elModalClose = document.querySelector("#modalClose");
  if (elModalClose) {
    elModalClose.textContent = "×";
    elModalClose.setAttribute("aria-label", t("modalClose"));
    elModalClose.setAttribute("title", t("modalClose"));
  }

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

