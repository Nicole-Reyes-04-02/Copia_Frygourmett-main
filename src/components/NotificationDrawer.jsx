import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function NotificationDrawer({ isOpen, onClose, currentRole = 'administrador' }) {
  const [activeTab, setActiveTab] = useState('todos');

  // Notificaciones simuladas y dinámicas operativas
  const mockNotifications = [
    {
      id: 1,
      type: 'admin',
      title: 'Reporte Financiero Diario',
      message: 'El ticket promedio de hoy superó la meta estimada en un 14%.',
      time: 'Hace 10 min',
      icon: '📊'
    },
    {
      id: 2,
      type: 'almacen',
      title: 'Alerta de Stock Crítico',
      message: 'Insumo "Papas Nativas" se encuentra en 4.5 kg (Mínimo: 10 kg).',
      time: 'Hace 25 min',
      icon: '⚠️'
    },
    {
      id: 3,
      type: 'pedidos',
      title: 'Pedido Despachado #FG-1082',
      message: 'Repartidor Juan asignado para entrega en Jr. Bolognesi 412.',
      time: 'Hace 40 min',
      icon: '🛵'
    },
    {
      id: 4,
      type: 'almacen',
      title: 'Lote de Reposición Ingresado',
      message: 'Lote LOT-2026-8819 de Carne Angus registrado correctamente.',
      time: 'Hace 1 hora',
      icon: '📦'
    },
    {
      id: 5,
      type: 'admin',
      title: 'Nueva Opinión de Comensal',
      message: 'Calificación 5 estrellas en "Pollo a la Brasa Familiar".',
      time: 'Hace 2 horas',
      icon: '⭐'
    }
  ];

  const filtered = mockNotifications.filter((n) => {
    if (activeTab === 'todos') return true;
    return n.type === activeTab;
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs"
          />

          {/* Drawer Lateral */}
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-0 right-0 z-50 h-full w-full max-w-sm bg-[#0e1218] border-l border-[#1e2432] shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="p-4 border-b border-[#1e2432] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔔</span>
                <strong className="text-sm font-bold text-white">Centro de Alertas</strong>
                <span className="text-[10px] bg-amber-500/20 text-amber-400 font-bold px-2 py-0.5 rounded-full">
                  {filtered.length}
                </span>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-full bg-[#171c26] hover:bg-[#202736] text-slate-400 hover:text-white flex items-center justify-center transition"
              >
                ✕
              </button>
            </div>

            {/* Filter Tabs */}
            <div className="flex border-b border-[#1e2432] p-2 gap-1 bg-[#121620]">
              {[
                { id: 'todos', label: 'Todos' },
                { id: 'admin', label: 'Admin / Gerente' },
                { id: 'almacen', label: 'Almacén' },
                { id: 'pedidos', label: 'Reparto' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition ${
                    activeTab === tab.id
                      ? 'bg-amber-500 text-neutral-950 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {filtered.length === 0 ? (
                <p className="text-center text-xs text-slate-500 py-12">No hay alertas en esta categoría.</p>
              ) : (
                filtered.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 bg-[#141923] border border-[#1f2636] rounded-xl hover:border-amber-500/40 transition flex gap-3"
                  >
                    <span className="text-xl flex-shrink-0">{item.icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <strong className="text-xs text-white font-bold">{item.title}</strong>
                        <span className="text-[10px] text-slate-500">{item.time}</span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">{item.message}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-[#1e2432] bg-[#0b0e14] text-center">
              <span className="text-[10px] text-slate-500">
                Rol actual: <strong className="text-amber-400 uppercase">{currentRole}</strong>
              </span>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default NotificationDrawer;
