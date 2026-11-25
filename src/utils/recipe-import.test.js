import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateRecipeConsumption,
  normalizeIngredientName,
  parseRecipeText,
  prepareRecipeImport
} from "./recipe-import.js";

test("parsea la plantilla de receta existente", async () => {
  const template = await readFile(new URL("../../public/plantilla_receta.txt", import.meta.url), "utf8");
  const parsed = parseRecipeText(template);
  assert.equal(parsed.ingredients.length, 5);
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.ingredients[0].parsedUnit, "kg");
  assert.equal(parsed.ingredients[0].wastePct, 10);
  assert.match(parsed.preparacion, /wok/i);

  const inventory = [
    { id: "loin", nombre: "Lomo Fino", unidad: "kg" },
    { id: "potato", nombre: "Papa Amarilla", unidad: "kg" },
    { id: "onion", nombre: "Cebolla Roja", unidad: "kg" },
    { id: "tomato", nombre: "Tomate", unidad: "kg" },
    { id: "rice", nombre: "Arroz Blanco", unidad: "kg" }
  ];
  const plan = prepareRecipeImport(parsed, inventory);
  assert.equal(plan.rows.length, 5);
  assert.equal(plan.issues.length, 0);
  assert.equal(plan.rows.find((row) => row.ingredient.id === "loin").consumption, 0.22);
});

test("normaliza sinónimos y registra líneas mal formadas sin detener el parseo", () => {
  const parsed = parseRecipeText([
    "[INGREDIENTES]",
    "- Crema | 250 ml | 5%",
    "- línea incompleta",
    "- Crema de leche | 100 ml | 0%",
    "- Nata 50 ml 2%"
  ].join("\n"));

  assert.equal(normalizeIngredientName("crema"), "crema de leche");
  assert.equal(normalizeIngredientName("PAPAS AMARILLAS"), "papa amarilla");
  assert.equal(normalizeIngredientName("tomates"), "tomate");
  assert.equal(normalizeIngredientName("limones"), "limon");
  assert.equal(parsed.ingredients.length, 3);
  assert.equal(parsed.ingredients[0].canonicalName, parsed.ingredients[1].canonicalName);
  assert.equal(parsed.ingredients[2].wastePct, 2);
  assert.equal(parsed.issues.length, 1);
  assert.equal(parsed.issues[0].lineNumber, 3);
});

test("calcula el consumo real aplicando la merma", () => {
  assert.ok(Math.abs(calculateRecipeConsumption(0.2, 10) - 0.22) < 1e-12);
});

test("no acepta una sección de ingredientes vacía como receta válida", () => {
  const parsed = parseRecipeText("[INGREDIENTES]\n[PREPARACION]\nMezclar.");
  assert.equal(parsed.ingredients.length, 0);
  assert.equal(parsed.issues.length, 1);
  assert.match(parsed.issues[0].reason, /no contiene ingredientes/i);
});

test("prepara descuentos normalizados y conserva las líneas sin coincidencia en el log", () => {
  const parsed = parseRecipeText([
    "[INGREDIENTES]",
    "- Crema | 250 ml | 5%",
    "- Salsa desconocida | 2 L | 0%",
    "- línea incompleta"
  ].join("\n"));
  const inventory = [{ id: "cream-1", nombre: "Crema de leche", unidad: "ml", cantidad: 1000 }];
  const plan = prepareRecipeImport(parsed, inventory);

  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].netQty, 250);
  assert.equal(plan.rows[0].consumption, 262.5);
  assert.equal(plan.issues.length, 2);
  assert.deepEqual(plan.missingIngredients.map((item) => item.nombre), ["Salsa desconocida"]);
  assert.equal(plan.missingIngredients[0].unidad, "L");
});
