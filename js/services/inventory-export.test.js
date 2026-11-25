import assert from "node:assert/strict";
import test from "node:test";
import { buildInventoryAccountingReport } from "./inventory-export.js";

test("builds inventory rows and totals from numeric stock values", () => {
    const report = buildInventoryAccountingReport([
        { nombre: "Harina", categoria: "Abarrotes", cantidad: "2.5", unidad: "kg", minimo: 1, precio_unitario: "3.20" },
        { nombre: "Leche", categoria: "Lácteos", cantidad: 4, unidad: "L", minimo: 2, precio_unitario: 5 }
    ], new Date("2026-03-10T18:00:00.000Z"));

    assert.equal(report.rows.length, 2);
    assert.equal(report.rows[0].totalValue, 8);
    assert.equal(report.totalValue, 28);
    assert.match(report.exportedAt, /10\/03\/2026/);
});

test("rejects empty or invalid inventory before exporting", () => {
    assert.throws(() => buildInventoryAccountingReport([]), /No hay ingredientes/);
    assert.throws(() => buildInventoryAccountingReport([
        { nombre: "Harina", cantidad: -1, minimo: 0, precio_unitario: 1 }
    ]), /existencias de Harina/);
});
