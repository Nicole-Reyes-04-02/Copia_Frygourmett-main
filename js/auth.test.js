import assert from "node:assert/strict";
import test from "node:test";
import { canRoleAccessView, hasAdminAccess, isAdministrator, normalizeRole } from "./auth.js";

test("staff roles can open the internal messages view", () => {
    for (const role of ["administrador", "gerente", "recepcionista", "almacenero", "repartidor"]) {
        assert.equal(canRoleAccessView(role, "mensajes"), true, `${role} should access mensajes`);
    }
});

test("legacy role aliases normalize to canonical roles", () => {
    assert.equal(normalizeRole("mandadero"), "repartidor");
    assert.equal(normalizeRole("cocinero"), "almacenero");
    assert.equal(normalizeRole("admin"), "administrador");
});

test("administrators and managers receive management-level dashboard access", () => {
    assert.equal(hasAdminAccess("administrador"), true);
    assert.equal(hasAdminAccess("gerente"), true);
    assert.equal(hasAdminAccess("recepcionista"), false);
    assert.equal(isAdministrator("administrador"), true);
    assert.equal(isAdministrator("gerente"), false);
});

test("manager can consult operational reports but not administrator settings", () => {
    for (const view of ["resumen", "pedidos", "inventario", "personal", "mensajes"]) {
        assert.equal(canRoleAccessView("gerente", view), true, `gerente should access ${view}`);
    }
    for (const view of ["politicas", "reclamaciones", "configuracion"]) {
        assert.equal(canRoleAccessView("gerente", view), false, `gerente should not access ${view}`);
    }
    assert.equal(canRoleAccessView("administrador", "configuracion"), true);
});

test("customers cannot open the internal messages view", () => {
    assert.equal(canRoleAccessView("cliente", "mensajes"), false);
});
