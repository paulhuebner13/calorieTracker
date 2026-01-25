"use strict";

const LS_KEY = "kcal_tracker_v3";

/*
  State:
  - ingredients: { id, name, brand, unitType, kcal, protein, carbs, fat, price }  (per base)
  - recipes: { id, name, items: [{ ingredientId, amount }] }                     (amount in g/ml/pieces)
  - dayLogs: { [dateKey]: [{ id, type, refId, amount }] }                        (ingredient amount, recipe factor)
  - goals: { kcal, protein, price, carbs, fat }
*/

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function euro(x) {
  const s = `€ ${round2(x)}`;
  return s.replace(".", ",");
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

  const a = Number.isFinite(p100prot) ? euro(p100prot) : "n/a";
  const b = Number.isFinite(p100kcal) ? euro(p100kcal) : "n/a";

  return `· € / 100 g Protein ${a} · € / 100 kcal ${b}`;
}

function lineFull(price, kcal, protein, carbs, fat) {
  return `Preis ${euro(price)} · kcal ${Math.round(kcal)} · Protein ${round1(protein).replace(".", ",")} g · KH ${round1(carbs).replace(".", ",")} g · Fett ${round1(fat).replace(".", ",")} g ${ratiosText(price, kcal, protein)}`;
}

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

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function getDayLog(key) {
  if (!state.dayLogs[key]) state.dayLogs[key] = [];
  return state.dayLogs[key];
}

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

/* DOM helpers */
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

/* Export / Import */
const btnExport = $("#btnExport");
const btnImport = $("#btnImport");
const importFile = $("#importFile");

btnExport.addEventListener("click", () => {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `tracker-export-${todayKey()}.json`;
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

    state = parsed;
    saveState();
    closeModal();
    renderAll();
    setTab("day");
  } catch {
    alert("Import fehlgeschlagen. Bitte eine gültige Export JSON Datei wählen.");
  }
});

/* Goals */
const btnOpenGoals = $("#btnOpenGoals");

btnOpenGoals.addEventListener("click", () => {
  openModal("Ziele bearbeiten", (container) => {
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
      renderDay();
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

/* Ingredients list (editor now in modal) */
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

        for (const dateKey of Object.keys(state.dayLogs)) {
          state.dayLogs[dateKey] = (state.dayLogs[dateKey] || []).filter(e => !(e.type === "ingredient" && e.refId === target.id));
        }

        state.ingredients = state.ingredients.filter(x => x.id !== target.id);
        saveState();
        closeModal();
        renderAll();
      });
    }
  });
}

/* Recipes list (editor now in modal) */
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

  if (id) {
    const r = state.recipes.find(x => x.id === id);
    window.__recipeDraft = { id: r.id, name: r.name, items: r.items.map(x => ({ ...x })) };
  } else {
    if (!keepDraft) resetRecipeDraft();
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
        alert("Du brauchst zuerst Zutaten.");
        return;
      }
      openIngredientPickerForRecipe(() => {
  // reopen the recipe modal with updated draft (do NOT reset draft)
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

        for (const dateKey of Object.keys(state.dayLogs)) {
          state.dayLogs[dateKey] = (state.dayLogs[dateKey] || []).filter(e => !(e.type === "recipe" && e.refId === r.id));
        }

        state.recipes = state.recipes.filter(x => x.id !== r.id);
        saveState();
        closeModal();
        renderAll();
      });
    }
  });
}

function openIngredientPickerForRecipe(onDone) {
  openModal("Zutat hinzufügen", (container) => {
    const search = document.createElement("input");
    search.className = "searchInput";
    search.placeholder = "Suchen...";
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
        btn.textContent = "Hinzufügen";
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
        h.textContent = "Keine Treffer.";
        list.appendChild(h);
      }
    }

    search.addEventListener("input", () => render(search.value));
    render("");
  });
}

/* Day logging */
const btnAddIngredientToDay = $("#btnAddIngredientToDay");
const btnAddRecipeToDay = $("#btnAddRecipeToDay");
const btnClearDay = $("#btnClearDay");

const dayEntries = $("#dayEntries");
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

btnAddIngredientToDay.addEventListener("click", () => {
  if (state.ingredients.length === 0) {
    alert("Du brauchst zuerst Zutaten.");
    setTab("ingredients");
    return;
  }
  openIngredientPickerForDay();
});

btnAddRecipeToDay.addEventListener("click", () => {
  if (state.recipes.length === 0) {
    alert("Du brauchst zuerst ein Gericht.");
    setTab("recipes");
    return;
  }
  openRecipePickerForDay();
});

btnClearDay.addEventListener("click", () => {
  const key = todayKey();
  const log = state.dayLogs[key] || [];
  if (log.length === 0) return;

  const ok = confirm("Willst du wirklich alle Einträge von diesem Tag löschen?");
  if (!ok) return;

  state.dayLogs[key] = [];
  saveState();
  renderDay();
});

function openIngredientPickerForDay() {
  openModal("Zutat hinzufügen", (container) => {
    const search = document.createElement("input");
    search.className = "searchInput";
    search.placeholder = "Suchen...";
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
        btn.textContent = "Eintragen";
        btn.addEventListener("click", () => {
          const n = parseNumber(amount.value);
          if (!Number.isFinite(n) || n <= 0) {
            alert("Menge muss > 0 sein.");
            return;
          }
          const key = todayKey();
          getDayLog(key).push({ id: uid(), type: "ingredient", refId: ing.id, amount: n });
          saveState();
          closeModal();
          renderDay();
        });
        row.appendChild(btn);

        list.appendChild(row);
      }

      if (items.length === 0) {
        const h = document.createElement("div");
        h.className = "hint";
        h.textContent = "Keine Treffer.";
        list.appendChild(h);
      }
    }

    search.addEventListener("input", () => render(search.value));
    render("");
  });
}

