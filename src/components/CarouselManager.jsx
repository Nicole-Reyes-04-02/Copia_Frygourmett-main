import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../utils/supabaseClient';

export const CAROUSEL_CATEGORIES = [
  { id: 'todos', name: 'Todos los Platos', icon: '🍽️' },
  { id: 'Bebidas', name: 'Bebidas', icon: '🍹' },
  { id: 'Hamburguesas', name: 'Hamburguesas', icon: '🍔' },
  { id: 'Kid Gourmett', name: 'Kid Gourmett', icon: '🍟' },
  { id: 'Promociones', name: 'Promociones', icon: '🏷️' },
  { id: 'Alitas', name: 'Alitas', icon: '🍗' },
  { id: 'Extras', name: 'Extras', icon: '🥔' },
  { id: 'Especiales', name: 'Platos Especiales', icon: '⭐' }
];

export function CarouselManager({ canEdit = true }) {
  const [selectedCategory, setSelectedCategory] = useState('todos');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);

  const [formData, setFormData] = useState({
    nombre: '',
    descripcion: '',
    precio: '',
    precio_regular: '',
    tiempo_preparacion: '',
    categoria: 'Bebidas',
    imagen_url: '',
    disponible: true
  });

  useEffect(() => {
    fetchProducts();
  }, [selectedCategory]);

  async function fetchProducts() {
    setLoading(true);
    try {
      let query = supabase.from('productos').select('*').order('created_at', { ascending: false });
      if (selectedCategory !== 'todos') {
        query = query.ilike('categoria', `%${selectedCategory}%`);
      }
      const { data, error } = await query;
      if (!error && data) {
        setProducts(data);
      }
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenCreate() {
    setEditingProduct(null);
    setFormData({
      nombre: '',
      descripcion: '',
      precio: '',
      precio_regular: '',
      tiempo_preparacion: '15',
      categoria: selectedCategory !== 'todos' ? selectedCategory : 'Hamburguesas',
      imagen_url: '',
      disponible: true
    });
    setShowModal(true);
  }

  function handleOpenEdit(product) {
    setEditingProduct(product);
    setFormData({
      nombre: product.nombre || '',
      descripcion: product.descripcion || '',
      precio: product.precio || '',
      precio_regular: product.precio_regular || '',
      tiempo_preparacion: product.tiempo_preparacion || '15',
      categoria: product.categoria || 'Hamburguesas',
      imagen_url: product.imagen_url || '',
      disponible: product.disponible ?? true
    });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canEdit) {
      alert('Tu rol actual no tiene permisos de edición (Solo Lectura).');
      return;
    }

    const payload = {
      nombre: formData.nombre.trim(),
      descripcion: formData.descripcion.trim(),
      precio: parseFloat(formData.precio),
      precio_regular: formData.precio_regular ? parseFloat(formData.precio_regular) : null,
      tiempo_preparacion: formData.tiempo_preparacion ? parseInt(formData.tiempo_preparacion, 10) : 15,
      categoria: formData.categoria,
      imagen_url: formData.imagen_url.trim(),
      disponible: formData.disponible
    };

    try {
      if (editingProduct) {
        const { error } = await supabase.from('productos').update(payload).eq('id', editingProduct.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('productos').insert([payload]);
        if (error) throw error;
      }
      setShowModal(false);
      fetchProducts();
    } catch (err) {
      alert('Error guardando en Supabase: ' + err.message);
    }
  }

  return (
    <div className="carousel-manager-container p-6 bg-[#0b0e14] text-white rounded-2xl border border-[#1e2432]">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between pb-6 border-b border-[#1e2432] gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>🎡</span> Gestión de Carruseles y Categorías
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Administra los 7 catálogos dinámicos que se reflejan en tiempo real en la carta de clientes.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={handleOpenCreate}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs rounded-xl transition shadow flex items-center gap-1.5"
          >
            <span>+</span> Nuevo Plato / Promoción
          </button>
        )}
      </div>

      {/* Selector de Categorías (Pills) */}
      <div className="flex items-center gap-2 overflow-x-auto py-4 scrollbar-none">
        {CAROUSEL_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
              selectedCategory === cat.id
                ? 'bg-amber-500 text-neutral-950 shadow-md font-bold'
                : 'bg-[#151a24] text-slate-300 hover:bg-[#1f2635] border border-[#232b3b]'
            }`}
          >
            <span>{cat.icon}</span>
            <span>{cat.name}</span>
          </button>
        ))}
      </div>

      {/* Grid de Platos */}
      <div className="mt-4">
        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">Cargando catálogo dinámico desde Supabase...</div>
        ) : products.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">No se encontraron productos para esta categoría.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {products.map((prod) => (
              <motion.div
                key={prod.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-[#12161f] border border-[#1e2432] rounded-xl overflow-hidden flex flex-col justify-between hover:border-amber-500/50 transition group"
              >
                <div className="relative h-40 bg-[#0b0e14] overflow-hidden">
                  <img
                    src={prod.imagen_url || 'img/Logo%20negro%20FRYGOURMETT%20con%20gorro%20y%20bigote.png'}
                    alt={prod.nombre}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    onError={(e) => { e.currentTarget.src = 'img/Logo%20negro%20FRYGOURMETT%20con%20gorro%20y%20bigote.png'; }}
                  />
                  {prod.precio_regular && prod.precio_regular > prod.precio && (
                    <span className="absolute top-2 left-2 px-2 py-0.5 bg-red-500/90 text-white font-black text-[10px] rounded uppercase tracking-wide">
                      -{Math.round(((prod.precio_regular - prod.precio) / prod.precio_regular) * 100)}%
                    </span>
                  )}
                  <span className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/70 backdrop-blur-sm text-[10px] text-amber-400 rounded font-semibold">
                    ⏱ {prod.tiempo_preparacion || 15} min
                  </span>
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">{prod.categoria}</span>
                    <h3 className="font-bold text-white text-sm mt-0.5 line-clamp-1">{prod.nombre}</h3>
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">{prod.descripcion || 'Sin descripción'}</p>
                  </div>

                  <div className="mt-3 pt-3 border-t border-[#1e2432] flex items-center justify-between">
                    <div>
                      {prod.precio_regular && prod.precio_regular > prod.precio && (
                        <span className="text-[11px] text-slate-500 line-through mr-1.5">
                          S/ {Number(prod.precio_regular).toFixed(2)}
                        </span>
                      )}
                      <strong className="text-emerald-400 font-black text-sm">
                        S/ {Number(prod.precio).toFixed(2)}
                      </strong>
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => handleOpenEdit(prod)}
                        className="text-xs text-slate-300 hover:text-amber-400 font-semibold px-2.5 py-1 rounded bg-[#1a212e] border border-[#2a3449] transition"
                      >
                        Editar
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Añadir / Editar */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#12161f] border border-[#1e2432] rounded-2xl w-full max-w-lg p-6 overflow-hidden shadow-2xl"
            >
              <div className="flex items-center justify-between pb-4 border-b border-[#1e2432]">
                <h3 className="text-lg font-bold text-white">
                  {editingProduct ? 'Editar Plato en Carrusel' : 'Nuevo Plato para Carrusel'}
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="w-8 h-8 rounded-full bg-[#1b2230] text-slate-400 hover:text-white flex items-center justify-center transition"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Nombre</label>
                  <input
                    type="text"
                    required
                    value={formData.nombre}
                    onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                    className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white text-xs focus:border-amber-500 outline-none"
                    placeholder="Ej. Hamburguesa Doble Bacon"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Categoría</label>
                    <select
                      value={formData.categoria}
                      onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                      className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white text-xs focus:border-amber-500 outline-none"
                    >
                      <option value="Bebidas">Bebidas</option>
                      <option value="Hamburguesas">Hamburguesas</option>
                      <option value="Kid Gourmett">Kid Gourmett</option>
                      <option value="Promociones">Promociones</option>
                      <option value="Alitas">Alitas</option>
                      <option value="Extras">Extras</option>
                      <option value="Especiales">Platos Especiales</option>
                      <option value="Compartir">Platos para Compartir</option>
                      <option value="Grandes">Platos Grandes</option>
                      <option value="Familiares">Platos Familiares</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Tiempo de Prep. (min)</label>
                    <input
                      type="number"
                      min="1"
                      value={formData.tiempo_preparacion}
                      onChange={(e) => setFormData({ ...formData, tiempo_preparacion: e.target.value })}
                      className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white text-xs focus:border-amber-500 outline-none"
                      placeholder="15"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Precio de Venta (S/)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={formData.precio}
                      onChange={(e) => setFormData({ ...formData, precio: e.target.value })}
                      className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white text-xs focus:border-amber-500 outline-none"
                      placeholder="42.00"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Precio Regular / Tachado (S/)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.precio_regular}
                      onChange={(e) => setFormData({ ...formData, precio_regular: e.target.value })}
                      className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white text-xs focus:border-amber-500 outline-none"
                      placeholder="Ej: 50.00"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Ruta de Imagen o URL WebP</label>
                  <input
                    type="text"
                    value={formData.imagen_url}
                    onChange={(e) => setFormData({ ...formData, imagen_url: e.target.value })}
                    className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white text-xs focus:border-amber-500 outline-none"
                    placeholder="img/Hamburguesas/Hamburguesa Doble.webp"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Descripción</label>
                  <textarea
                    rows="2"
                    value={formData.descripcion}
                    onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                    className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white text-xs focus:border-amber-500 outline-none"
                    placeholder="Carne de res seleccionada, tocino ahumado, queso cheddar fundido..."
                  />
                </div>

                <div className="pt-4 border-t border-[#1e2432] flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 rounded-lg bg-[#1b2230] text-slate-300 hover:text-white text-xs font-semibold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold shadow"
                  >
                    {editingProduct ? 'Guardar Cambios' : 'Crear Plato'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default CarouselManager;
