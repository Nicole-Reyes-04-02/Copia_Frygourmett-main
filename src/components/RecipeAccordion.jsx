import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../utils/supabaseClient';
import { convertToBaseUnit } from '../utils/units';

export function RecipeAccordion({ canEdit = true }) {
  const [products, setProducts] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [activeAccordionId, setActiveAccordionId] = useState(null);
  const [loading, setLoading] = useState(false);

  // Per-product recipe items state: { [productId]: [ { id, ingrediente_id, cantidad_neta, merma_pct, unidad } ] }
  const [recipesState, setRecipesState] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [{ data: prodData }, { data: ingData }, { data: recipeData }] = await Promise.all([
        supabase.from('productos').select('*').order('nombre'),
        supabase.from('ingredientes').select('*').order('nombre'),
        supabase.from('producto_insumos').select('*')
      ]);

      if (prodData) setProducts(prodData);
      if (ingData) setIngredients(ingData);

      if (recipeData) {
        const map = {};
        recipeData.forEach((r) => {
          if (!map[r.producto_id]) map[r.producto_id] = [];
          map[r.producto_id].push({
            id: r.id,
            ingrediente_id: r.ingrediente_id,
            cantidad_neta: r.cantidad_por_porcion || 1,
            merma_pct: r.merma_porcentaje || 0,
            unidad: r.unidad || 'unidad'
          });
        });
        setRecipesState(map);
      }
    } catch (err) {
      console.error('Error loading recipes data:', err);
    } finally {
      setLoading(false);
    }
  }

  function toggleAccordion(id) {
    setActiveAccordionId(activeAccordionId === id ? null : id);
  }

  function handleIngredientChange(productId, index, field, value) {
    const list = [...(recipesState[productId] || [])];
    list[index] = { ...list[index], [field]: value };
    setRecipesState({ ...recipesState, [productId]: list });
  }

  function handleAddIngredient(productId) {
    if (!ingredients.length) return;
    const list = [...(recipesState[productId] || [])];
    list.push({
      ingrediente_id: ingredients[0].id,
      cantidad_neta: 1,
      merma_pct: 0,
      unidad: ingredients[0].unidad_medida || 'unidad'
    });
    setRecipesState({ ...recipesState, [productId]: list });
  }

  function handleRemoveIngredient(productId, index) {
    const list = [...(recipesState[productId] || [])];
    list.splice(index, 1);
    setRecipesState({ ...recipesState, [productId]: list });
  }

  // Parse .txt file (Ingrediente | Cantidad | Unidad)
  function handleTxtUpload(productId, e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text !== 'string') return;

      const lines = text.split('\n');
      const parsedItems = [];

      lines.forEach((line) => {
        const clean = line.trim();
        if (!clean || clean.startsWith('#')) return;

        const parts = clean.split('|').map((p) => p.trim());
        if (parts.length >= 2) {
          const ingName = parts[0].toLowerCase();
          const cant = parseFloat(parts[1]) || 1;
          const unit = parts[2] || 'unidad';
          const merma = parts[3] ? parseFloat(parts[3]) : 0;

          const matched = ingredients.find((i) => i.nombre.toLowerCase().includes(ingName));
          if (matched) {
            parsedItems.push({
              ingrediente_id: matched.id,
              cantidad_neta: cant,
              merma_pct: merma,
              unidad: unit
            });
          }
        }
      });

      if (parsedItems.length > 0) {
        setRecipesState({
          ...recipesState,
          [productId]: [...(recipesState[productId] || []), ...parsedItems]
        });
        alert(`Se importaron ${parsedItems.length} insumos desde el archivo.`);
      } else {
        alert('No se pudieron asociar insumos del archivo con el inventario actual.');
      }
    };
    reader.readAsText(file);
  }

  // Guardar receta y auto-colapsar acordeón
  async function handleSaveRecipe(productId) {
    if (!canEdit) {
      alert('Tu rol actual no tiene permisos de edición.');
      return;
    }

    const items = recipesState[productId] || [];
    try {
      // 1. Delete previous insumos
      await supabase.from('producto_insumos').delete().eq('producto_id', productId);

      // 2. Insert new insumos & calculate deduction
      if (items.length > 0) {
        const rows = items.map((item) => ({
          producto_id: productId,
          ingrediente_id: item.ingrediente_id,
          cantidad_por_porcion: parseFloat(item.cantidad_neta),
          merma_porcentaje: parseFloat(item.merma_pct || 0),
          unidad: item.unidad
        }));

        const { error: insError } = await supabase.from('producto_insumos').insert(rows);
        if (insError) throw insError;

        // 3. Log stock movement (Consumo por Receta)
        for (const it of items) {
          const net = parseFloat(it.cantidad_neta) || 0;
          const merma = parseFloat(it.merma_pct) || 0;
          const realConsumption = net * (1 + merma / 100);
          const baseQty = convertToBaseUnit(realConsumption, it.unidad);

          if (baseQty > 0) {
            await supabase.from('movimientos_inventario').insert([
              {
                ingrediente_id: it.ingrediente_id,
                tipo_movimiento: 'Consumo por Receta',
                cantidad: baseQty,
                motivo: `Ajuste de receta para producto ID: ${productId}`
              }
            ]).catch(() => {});
          }
        }
      }

      alert('Receta guardada exitosamente. Movimiento registrado.');
      // Auto-colapsar acordeón tras guardar
      setActiveAccordionId(null);
    } catch (err) {
      alert('Error guardando receta: ' + err.message);
    }
  }

  return (
    <div className="recipe-accordions-wrapper p-6 bg-[#0b0e14] text-white rounded-2xl border border-[#1e2432]">
      <div className="pb-6 border-b border-[#1e2432]">
        <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <span>🌿</span> Recetas y Control de Merma por Plato
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Formula interactiva: <code className="bg-[#181f2b] px-2 py-0.5 rounded text-amber-400 text-xs">Consumo Real = Cantidad Neta * (1 + (Merma % / 100))</code>.
          Importa recetas en .txt y descuenta automáticamente insumos del inventario.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-center py-8 text-slate-400 text-sm">Cargando recetas de cocina...</p>
        ) : (
          products.map((prod) => {
            const isOpen = activeAccordionId === prod.id;
            const items = recipesState[prod.id] || [];

            return (
              <div
                key={prod.id}
                className="border border-[#1e2432] rounded-xl overflow-hidden bg-[#12161f] transition"
              >
                {/* Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleAccordion(prod.id)}
                  className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-[#161c28] transition"
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={prod.imagen_url || 'img/Logo%20negro%20FRYGOURMETT%20con%20gorro%20y%20bigote.png'}
                      alt=""
                      className="w-10 h-10 rounded-lg object-cover bg-black"
                      onError={(e) => { e.currentTarget.src = 'img/Logo%20negro%20FRYGOURMETT%20con%20gorro%20y%20bigote.png'; }}
                    />
                    <div>
                      <h4 className="font-bold text-sm text-white">{prod.nombre}</h4>
                      <p className="text-xs text-slate-400">
                        {items.length} {items.length === 1 ? 'insumo configurado' : 'insumos configurados'} · {prod.categoria}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                      S/ {Number(prod.precio).toFixed(2)}
                    </span>
                    <span className={`text-slate-400 text-sm transform transition duration-200 ${isOpen ? 'rotate-180' : ''}`}>
                      ▼
                    </span>
                  </div>
                </button>

                {/* Collapsible Content */}
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeInOut' }}
                      className="overflow-hidden border-t border-[#1e2432] bg-[#0e121a] p-5"
                    >
                      {/* Subir archivo .txt */}
                      {canEdit && (
                        <div className="mb-4 p-3 bg-[#151a24] rounded-lg border border-[#222b3b] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                          <div>
                            <span className="text-xs font-bold text-slate-300 block">
                              📄 Cargar receta en lote (.txt)
                            </span>
                            <span className="text-[11px] text-slate-500">
                              Formato: <code>Ingrediente | Cantidad | Unidad | Merma%</code>
                            </span>
                          </div>
                          <label className="cursor-pointer px-3 py-1.5 bg-[#202838] hover:bg-[#2b364c] text-xs font-semibold text-slate-200 rounded-lg border border-[#2f3b52] transition">
                            <span>Subir .txt</span>
                            <input
                              type="file"
                              accept=".txt"
                              onChange={(e) => handleTxtUpload(prod.id, e)}
                              className="hidden"
                            />
                          </label>
                        </div>
                      )}

                      {/* Tabla de Insumos */}
                      {items.length === 0 ? (
                        <p className="text-xs text-slate-500 py-3 text-center">
                          Aún no se han configurado insumos para este plato.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="text-slate-400 border-b border-[#1e2432] pb-2">
                                <th className="pb-2 font-semibold">Insumo</th>
                                <th className="pb-2 font-semibold">Cant. Neta</th>
                                <th className="pb-2 font-semibold">Unidad</th>
                                <th className="pb-2 font-semibold">Merma %</th>
                                <th className="pb-2 font-semibold">Consumo Real</th>
                                {canEdit && <th className="pb-2 text-right">Acción</th>}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#18202d]">
                              {items.map((it, idx) => {
                                const net = parseFloat(it.cantidad_neta) || 0;
                                const merma = parseFloat(it.merma_pct) || 0;
                                const real = (net * (1 + merma / 100)).toFixed(2);

                                return (
                                  <tr key={idx} className="hover:bg-[#121620]">
                                    <td className="py-2.5">
                                      {canEdit ? (
                                        <select
                                          value={it.ingrediente_id}
                                          onChange={(e) => handleIngredientChange(prod.id, idx, 'ingrediente_id', e.target.value)}
                                          className="bg-[#181f2b] border border-[#273244] text-white text-xs rounded px-2 py-1 outline-none"
                                        >
                                          {ingredients.map((ing) => (
                                            <option key={ing.id} value={ing.id}>{ing.nombre}</option>
                                          ))}
                                        </select>
                                      ) : (
                                        <span className="font-semibold text-white">
                                          {ingredients.find((i) => i.id === it.ingrediente_id)?.nombre || 'Insumo'}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2.5">
                                      {canEdit ? (
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          value={it.cantidad_neta}
                                          onChange={(e) => handleIngredientChange(prod.id, idx, 'cantidad_neta', e.target.value)}
                                          className="w-20 bg-[#181f2b] border border-[#273244] text-white text-xs rounded px-2 py-1 outline-none"
                                        />
                                      ) : (
                                        <span>{it.cantidad_neta}</span>
                                      )}
                                    </td>
                                    <td className="py-2.5">
                                      {canEdit ? (
                                        <input
                                          type="text"
                                          value={it.unidad}
                                          onChange={(e) => handleIngredientChange(prod.id, idx, 'unidad', e.target.value)}
                                          className="w-20 bg-[#181f2b] border border-[#273244] text-white text-xs rounded px-2 py-1 outline-none"
                                        />
                                      ) : (
                                        <span>{it.unidad}</span>
                                      )}
                                    </td>
                                    <td className="py-2.5">
                                      {canEdit ? (
                                        <input
                                          type="number"
                                          step="0.5"
                                          min="0"
                                          max="100"
                                          value={it.merma_pct}
                                          onChange={(e) => handleIngredientChange(prod.id, idx, 'merma_pct', e.target.value)}
                                          className="w-16 bg-[#181f2b] border border-[#273244] text-white text-xs rounded px-2 py-1 outline-none"
                                        />
                                      ) : (
                                        <span>{it.merma_pct}%</span>
                                      )}
                                    </td>
                                    <td className="py-2.5 text-amber-400 font-bold">
                                      {real} {it.unidad}
                                    </td>
                                    {canEdit && (
                                      <td className="py-2.5 text-right">
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveIngredient(prod.id, idx)}
                                          className="text-red-400 hover:text-red-300 font-bold px-2 py-0.5 rounded transition"
                                        >
                                          ✕
                                        </button>
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Footer Actions */}
                      {canEdit && (
                        <div className="mt-4 pt-3 border-t border-[#1e2432] flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => handleAddIngredient(prod.id)}
                            className="px-3 py-1.5 rounded-lg bg-[#1a212e] border border-[#273244] text-slate-300 hover:text-white text-xs font-semibold"
                          >
                            + Añadir Fila
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveRecipe(prod.id)}
                            className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs shadow"
                          >
                            Guardar Receta y Cerrar
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default RecipeAccordion;
