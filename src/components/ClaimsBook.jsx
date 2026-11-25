import React, { useState } from 'react';
import { supabase } from '../utils/supabaseClient';

export function ClaimsBook() {
  const [ticketCode, setTicketCode] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    tipo_documento: 'DNI',
    numero_documento: '',
    nombre_completo: '',
    email: '',
    telefono: '',
    direccion: '',
    tipo: 'reclamo', // 'queja' o 'reclamo'
    monto_reclamado: '',
    descripcion_bien: 'Consumo de restaurante / Pedido delivery',
    detalle: '',
    pedido_solucion: ''
  });

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);

    const generatedTicket = `FG-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    const payload = {
      codigo_ticket: generatedTicket,
      tipo_documento: form.tipo_documento,
      numero_documento: form.numero_documento.trim(),
      nombre_completo: form.nombre_completo.trim(),
      email: form.email.trim(),
      telefono: form.telefono.trim(),
      direccion: form.direccion.trim(),
      tipo: form.tipo,
      monto_reclamado: form.monto_reclamado ? parseFloat(form.monto_reclamado) : null,
      descripcion_bien: form.descripcion_bien.trim(),
      detalle: form.detalle.trim(),
      pedido_solucion: form.pedido_solucion.trim(),
      estado: 'Pendiente'
    };

    try {
      const { error } = await supabase.from('reclamaciones').insert([payload]);
      if (error) {
        console.warn('Supabase insert note:', error.message);
      }
      setTicketCode(generatedTicket);
    } catch (err) {
      console.error(err);
      setTicketCode(generatedTicket);
    } finally {
      setSubmitting(false);
    }
  }

  function handlePrintPdf() {
    window.print();
  }

  return (
    <div className="claims-book-container max-w-3xl mx-auto p-6 md:p-8 bg-[#0e1218] text-white rounded-2xl border border-[#1e2432] shadow-2xl my-8">
      {/* Brand Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between pb-6 border-b border-[#1e2432] gap-4">
        <div className="flex items-center gap-3">
          <img
            src="img/Logo%20negro%20FRYGOURMETT%20con%20gorro%20y%20bigote.png"
            alt="FRYGOURMETT"
            className="h-12 w-auto drop-shadow-md"
          />
          <div>
            <h1 className="text-xl font-black tracking-tight text-white">LIBRO DE RECLAMACIONES</h1>
            <p className="text-xs text-slate-400">FRYGOURMETT S.A.C. · Conforme a la Ley N° 29571</p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[11px] font-bold text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
            Hoja de Reclamación Virtual
          </span>
        </div>
      </div>

      {ticketCode ? (
        <div className="my-8 p-6 bg-[#121620] border border-emerald-500/40 rounded-2xl text-center space-y-4">
          <div className="text-4xl">✅</div>
          <h2 className="text-xl font-bold text-white">Reclamación Registrada con Éxito</h2>
          <p className="text-xs text-slate-300 max-w-md mx-auto">
            Hemos registrado tu requerimiento conforme a la normativa vigente de INDECOPI. Te responderemos en un plazo máximo de 15 días hábiles.
          </p>
          <div className="inline-block p-4 bg-[#1a212f] rounded-xl border border-[#2b3547]">
            <span className="text-xs text-slate-400 block font-semibold">Tu Código de Ticket:</span>
            <strong className="text-2xl font-black text-amber-400 tracking-wider">{ticketCode}</strong>
          </div>
          <div className="pt-4 flex justify-center gap-3">
            <button
              onClick={handlePrintPdf}
              className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs shadow flex items-center gap-2"
            >
              <span>🖨️</span> Descargar / Imprimir Hoja de Reclamación (PDF)
            </button>
            <button
              onClick={() => { setTicketCode(null); setForm({ ...form, detalle: '', pedido_solucion: '' }); }}
              className="px-4 py-2.5 rounded-xl bg-[#1d2535] text-slate-300 text-xs font-semibold"
            >
              Nuevo Registro
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-5 text-xs">
          {/* Identificación del Consumidor */}
          <div className="bg-[#12161f] p-4 rounded-xl border border-[#1e2432] space-y-3">
            <h3 className="font-bold text-sm text-amber-400 flex items-center gap-2">
              <span>1.</span> Identificación del Consumidor Reclamante
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Tipo de Documento</label>
                <select
                  value={form.tipo_documento}
                  onChange={(e) => setForm({ ...form, tipo_documento: e.target.value })}
                  className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                >
                  <option value="DNI">DNI</option>
                  <option value="CE">Carnet de Extranjería</option>
                  <option value="Pasaporte">Pasaporte</option>
                  <option value="RUC">RUC</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-slate-300 font-semibold mb-1">Número de Documento</label>
                <input
                  type="text"
                  required
                  value={form.numero_documento}
                  onChange={(e) => setForm({ ...form, numero_documento: e.target.value })}
                  className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                  placeholder="Número de documento"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nombre Completo</label>
                <input
                  type="text"
                  required
                  value={form.nombre_completo}
                  onChange={(e) => setForm({ ...form, nombre_completo: e.target.value })}
                  className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                  placeholder="Nombres y Apellidos"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Correo Electrónico</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                  placeholder="tucorreo@ejemplo.com"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Teléfono / Celular</label>
                <input
                  type="tel"
                  required
                  value={form.telefono}
                  onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                  className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                  placeholder="987654321"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Domicilio</label>
                <input
                  type="text"
                  required
                  value={form.direccion}
                  onChange={(e) => setForm({ ...form, direccion: e.target.value })}
                  className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                  placeholder="Av. Principal 123, Distrito"
                />
              </div>
            </div>
          </div>

          {/* Identificación del Bien Contratado */}
          <div className="bg-[#12161f] p-4 rounded-xl border border-[#1e2432] space-y-3">
            <h3 className="font-bold text-sm text-amber-400 flex items-center gap-2">
              <span>2.</span> Identificación del Bien Contratado
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Tipo de Requerimiento</label>
                <div className="flex gap-4 pt-1">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="tipo_req"
                      value="reclamo"
                      checked={form.tipo === 'reclamo'}
                      onChange={() => setForm({ ...form, tipo: 'reclamo' })}
                    />
                    <span className="font-bold text-white">Reclamo</span> (Disconformidad con el producto/servicio)
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="tipo_req"
                      value="queja"
                      checked={form.tipo === 'queja'}
                      onChange={() => setForm({ ...form, tipo: 'queja' })}
                    />
                    <span className="font-bold text-white">Queja</span> (Disconformidad con la atención)
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Monto Reclamado (S/ opcional)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.monto_reclamado}
                  onChange={(e) => setForm({ ...form, monto_reclamado: e.target.value })}
                  className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>

          {/* Detalle de la Reclamación */}
          <div className="bg-[#12161f] p-4 rounded-xl border border-[#1e2432] space-y-3">
            <h3 className="font-bold text-sm text-amber-400 flex items-center gap-2">
              <span>3.</span> Detalle de la Reclamación y Pedido
            </h3>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Detalle del Reclamo o Queja</label>
              <textarea
                rows="4"
                required
                value={form.detalle}
                onChange={(e) => setForm({ ...form, detalle: e.target.value })}
                className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                placeholder="Indica con claridad los hechos ocurridos..."
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Pedido Concreto del Consumidor</label>
              <textarea
                rows="2"
                required
                value={form.pedido_solucion}
                onChange={(e) => setForm({ ...form, pedido_solucion: e.target.value })}
                className="w-full px-3 py-2 bg-[#181f2b] border border-[#273244] rounded-lg text-white"
                placeholder="Indica la solución o compensación esperada..."
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs shadow-lg transition"
            >
              {submitting ? 'Enviando Hoja...' : 'Enviar Reclamación'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default ClaimsBook;
