import { convertToIngredientBaseUnit, normalizeUnit } from "./units.js";

export const INGREDIENT_SYNONYMS = Object.freeze({
  "crema de leche": ["crema", "crema leche", "cremas de leche", "nata"],
  "papa amarilla": ["papas amarillas", "patata amarilla", "patatas amarillas"],
  "cebolla roja": ["cebolla morada", "cebollas rojas", "cebollas moradas"],
  "culantro": ["cilantro", "culantros"],
  "tomate": ["tomates"],
  "limón": ["limones"],
  "papa": ["papas", "patata", "patatas"],
  "cebolla": ["cebollas"],
  "ajo": ["ajos"],
  "zanahoria": ["zanahorias"],
  "huevo": ["huevos"],
  "carne": ["carnes"]
});

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const SYNONYM_LOOKUP = new Map(
  Object.entries(INGREDIENT_SYNONYMS).flatMap(([canonical, aliases]) => {
    const normalizedCanonical = normalizeText(canonical);
    return [[normalizedCanonical, normalizedCanonical], ...aliases.map((alias) => [
      normalizeText(alias),
      normalizedCanonical
    ])];
  })
);
const CANONICAL_LABELS = new Map(
  Object.keys(INGREDIENT_SYNONYMS).map((canonical) => [normalizeText(canonical), canonical])
);
const IRREGULAR_PLURALS = new Map([
  ["limones", "limon"],
  ["melones", "melon"],
  ["nueces", "nuez"],
  ["peces", "pez"],
  ["luces", "luz"]
]);

function singularizeIngredientName(value) {
  return value.split(" ").map((word) => {
    if (IRREGULAR_PLURALS.has(word)) return IRREGULAR_PLURALS.get(word);
    if (word.length > 4 && word.endsWith("ces")) return `${word.slice(0, -3)}z`;
    if (/[aeiou]s$/.test(word) && word.length > 3) return word.slice(0, -1);
    return word;
  }).join(" ");
}

export function normalizeIngredientName(name) {
  const normalized = normalizeText(name);
  const singular = singularizeIngredientName(normalized);
  return SYNONYM_LOOKUP.get(normalized) || SYNONYM_LOOKUP.get(singular) || singular;
}

export function canonicalIngredientLabel(name) {
  const canonical = normalizeIngredientName(name);
  return CANONICAL_LABELS.get(canonical) || String(name || "").trim();
}

export function calculateRecipeConsumption(netQuantity, wastePercent) {
  const net = Number(netQuantity);
  const waste = Number(wastePercent);
  if (!Number.isFinite(net) || net < 0 || !Number.isFinite(waste) || waste < 0 || waste >= 100) {
    throw new Error("Cantidad neta o porcentaje de merma no válido.");
  }
  return net * (1 + waste / 100);
}

function roundInventoryQuantity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1_000) / 1_000;
}

export function prepareRecipeImport(parsed, inventory) {
  const issues = [...parsed.issues];
  const grouped = new Map();
  const missingIngredients = new Map();

  parsed.ingredients.forEach((item) => {
    const matches = inventory.filter((ingredient) =>
      normalizeIngredientName(ingredient.nombre) === item.canonicalName
    );
    if (matches.length !== 1) {
      issues.push({
        lineNumber: item.lineNumber,
        line: item.rawName,
        reason: matches.length ? "El nombre coincide con más de un insumo del inventario." : "El insumo no existe en el inventario."
      });
      if (matches.length === 0 && !missingIngredients.has(item.canonicalName)) {
        missingIngredients.set(item.canonicalName, {
          canonicalName: item.canonicalName,
          nombre: canonicalIngredientLabel(item.rawName),
          unidad: item.parsedUnit,
          lineNumber: item.lineNumber,
          rawName: item.rawName
        });
      }
      return;
    }

    const ingredient = matches[0];
    const converted = convertToIngredientBaseUnit(item.netQty, item.parsedUnit, ingredient);
    if (!converted || converted.noStockDeduction) {
      issues.push({
        lineNumber: item.lineNumber,
        line: item.rawName,
        reason: `No se puede convertir ${item.parsedUnit} a ${ingredient.unidad || "la unidad de inventario"} para este insumo.`
      });
      return;
    }

    const netQty = roundInventoryQuantity(converted.value);
    const consumption = roundInventoryQuantity(calculateRecipeConsumption(netQty, item.wastePct));
    if (netQty <= 0 || consumption <= 0) {
      issues.push({
        lineNumber: item.lineNumber,
        line: item.rawName,
        reason: "La cantidad es menor a la precisión admitida por inventario."
      });
      return;
    }

    const current = grouped.get(ingredient.id) || {
      ingredient,
      netQty: 0,
      consumption: 0
    };
    current.netQty += netQty;
    current.consumption += consumption;
    grouped.set(ingredient.id, current);
  });

  const rows = [...grouped.values()].map(({ ingredient, netQty, consumption }) => ({
    ingredient,
    netQty: roundInventoryQuantity(netQty),
    consumption: roundInventoryQuantity(consumption),
    wastePct: netQty > 0
      ? Number(((consumption / netQty - 1) * 100).toFixed(2))
      : 0
  }));

  return { rows, issues, missingIngredients: [...missingIngredients.values()] };
}

