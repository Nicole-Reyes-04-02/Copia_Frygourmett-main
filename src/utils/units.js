export const UNIT_DEFINITIONS = Object.freeze({
  g: { label: "Gramos", base: "g", factor: 1, category: "Peso" },
  kg: { label: "Kilogramos", base: "g", factor: 1000, category: "Peso" },
  lb: { label: "Libras", base: "g", factor: 453.592, category: "Peso" },
  oz: { label: "Onzas", base: "g", factor: 28.3495, category: "Peso" },
  ml: { label: "Mililitros", base: "ml", factor: 1, category: "Volumen" },
  L: { label: "Litros", base: "ml", factor: 1000, category: "Volumen" },
  gal: { label: "Galones", base: "ml", factor: 3785.41, category: "Volumen" },
  fl_oz: { label: "Onzas líquidas", base: "ml", factor: 29.5735, category: "Volumen" },
  taza: { label: "Taza", base: "ml", factor: 240, category: "Cocina / Casera" },
  cda: { label: "Cucharada", base: "ml", factor: 15, category: "Cocina / Casera" },
  cdta: { label: "Cucharadita", base: "ml", factor: 5, category: "Cocina / Casera" },
  pizca: { label: "Pizca", base: "ml", factor: 1, category: "Cocina / Casera" },
  chorro: { label: "Chorro", base: "ml", factor: 30, category: "Cocina / Casera" },
  punado: { label: "Puñado", base: "ml", factor: 40, category: "Cocina / Casera" },
  ud: { label: "Unidad", base: "ud", factor: 1, category: "Conteo" },
  docena: { label: "Docena", base: "ud", factor: 12, category: "Conteo" },
  manojo: { label: "Manojo", base: "ud", factor: 1, category: "Conteo" },
  diente: { label: "Diente", base: "ud", factor: 1, category: "Conteo" },
  rama: { label: "Rama", base: "ud", factor: 1, category: "Conteo" },
  al_gusto: { label: "Al gusto / C/N", base: "ud", factor: 0, category: "Conteo" }
});

export const UNIT_CATEGORIES = Object.freeze(
  [...new Set(Object.values(UNIT_DEFINITIONS).map((unit) => unit.category))]
);

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

const UNIT_ALIASES = Object.freeze({
  gr: "g", gramo: "g", gramos: "g",
  kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
  libra: "lb", libras: "lb", lbs: "lb",
  l: "L", lt: "L", litro: "L", litros: "L",
  cc: "ml", mililitro: "ml", mililitros: "ml",
  und: "ud", "und.": "ud", unidad: "ud", unidades: "ud", unid: "ud", "unid.": "ud",
  cda: "cda", cdas: "cda", cuch: "cda", cucharada: "cda", cucharadas: "cda",
  cdta: "cdta", cdtas: "cdta", cdita: "cdta", cucharadita: "cdta", cucharaditas: "cdta",
  tazas: "taza", pizcas: "pizca",
  "al gusto": "al_gusto", "c/n": "al_gusto"
});

export function normalizeUnit(unit) {
  const normalized = normalizeLabel(unit);
  const key = UNIT_ALIASES[normalized] || normalized;
  return UNIT_DEFINITIONS[key] ? key : null;
}

export function unitToBase(quantity, unit) {
  const key = normalizeUnit(unit);
  const amount = Number(quantity);
  if (!key || !Number.isFinite(amount) || amount < 0) return null;

  const definition = UNIT_DEFINITIONS[key];
  if (definition.factor === 0) {
    return { value: 0, base: definition.base, noStockDeduction: true };
  }
  return {
    value: amount * definition.factor,
    base: definition.base,
    noStockDeduction: false
  };
}

export function convertToIngredientBaseUnit(quantity, fromUnit, ingredient = {}) {
  const targetUnit = normalizeUnit(ingredient.unidad || ingredient.unidad_base);
  const source = unitToBase(quantity, fromUnit);
  if (!source || !targetUnit) return null;

  const target = UNIT_DEFINITIONS[targetUnit];
  if (source.noStockDeduction) {
    return { value: 0, unit: targetUnit, base: target.base, noStockDeduction: true };
  }

  let baseValue = source.value;
  let baseUnit = source.base;
  if (baseUnit !== target.base) {
    const density = Number(ingredient.densidad || 0);
    const weightPerCup = Number(ingredient.peso_por_taza || 0);
    const gramsPerMilliliter = density > 0
      ? density
      : weightPerCup > 0
        ? weightPerCup / UNIT_DEFINITIONS.taza.factor
        : 0;
    if (!gramsPerMilliliter) return null;

    if (baseUnit === "ml" && target.base === "g") {
      baseValue *= gramsPerMilliliter;
      baseUnit = "g";
    } else if (baseUnit === "g" && target.base === "ml") {
      baseValue /= gramsPerMilliliter;
      baseUnit = "ml";
    } else {
      return null;
    }
  }
  if (baseUnit !== target.base) return null;

  return {
    value: Math.round((baseValue / target.factor + Number.EPSILON) * 1_000_000) / 1_000_000,
    unit: targetUnit,
    base: target.base,
    noStockDeduction: false
  };
}

export function convertToInventoryUnit(quantity, fromUnit, ingredient = {}) {
  const converted = convertToIngredientBaseUnit(quantity, fromUnit, ingredient);
  return converted ? converted.value : null;
}

export function convertToBaseUnit(quantity, unit, ingredient = {}) {
  const converted = unitToBase(quantity, unit, ingredient);
  return converted ? converted.value : null;
}

export function renderUnitSelector(select, selected = "") {
  if (!select) return;
  const selectedUnit = normalizeUnit(selected);
  select.innerHTML = UNIT_CATEGORIES.map((category) => {
    const options = Object.entries(UNIT_DEFINITIONS)
      .filter(([, unit]) => unit.category === category)
      .map(([key, unit]) => `<option value="${key}"${selectedUnit === key ? " selected" : ""}>${unit.label} (${key})</option>`)
      .join("");
    return `<optgroup label="${category}">${options}</optgroup>`;
  }).join("");
}