function openRecipePickerForDay() {
  openModal("Gericht hinzufügen", (container) => {
    const search = document.createElement("input");
    search.className = "searchInput";
    search.placeholder = "Suchen...";
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

        const t = calcRecipeTotals(r);

        row.innerHTML = `
          <div class="row row--space">
            <div>
              <strong>${escapeHtml(r.name)}</strong>
              <div class="item__sub">${escapeHtml(lineFull(t.price, t.kcal, t.protein, t.carbs, t.fat))}</div>
            </div>
            <div class="item__right">${euro(t.price)}</div>
          </div>
        `;

        const factor = document.createElement("input");
        factor.className = "searchInput";
        factor.type = "text";
        factor.inputMode = "decimal";
        factor.placeholder = "Menge als Faktor (1 normal, 0,5 halb, 2 doppelt)";
        row.appendChild(factor);

        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = "Eintragen";
        btn.addEventListener("click", () => {
          const n = parseNumber(factor.value);
          if (!Number.isFinite(n) || n <= 0) {
            alert("Faktor muss > 0 sein.");
            return;
          }
          const key = todayKey();
          getDayLog(key).push({ id: uid(), type: "recipe", refId: r.id, amount: n });
          saveState();
          closeModal();
          renderDay();
        });
        row.appendChild(btn);

        list.appendChild(row);
      }

      if (items.length === 0) {
        const h = document.createElement("div");
        h.className = "hint";
        h.textContent = "Keine Treffer.";
        list.appendChild(h);
      }
    }

    search.addEventListener("input", () => render(search.value));
    render("");
  });
}

/* Rendering */
function renderAll() {
  renderDay();
  renderIngredients();
  renderRecipes();
}

function renderDay() {
  const key = todayKey();
  const log = getDayLog(key);

  let totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, price: 0 };

  dayEntries.innerHTML = "";
  if (!log || log.length === 0) dayEmptyHint.classList.remove("hidden");
  else dayEmptyHint.classList.add("hidden");

  for (const entry of (log || [])) {
    let title = "";
    let sub = "";

    let kcal = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;
    let price = 0;

    if (entry.type === "ingredient") {
      const ing = state.ingredients.find(x => x.id === entry.refId);
      if (ing) {
        const a = calcIngredientTotals(ing, entry.amount);
        kcal = a.kcal;
        protein = a.protein;
        carbs = a.carbs;
        fat = a.fat;
        price = a.price;

        title = ing.name;
        sub = `${amountLabel(ing.unitType, entry.amount)} · ${lineFull(price, kcal, protein, carbs, fat)}`;
      } else {
        title = "Unbekannte Zutat";
        sub = "Nicht gefunden";
      }
    } else {
      const r = state.recipes.find(x => x.id === entry.refId);
      if (r) {
        const t = calcRecipeTotals(r);
        kcal = t.kcal * entry.amount;
        protein = t.protein * entry.amount;
        carbs = t.carbs * entry.amount;
        fat = t.fat * entry.amount;
        price = t.price * entry.amount;

        title = r.name;
        sub = `Faktor ${entry.amount} · ${lineFull(price, kcal, protein, carbs, fat)}`;
      } else {
        title = "Unbekanntes Gericht";
        sub = "Nicht gefunden";
      }
    }

    totals.kcal += kcal;
    totals.protein += protein;
    totals.carbs += carbs;
    totals.fat += fat;
    totals.price += price;

    const row = document.createElement("div");
    row.className = "item";
    row.style.cursor = "default";

    row.innerHTML = `
      <div class="item__top">
        <div>
          <div class="item__title">${escapeHtml(title)}</div>
          <div class="item__sub">${escapeHtml(sub)}</div>
        </div>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "row";
    actions.style.marginTop = "8px";

    const btnDel = document.createElement("button");
    btnDel.className = "btn btn--danger";
    btnDel.type = "button";
    btnDel.textContent = "Löschen";
    btnDel.addEventListener("click", () => {
      state.dayLogs[key] = (state.dayLogs[key] || []).filter(e => e.id !== entry.id);
      saveState();
      renderDay();
    });

    actions.appendChild(btnDel);
    row.appendChild(actions);
    dayEntries.appendChild(row);
  }

  dayKcalValue.textContent = String(Math.round(totals.kcal));
  dayKcalPct.textContent = `${clampPct(Math.round((totals.kcal / state.goals.kcal) * 100))}%`;

  dayProteinValue.textContent = `${round1(totals.protein).replace(".", ",")}`;
  dayProteinPct.textContent = `${clampPct(Math.round((totals.protein / state.goals.protein) * 100))}%`;

  dayPriceValue.textContent = `${round2(totals.price)}`.replace(".", ",");
  dayPricePct.textContent = `${clampPct(Math.round((totals.price / state.goals.price) * 100))}%`;

  dayCarbsValue.textContent = `${round1(totals.carbs).replace(".", ",")}`;
  dayCarbsPct.textContent = `${clampPct(Math.round((totals.carbs / state.goals.carbs) * 100))}%`;

  dayFatValue.textContent = `${round1(totals.fat).replace(".", ",")}`;
  dayFatPct.textContent = `${clampPct(Math.round((totals.fat / state.goals.fat) * 100))}%`;
}

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
        <div class="item__right">${euro(t.price)}</div>
      </div>
      <div class="item__sub">${escapeHtml(lineFull(t.price, t.kcal, t.protein, t.carbs, t.fat))}</div>
    `;

    recipesList.appendChild(row);
  }
}

/* Initial */
renderAll();
setTab("day");