function isIngredientHeader(line) {
  return /^\s*(?:\[)?\s*#{0,3}\s*(?:ingredientes?|insumos?)\s*\]?:?\s*$/i.test(line);
}

function isPreparationHeader(line) {
  return /^\s*(?:\[)?\s*#{0,3}\s*(?:preparaci[oó]n|elaboraci[oó]n|pasos?|paso a paso)\s*\]?:?\s*$/i.test(line);
}

function isPresentationHeader(line) {
  return /^\s*(?:\[)?\s*#{0,3}\s*(?:terminaci[oó]n|presentaci[oó]n|emplatado|montaje)\s*\]?:?\s*$/i.test(line);
}

function parseQuantityUnit(value) {
  const match = String(value || "").trim().match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-ZáéíóúÁÉÍÓÚñÑ.\/]+)?$/);
  if (!match) return null;
  return {
    quantity: Number(match[1].replace(",", ".")),
    unit: (match[2] || "").trim()
  };
}

function parseWaste(value) {
  const match = String(value || "").match(/(\d+(?:[.,]\d+)?)\s*%?/);
  return match ? Number(match[1].replace(",", ".")) : 0;
}

function parseIngredientLine(line) {
  const cleanLine = line.replace(/^[\s\-*•\d+.)]+/, "").trim();
  if (!cleanLine) return null;

  const delimiter = ["|", ";", ":"].find((item) => cleanLine.includes(item));
  if (delimiter) {
    const parts = cleanLine.split(delimiter).map((part) => part.trim());
    const firstAmount = parseQuantityUnit(parts[0]);
    const secondAmount = parseQuantityUnit(parts[1]);
    const amount = secondAmount || firstAmount;
    const name = secondAmount ? parts[0] : firstAmount ? parts[1] : parts[0];
    if (!amount || !name) return null;
    return {
      rawName: name.replace(/^[\s\-*•]+|[\s\-–—:]+$/g, "").trim(),
      netQty: amount.quantity,
      parsedUnit: amount.unit,
      wastePct: parseWaste(parts[2])
    };
  }

  const prefix = cleanLine.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-ZáéíóúÁÉÍÓÚñÑ.\/]+)\s+(?:de\s+)?(.+)$/i);
  if (prefix && normalizeUnit(prefix[2])) {
    return {
      rawName: prefix[3].trim(),
      netQty: Number(prefix[1].replace(",", ".")),
      parsedUnit: prefix[2],
      wastePct: 0
    };
  }

  const suffix = cleanLine.match(/^(.*?)\s+(\d+(?:[.,]\d+)?)\s*([a-zA-ZáéíóúÁÉÍÓÚñÑ.\/]+)(?:\s+(?:(?:merma|desperdicio)\s*)?(\d+(?:[.,]\d+)?)\s*%?)?$/i);
  if (!suffix || !normalizeUnit(suffix[3])) return null;
  return {
    rawName: suffix[1].trim(),
    netQty: Number(suffix[2].replace(",", ".")),
    parsedUnit: suffix[3],
    wastePct: suffix[4] ? Number(suffix[4].replace(",", ".")) : 0
  };
}

export function parseRecipeText(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) {
    return { ingredients: [], issues: [], preparacion: "", presentacion: "", raw: "" };
  }

  const ingredients = [];
  const issues = [];
  const prepLines = [];
  const presentationLines = [];
  let section = "";

  rawText.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") && !isIngredientHeader(line) && !isPreparationHeader(line) && !isPresentationHeader(line)) return;
    if (isIngredientHeader(line)) { section = "ingredients"; return; }
    if (isPreparationHeader(line)) { section = "preparation"; return; }
    if (isPresentationHeader(line)) { section = "presentation"; return; }
    if (section === "ingredients") {
      const parsed = parseIngredientLine(line);
      if (!parsed) {
        issues.push({ lineNumber: index + 1, line: rawLine.trim(), reason: "No se pudo interpretar cantidad, unidad e ingrediente." });
        return;
      }
      if (!parsed.rawName || !Number.isFinite(parsed.netQty) || parsed.netQty <= 0) {
        issues.push({ lineNumber: index + 1, line: rawLine.trim(), reason: "La cantidad o el nombre del ingrediente no es válido." });
        return;
      }
      const unit = normalizeUnit(parsed.parsedUnit);
      if (!unit) {
        issues.push({ lineNumber: index + 1, line: rawLine.trim(), reason: `Unidad no reconocida: ${parsed.parsedUnit || "(vacía)"}.` });
        return;
      }
      if (!Number.isFinite(parsed.wastePct) || parsed.wastePct < 0 || parsed.wastePct >= 100) {
        issues.push({ lineNumber: index + 1, line: rawLine.trim(), reason: "La merma debe estar entre 0% y 99.9%." });
        return;
      }
      ingredients.push({
        ...parsed,
        parsedUnit: unit,
        canonicalName: normalizeIngredientName(parsed.rawName),
        lineNumber: index + 1
      });
    } else if (section === "preparation") {
      prepLines.push(rawLine);
    } else if (section === "presentation") {
      presentationLines.push(rawLine);
    }
  });

  if (!rawText.split(/\r?\n/).some(isIngredientHeader)) {
    issues.unshift({ lineNumber: 1, line: "", reason: "No se encontró la sección [INGREDIENTES]." });
  } else if (ingredients.length === 0 && !issues.length) {
    issues.push({ lineNumber: 1, line: "[INGREDIENTES]", reason: "La sección no contiene ingredientes válidos." });
  }

  return {
    ingredients,
    issues,
    preparacion: prepLines.join("\n").trim(),
    presentacion: presentationLines.join("\n").trim(),
    raw: rawText
  };
}
