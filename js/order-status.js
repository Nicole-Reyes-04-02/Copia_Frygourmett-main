import { supabase } from "./supabase.js";
import { normalizeRole } from "./auth.js";

export const ORDER_STATUSES = [
    "Pendiente",
    "En preparación",
    "Listo",
    "En camino",
    "Entregado"
];

export const STATUS_CLASS = {
    "Pendiente": "st-pend",
    "En preparación": "st-prep",
    "Listo": "st-ready",
    "En camino": "st-way",
    "Entregado": "st-done"
};

export function normalizeOrderStatus(raw) {
    const clean = String(raw || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    if (clean === "pendiente") return "Pendiente";
    if (clean === "en preparacion") return "En preparación";
    if (clean === "listo") return "Listo";
    if (clean === "en camino") return "En camino";
    if (clean === "entregado") return "Entregado";
    return String(raw || "").trim();
}

export function getNextOrderStatus(currentStatus) {
    const normalized = normalizeOrderStatus(currentStatus);
    const index = ORDER_STATUSES.indexOf(normalized);
    if (index === -1 || index >= ORDER_STATUSES.length - 1) {
        return null;
    }
    return ORDER_STATUSES[index + 1];
}

export function canRoleTransitionOrder(role, currentStatus, targetStatus) {
    const canonicalRole = normalizeRole(role) || String(role || "").trim().toLowerCase();
    const current = normalizeOrderStatus(currentStatus);
    const target = normalizeOrderStatus(targetStatus);

    if (!ORDER_STATUSES.includes(target)) {
        return false;
    }
    if (current === target) {
        return false;
    }

    if (canonicalRole === "administrador" || canonicalRole === "recepcionista") {
        return true;
    }

    // Cocinero / Almacenero: solo estados de cocina (Pendiente -> En preparación -> Listo)
    if (canonicalRole === "almacenero" || canonicalRole === "cocinero") {
        const kitchenStatuses = ["Pendiente", "En preparación", "Listo"];
        return kitchenStatuses.includes(current) && kitchenStatuses.includes(target);
    }

    // Mandadero / Repartidor: solo estados de delivery (Listo -> En camino -> Entregado)
    if (canonicalRole === "repartidor" || canonicalRole === "mandadero") {
        const deliveryStatuses = ["Listo", "En camino", "Entregado"];
        return deliveryStatuses.includes(current) && deliveryStatuses.includes(target);
    }

    return false;
}

export function getAllowedOrderOptions(role, currentStatus) {
    const canonicalRole = normalizeRole(role) || String(role || "").trim().toLowerCase();
    const current = normalizeOrderStatus(currentStatus);

    if (canonicalRole === "administrador" || canonicalRole === "recepcionista") {
        if (!ORDER_STATUSES.includes(current) && current) {
            return [current, ...ORDER_STATUSES];
        }
        return [...ORDER_STATUSES];
    }

    if (canonicalRole === "almacenero" || canonicalRole === "cocinero") {
        const kitchenStatuses = ["Pendiente", "En preparación", "Listo"];
        if (kitchenStatuses.includes(current)) {
            return [...kitchenStatuses];
        }
        return [current];
    }

    if (canonicalRole === "repartidor" || canonicalRole === "mandadero") {
        const deliveryStatuses = ["Listo", "En camino", "Entregado"];
        if (deliveryStatuses.includes(current)) {
            return [...deliveryStatuses];
        }
        return [current];
    }

    return [current];
}

export async function updateOrderStatusInSupabase(orderId, nextStatus) {
    if (!supabase) {
        throw new Error("Supabase no está configurado.");
    }
    const normalizedNext = normalizeOrderStatus(nextStatus);
    if (!ORDER_STATUSES.includes(normalizedNext)) {
        throw new Error("Estado de pedido no válido.");
    }

    const { data, error } = await supabase
        .from("pedidos")
        .update({ estado: normalizedNext })
        .eq("id", orderId)
        .select("id, estado")
        .single();

    if (error) {
        throw error;
    }
    if (!data) {
        throw new Error("No tienes permisos para actualizar este pedido en Supabase.");
    }
    return data;
}
