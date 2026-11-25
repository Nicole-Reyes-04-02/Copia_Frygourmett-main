import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountingReport } from "./report-export.js";

test("builds accounting rows and totals from order items", () => {
    const report = buildAccountingReport([{
        id: "order-1",
        created_at: "2025-01-15T12:30:00.000Z",
        cliente_nombre: "Cliente",
        estado: "Entregado",
        total: "42.5",
        items: [
            { cantidad: 2, nombre: "Alitas" },
            { cantidad: 1, nombre: "Bebida" }
        ]
    }], new Date("2025-01-15T12:45:00.000Z"));

    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].quantity, 3);
    assert.equal(report.rows[0].total, 42.5);
    assert.equal(report.totalQuantity, 3);
    assert.equal(report.totalAmount, 42.5);
    assert.match(report.exportedAt, /15\/01\/2025/);
});

test("rejects empty order data before any export renderer can run", () => {
    assert.throws(() => buildAccountingReport([]), /No hay pedidos para exportar/);
    assert.throws(() => buildAccountingReport(null), /No hay pedidos para exportar/);
});
