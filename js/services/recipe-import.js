import { supabase } from "../supabase.js";
import { normalizeIngredientName } from "../../src/utils/recipe-import.js";

export async function createMissingRecipeIngredients(candidates, currentInventory) {
    if (!supabase) {
        throw new Error("Supabase no está configurado.");
    }
    if (!Array.isArray(candidates) || !Array.isArray(currentInventory)) {
        throw new Error("No se pudo validar la lista de insumos de la receta.");
    }

    let inventory = [...currentInventory];
    const created = [];
    const notices = [];

    for (const candidate of candidates) {
        const existing = inventory.filter((item) =>
            normalizeIngredientName(item.nombre) === candidate.canonicalName
        );
        if (existing.length === 1) continue;

        const { data, error } = await supabase.from("ingredientes").insert({
            nombre: candidate.nombre,
            cantidad: 0,
            minimo: 0,
            unidad: candidate.unidad,
            precio_unitario: 0,
            categoria: "Otros"
        }).select("*").single();

        if (error) {
            if (error.code === "23505") {
                const { data: refreshed, error: refreshError } = await supabase
                    .from("ingredientes")
                    .select("*")
                    .order("nombre");
                if (!refreshError) {
                    inventory = refreshed || [];
                    const matches = inventory.filter((item) =>
                        normalizeIngredientName(item.nombre) === candidate.canonicalName
                    );
                    if (matches.length === 1) {
                        notices.push({
                            lineNumber: candidate.lineNumber,
                            line: candidate.rawName,
                            reason: `Se vinculó el insumo existente «${matches[0].nombre}».`
                        });
                        continue;
                    }
                } else {
                    notices.push({
                        lineNumber: candidate.lineNumber,
                        line: candidate.rawName,
                        reason: `No se pudo actualizar el inventario tras detectar un nombre duplicado: ${refreshError.message}`
                    });
                    continue;
                }
            }

            notices.push({
                lineNumber: candidate.lineNumber,
                line: candidate.rawName,
                reason: `No se pudo crear el insumo automáticamente: ${error.message}`
            });
            continue;
        }

        inventory.push(data);
        created.push(data);
    }

    inventory.sort((left, right) => left.nombre.localeCompare(right.nombre, "es"));
    return { inventory, created, notices };
}

export async function saveImportedRecipe(productId, rows) {
    if (!supabase) {
        throw new Error("Supabase no está configurado.");
    }
    if (!productId || !Array.isArray(rows)) {
        throw new Error("Se necesita un plato guardado y una lista válida de insumos.");
    }

    const recipe = rows.map(({ ingredient, netQty, wastePct, consumption }) => ({
        ingrediente_id: ingredient.id,
        cantidad_neta: Number(netQty),
        porcentaje_merma: Number(wastePct),
        cantidad_por_porcion: Number(consumption)
    }));

    if (recipe.some((item) =>
        !item.ingrediente_id
        || !Number.isFinite(item.cantidad_neta) || item.cantidad_neta <= 0
        || !Number.isFinite(item.porcentaje_merma) || item.porcentaje_merma < 0 || item.porcentaje_merma >= 100
        || !Number.isFinite(item.cantidad_por_porcion) || item.cantidad_por_porcion <= 0
    )) {
        throw new Error("La receta contiene cantidades o porcentajes de merma no válidos.");
    }

    const { data, error } = await supabase.rpc("reemplazar_receta_producto", {
        p_producto_id: productId,
        p_receta: recipe
    });
    if (error) {
        throw new Error(`No se pudo guardar automáticamente la receta: ${error.message}`);
    }
    if (Number(data) !== recipe.length) {
        throw new Error("Supabase no confirmó todos los ingredientes de la receta.");
    }
    return recipe.length;
}
