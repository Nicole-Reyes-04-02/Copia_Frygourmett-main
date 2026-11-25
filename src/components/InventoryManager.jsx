import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { UNIT_CATEGORIES, convertToBaseUnit } from '../utils/units';

export function InventoryManager({ canEdit = true }) {
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showRestockModal, setShowRestockModal] = useState(false);
  const [selectedIngredient, setSelectedIngredient] = useState(null);

  const [restockForm, setRestockForm] = useState({
    cantidad: '',
    unidad: 'kg',
    lote: '',
    vencimiento: '',
    proveedor: '',
    costo: ''
  });

  useEffect(() => {
    fetchInventory();
  }, []);

  async function fetchInventory() {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('ingredientes').select('*').order('nombre');
      if (!error && data) {
        setIngredients(data);
      }
    } catch (err) {
      console.error('Error fetching inventory:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenRestock(ing) {
    setSelectedIngredient(ing);
    setRestockForm({
      cantidad: '',
      unidad: ing.unidad_medida || 'kg',
      lote: `LOT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      vencimiento: '',
      proveedor: '',
      costo: ''
    });
    setShowRestockModal(true);
  }

  async function handleSaveRestock(e) {
    e.preventDefault();
    if (!canEdit) {
      alert('Tu rol actual no tiene permisos de edición.');
      return;
    }

    const qty = parseFloat(restockForm.cantidad);
    if (!qty || qty <= 0) return;

    // Convert to base unit
    const baseQty = convertToBaseUnit(qty, restockForm.unidad, selectedIngredient.nombre);

    try {
      // 1. Log lote de reposicion
      await supabase.from('reposiciones_lotes').insert([
        {
          ingrediente_id: selectedIngredient.id,
          codigo_lote: restockForm.lote,
          cantidad_ingresada: qty,
          unidad: restockForm.unidad,
          cantidad_base: baseQty,
          fecha_vencimiento: restockForm.vencimiento || null,
          proveedor: restockForm.proveedor || null,
          costo_total: restockForm.costo ? parseFloat(restockForm.costo) : null
        }
      ]).catch(() => {});

      // 2. Update stock in ingredientes
      const newStock = (parseFloat(selectedIngredient.stock_actual) || 0) + baseQty;
      const { error: updErr } = await supabase
        .from('ingredientes')
        .update({ stock_actual: newStock })
        .eq('id', selectedIngredient.id);

      if (updErr) throw updErr;

      // 3. Log movement
      await supabase.from('movimientos_inventario').insert([
        {
          ingrediente_id: selectedIngredient.id,
          tipo_movimiento: 'Reposición',
          cantidad: baseQty,
          motivo: `Lote ${restockForm.lote}`
        }
      ]).catch(() => {});

      alert(`Lote ${restockForm.lote} registrado exitosamente. Stock actualizado.`);
      setShowRestockModal(false);
      fetchInventory();
    } catch (err) {
      alert('Error en reposición: ' + err.message);
    }
  }

  // Exportar .txt
  function exportTxt() {
    let content = `FRYGOURMETT - REPORTE DE INVENTARIO\nFecha: ${new Date().toLocaleString()}\n`;
    content += `========================================================================\n`;
    content += `Insumo | Stock Actual | Unidad Base | Estado\n`;
    content += `------------------------------------------------------------------------\n`;

    ingredients.forEach((ing) => {
      const stock = parseFloat(ing.stock_actual) || 0;
      const min = parseFloat(ing.stock_minimo) || 0;
      const status = stock <= min ? 'CRITICO' : 'NORMAL';
      content += `${ing.nombre} | ${stock.toFixed(2)} | ${ing.unidad_medida} | ${status}\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventario_frygourmett_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Exportar / Imprimir PDF
  function printPdf() {
    window.print();
  }

  return (
    <div className="inventory-manager p-6 bg-[#0b0e14] text-white rounded-2xl border border-[#1e2432]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-6 border-b border-[#1e2432] gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>📦</span> Control de Inventario y Lotes de Reposición
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Unidades categorizadas (Peso, Volumen, Cocina, Conteo y al gusto). Registro de movimientos y trazabilidad.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportTxt}
            className="px-3.5 py-2 rounded-xl bg-[#1a2230] hover:bg-[#253044] border border-[#273244] text-xs font-semibold text-slate-300 transition"
          >
            📄 Exportar TXT
          </button>
          <button
            onClick={printPdf}
            className="px-3.5 py-2 rounded-xl bg-[#1a2230] hover:bg-[#253044] border border-[#273244] text-xs font-semibold text-slate-300 transition"
          >
            🖨️ Imprimir / PDF
          </button>
        </div>
      </div>

      {/* Tabla de Insumos */}
      <div className="mt-6 overflow-x-auto">
        {loading ? (
          <p className="py-8 text-center text-slate-400 text-sm">Cargando stock en tiempo real...</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-[#1e2432]">
                <th className="pb-3 font-semibold">Insumo</th>
                <th className="pb-3 font-semibold">Stock Actual</th>
                <th className="pb-3 font-semibold">Unidad Base</th>
                <th className="pb-3 font-semibold">Stock Mínimo</th>
                <th className="pb-3 font-semibold">Estado</th>
                {canEdit && <th className="pb-3 text-right">Acción</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#18202d]">
              {ingredients.map((ing) => {
                const stock = parseFloat(ing.stock_actual) || 0;
                const min = parseFloat(ing.stock_minimo) || 0;
                const isLow = stock <= min;

                return (
                  <tr key={ing.id} className="hover:bg-[#121620]">
                    <td className="py-3 font-bold text-white">{ing.nombre}</td>
                    <td className="py-3 font-bold text-amber-400">
                      {stock.toFixed(2)}
                    </td>
                    <td className="py-3 text-slate-400">{ing.unidad_medida}</td>
                    <td className="py-3 text-slate-500">{min.toFixed(2)}</td>
                    <td className="py-3">
                      {isLow ? (
                        <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-bold">
                          Bajo Stock
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                          Óptimo
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenRestock(ing)}
                          className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-neutral-950 font-bold border border-amber-500/30 transition text-[11px]"
                        >
                          + Reponer Lote
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal Lote de Reposición */}
      {showRestockModal && selectedIngredient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-[#12161f] border border-[#1e2432] rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-[#1e2432]">
              <div>
                <h3 className="text-base font-bold text-white">Ingreso de Lote de Reposición</h3>
                <p className="text-xs text-amber-400 mt-0.5">{selectedIngredient.nombre}</p>
              </div>
              <button
                onClick={() => setShowRestockModal(false)}
                className="w-7 h-7 rounded-full bg-[#1b2230] text-slate-400 hover:text-white flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRestock} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Código de Lote</label>
                <input
                  type="text"
                  required
                  value={restockForm.lote}
                  onChange={(e) => setRestockForm({ ...restockForm, lote: e.target.value })}
                  className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Cantidad</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={restockForm.cantidad}
                    onChange={(e) => setRestockForm({ ...restockForm, cantidad: e.target.value })}
                    className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                    placeholder="Ej. 10"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Unidad Ingresada</label>
                  <select
                    value={restockForm.unidad}
                    onChange={(e) => setRestockForm({ ...restockForm, unidad: e.target.value })}
                    className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                  >
                    <optgroup label="Peso">
                      <option value="kg">kg (Kilogramo)</option>
                      <option value="g">g (Gramo)</option>
                      <option value="lb">lb (Libra)</option>
                    </optgroup>
                    <optgroup label="Volumen">
                      <option value="L">L (Litro)</option>
                      <option value="ml">ml (Mililitro)</option>
                      <option value="gal">gal (Galón)</option>
                    </optgroup>
                    <optgroup label="Cocina">
                      <option value="taza">taza (Cup)</option>
                      <option value="cucharada">cucharada (tbsp)</option>
                      <option value="cucharadita">cucharadita (tsp)</option>
                      <option value="pizca">pizca (pinch)</option>
                    </optgroup>
                    <optgroup label="Conteo">
                      <option value="unidad">unidad (u)</option>
                      <option value="docena">docena (dz)</option>
                      <option value="diente">diente</option>
                    </optgroup>
                    <optgroup label="Especial">
                      <option value="al_gusto">al gusto (sin descuento)</option>
                    </optgroup>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Fecha Vencimiento</label>
                  <input
                    type="date"
                    value={restockForm.vencimiento}
                    onChange={(e) => setRestockForm({ ...restockForm, vencimiento: e.target.value })}
                    className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Costo Total (S/)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={restockForm.costo}
                    onChange={(e) => setRestockForm({ ...restockForm, costo: e.target.value })}
                    className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                    placeholder="Ej. 120.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Proveedor</label>
                <input
                  type="text"
                  value={restockForm.proveedor}
                  onChange={(e) => setRestockForm({ ...restockForm, proveedor: e.target.value })}
                  className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                  placeholder="Distribuidora San Fernando S.A."
                />
              </div>

              <div className="pt-3 border-t border-[#1e2432] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRestockModal(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-[#1a2230] text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold"
                >
                  Registrar Entrada
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default InventoryManager;
