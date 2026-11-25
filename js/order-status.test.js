import assert from "node:assert/strict";
import test from "node:test";
import {
    ORDER_STATUSES,
    normalizeOrderStatus,
    getNextOrderStatus,
    canRoleTransitionOrder,
    getAllowedOrderOptions
} from "./order-status.js";

test("order statuses follow sequential flow without improper jumps", () => {
    assert.deepEqual(ORDER_STATUSES, [
        "Pendiente",
        "En preparación",
        "Listo",
        "En camino",
        "Entregado"
    ]);
    assert.equal(getNextOrderStatus("Pendiente"), "En preparación");
    assert.equal(getNextOrderStatus("En preparación"), "Listo");
    assert.equal(getNextOrderStatus("Listo"), "En camino");
    assert.equal(getNextOrderStatus("En camino"), "Entregado");
    assert.equal(getNextOrderStatus("Entregado"), null);
});

test("order status normalization handles casing, whitespace and accents", () => {
    assert.equal(normalizeOrderStatus("pendiente"), "Pendiente");
    assert.equal(normalizeOrderStatus("  EN PREPARACION "), "En preparación");
    assert.equal(normalizeOrderStatus("listO"), "Listo");
    assert.equal(normalizeOrderStatus("en camino"), "En camino");
    assert.equal(normalizeOrderStatus("ENTREGADO"), "Entregado");
});

test("administrador and recepcionista have all 5 options in selector and can transition across statuses", () => {
    for (const role of ["administrador", "recepcionista"]) {
        assert.deepEqual(getAllowedOrderOptions(role, "Pendiente"), ORDER_STATUSES);
        assert.deepEqual(getAllowedOrderOptions(role, "En preparación"), ORDER_STATUSES);
        assert.deepEqual(getAllowedOrderOptions(role, "Listo"), ORDER_STATUSES);
        assert.deepEqual(getAllowedOrderOptions(role, "En camino"), ORDER_STATUSES);
        assert.deepEqual(getAllowedOrderOptions(role, "Entregado"), ORDER_STATUSES);

        assert.equal(canRoleTransitionOrder(role, "Pendiente", "En preparación"), true);
        assert.equal(canRoleTransitionOrder(role, "En preparación", "Listo"), true);
        assert.equal(canRoleTransitionOrder(role, "Listo", "En camino"), true);
        assert.equal(canRoleTransitionOrder(role, "En camino", "Entregado"), true);
        assert.equal(canRoleTransitionOrder(role, "Pendiente", "Listo"), true);
        assert.equal(canRoleTransitionOrder(role, "Entregado", "Pendiente"), true);
    }
});

test("cocinero/almacenero can only manage kitchen statuses", () => {
    for (const role of ["cocinero", "almacenero"]) {
        assert.deepEqual(getAllowedOrderOptions(role, "Pendiente"), ["Pendiente", "En preparación", "Listo"]);
        assert.deepEqual(getAllowedOrderOptions(role, "En preparación"), ["Pendiente", "En preparación", "Listo"]);
        assert.equal(canRoleTransitionOrder(role, "Pendiente", "En preparación"), true);
        assert.equal(canRoleTransitionOrder(role, "En preparación", "Listo"), true);
        assert.equal(canRoleTransitionOrder(role, "Listo", "En camino"), false);
        assert.equal(canRoleTransitionOrder(role, "En camino", "Entregado"), false);
    }
});

test("mandadero/repartidor can only manage delivery statuses including En camino -> Entregado", () => {
    for (const role of ["mandadero", "repartidor"]) {
        assert.deepEqual(getAllowedOrderOptions(role, "Listo"), ["Listo", "En camino", "Entregado"]);
        assert.deepEqual(getAllowedOrderOptions(role, "En camino"), ["Listo", "En camino", "Entregado"]);
        assert.equal(canRoleTransitionOrder(role, "Pendiente", "En preparación"), false);
        assert.equal(canRoleTransitionOrder(role, "En preparación", "Listo"), false);
        assert.equal(canRoleTransitionOrder(role, "Listo", "En camino"), true);
        assert.equal(canRoleTransitionOrder(role, "En camino", "Entregado"), true);
        assert.equal(canRoleTransitionOrder(role, "Entregado", "Pendiente"), false);
    }
});

test("gerente and cliente cannot modify order status and only see current status in selector", () => {
    for (const role of ["gerente", "cliente"]) {
        assert.deepEqual(getAllowedOrderOptions(role, "Pendiente"), ["Pendiente"]);
        assert.deepEqual(getAllowedOrderOptions(role, "En preparación"), ["En preparación"]);
        assert.deepEqual(getAllowedOrderOptions(role, "Entregado"), ["Entregado"]);
        assert.equal(canRoleTransitionOrder(role, "Pendiente", "En preparación"), false);
        assert.equal(canRoleTransitionOrder(role, "En camino", "Entregado"), false);
    }
});
