import { supabase } from "../supabase.js";

export async function revertRecipeInventoryMovement(movementId) {
  if (!supabase) {
    throw new Error("Supabase no está configurado.");
  }
  if (!movementId) {
    throw new Error("El movimiento que se desea revertir no es válido.");
  }

  const { data, error } = await supabase.rpc("revertir_movimiento_inventario_receta", {
    p_movimiento_id: movementId
  });
  if (error) {
    throw new Error(`No se pudo revertir el descuento: ${error.message}`);
  }
  if (!data) {
    throw new Error("Supabase no confirmó la reversión del movimiento.");
  }
  return data;
}

export async function registerInventoryReplenishment(ingredientId, quantity, reason) {
  if (!supabase) {
    throw new Error("Supabase no está configurado.");
  }
  const amount = Number(quantity);
  if (!ingredientId || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("El ingrediente y una cantidad positiva son obligatorios.");
  }

  const { data, error } = await supabase.rpc("registrar_reposicion_inventario", {
    p_ingrediente_id: ingredientId,
    p_cantidad: amount,
    p_motivo: String(reason || "").trim()
  });
  if (error) {
    throw new Error(`No se pudo registrar la reposición: ${error.message}`);
  }
  if (!data) {
    throw new Error("Supabase no confirmó el movimiento de reposición.");
  }
  return data;
}
