import assert from "node:assert/strict";
import test from "node:test";
import { convertToIngredientBaseUnit, convertToInventoryUnit, normalizeUnit } from "./units.js";

test("normaliza alias de unidades requeridas", () => {
  assert.equal(normalizeUnit("libras"), "lb");
  assert.equal(normalizeUnit("cucharada"), "cda");
  assert.equal(normalizeUnit("und."), "ud");
});

test("convierte peso a la unidad de inventario", () => {
  assert.equal(convertToInventoryUnit(1, "kg", { unidad: "g" }), 1000);
  assert.equal(convertToInventoryUnit(1, "lb", { unidad: "kg" }), 0.453592);
});

test("convierte volumen y medidas de cocina", () => {
  assert.equal(convertToInventoryUnit(1, "L", { unidad: "ml" }), 1000);
  assert.equal(convertToInventoryUnit(1, "taza", { unidad: "ml" }), 240);
  assert.equal(convertToInventoryUnit(1, "cda", { unidad: "ml" }), 15);
  assert.equal(convertToInventoryUnit(1, "cdta", { unidad: "ml" }), 5);
  assert.equal(convertToInventoryUnit(1, "pizca", { unidad: "ml" }), 1);
});

test("convierte conteo y rechaza dimensiones incompatibles", () => {
  assert.equal(convertToInventoryUnit(1, "docena", { unidad: "ud" }), 12);
  assert.equal(convertToInventoryUnit(1, "kg", { unidad: "ml" }), null);
});

test("usa densidad al convertir volumen a peso", () => {
  assert.deepEqual(
    convertToIngredientBaseUnit(1, "taza", { unidad: "g", densidad: 0.9 }),
    { value: 216, unit: "g", base: "g", noStockDeduction: false }
  );
});
