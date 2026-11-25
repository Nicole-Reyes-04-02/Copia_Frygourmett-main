import { PaymentProviderFactory } from "../lib/payments/factory.ts";
import { escapeHtml, isSupabaseConfigured, supabase } from "./supabase.js";

const container = document.getElementById("pending-payments-review");
const allowedRoles = new Set(["admin", "administrador", "gerente", "manager", "recepcionista"]);
const statusLabels = {
    pending_verification: "Por verificar",
    paid: "Aprobados",
    failed: "Rechazados",
    refunded: "Reembolsados"
};
let payments = [];
let selectedStatus = "pending_verification";
let selectedProof = "";
let message = "";
let messageIsError = false;
let channel = null;
let sessionVersion = 0;
let actionPaymentId = "";

if (container && isSupabaseConfigured) {
    function render() {
        const visiblePayments = selectedStatus === "all"
            ? payments
            : payments.filter((payment) => payment.status === selectedStatus);

        container.innerHTML = `
            <section class="pending-payments-card" aria-labelledby="pending-payments-title">
                <header class="pending-payments-heading">
                    <div>
                        <p class="pending-payments-eyebrow">PAGOS MANUALES</p>
                        <h3 id="pending-payments-title">Comprobantes Yape, Plin y transferencias</h3>
                    </div>
                    <button class="pending-payments-refresh" type="button" data-refresh-payments>Actualizar</button>
                </header>
                <div class="pending-payments-filters" role="group" aria-label="Filtrar pagos">
                    ${[
                        ["pending_verification", "Por verificar"],
                        ["paid", "Aprobados"],
                        ["failed", "Rechazados"],
                        ["all", "Todos"]
                    ].map(([value, label]) => `
                        <button type="button" data-payment-filter="${value}"
                            aria-pressed="${selectedStatus === value}">
                            ${label} <span>${value === "all"
                                ? payments.length
                                : payments.filter((payment) => payment.status === value).length}</span>
                        </button>
                    `).join("")}
                </div>
                <p class="pending-payments-message${messageIsError ? " is-error" : ""}" role="status" aria-live="polite">
                    ${escapeHtml(message)}
                </p>
                ${visiblePayments.length ? `
                    <div class="pending-payments-table-wrap">
                        <table class="pending-payments-table">
                            <thead><tr>
                                <th>Pedido / cliente</th><th>Método / operación</th><th>Monto</th>
                                <th>Comprobante</th><th>Fecha</th><th>Acciones</th>
                            </tr></thead>
                            <tbody>
                                ${visiblePayments.map((payment) => renderPaymentRow(payment)).join("")}
                            </tbody>
                        </table>
                    </div>
                ` : `<p class="pending-payments-empty">No hay pagos en esta categoría.</p>`}
                ${selectedProof ? `
                    <div class="pending-proof-backdrop" data-close-proof>
                        <div class="pending-proof-dialog" role="dialog" aria-modal="true" aria-label="Comprobante de pago">
                            <button type="button" data-close-proof aria-label="Cerrar comprobante">×</button>
                            <img src="${escapeHtml(selectedProof)}" alt="Comprobante de pago">
                        </div>
                    </div>
                ` : ""}
            </section>`;
    }

    function renderPaymentRow(payment) {
        const order = Array.isArray(payment.pedidos) ? payment.pedidos[0] : payment.pedidos;
        const customer = order?.cliente_nombre || "Comensal";
        const amount = new Intl.NumberFormat("es-PE", {
            style: "currency",
            currency: payment.currency || "PEN"
        }).format(Number(payment.amount));
        const date = new Intl.DateTimeFormat("es-PE", {
            dateStyle: "short",
            timeStyle: "short"
        }).format(new Date(payment.created_at));
        const method = String(payment.payment_method || "").replaceAll("_", " ");

        return `<tr>
            <td><strong>#${escapeHtml(String(payment.order_id).slice(0, 8).toUpperCase())}</strong>
                <small>${escapeHtml(customer)}</small></td>
            <td>${escapeHtml(method)}<small>Op.: ${escapeHtml(payment.transaction_code || "Sin código")}</small></td>
            <td>${escapeHtml(amount)}</td>
            <td>${payment.proof_url
                ? `<button type="button" class="pending-proof-link" data-proof="${escapeHtml(payment.proof_url)}">Ver comprobante</button>`
                : `<span class="pending-payments-muted">Sin captura</span>`}</td>
            <td>${escapeHtml(date)}</td>
            <td>${payment.status === "pending_verification" ? `
                <div class="pending-payment-actions">
                    <button type="button" data-approve-payment="${escapeHtml(payment.id)}"
                        ${actionPaymentId === payment.id ? "disabled" : ""}>Aprobar</button>
                    <button type="button" data-reject-payment="${escapeHtml(payment.id)}"
                        ${actionPaymentId === payment.id ? "disabled" : ""}>Rechazar</button>
                </div>
            ` : `<span class="pending-payment-status">${escapeHtml(statusLabels[payment.status] || payment.status)}</span>`}</td>
        </tr>`;
    }

    async function loadPayments() {
        const { data, error } = await supabase
            .from("payments")
            .select("id, order_id, payment_method, amount, currency, status, transaction_code, proof_url, created_at, pedidos:order_id(cliente_nombre)")
            .order("created_at", { ascending: false });
        if (error) throw new Error(`No se pudieron cargar los pagos: ${error.message}`);
        payments = data || [];
        render();
    }

    async function reviewPayment(paymentId, approved, adminNotes) {
        actionPaymentId = paymentId;
        message = approved ? "Aprobando pago…" : "Rechazando pago…";
        messageIsError = false;
        render();

        try {
            const provider = PaymentProviderFactory.getProvider("yape_plin_manual");
            const result = await provider.verifyPayment(paymentId, {
                transactionCode: payments.find((payment) => payment.id === paymentId)?.transaction_code || "",
                approved,
                adminNotes
            });
            if (result.status !== (approved ? "paid" : "failed")) {
                throw new Error("La pasarela devolvió un estado inesperado.");
            }
            await loadPayments();
            message = approved
                ? "Pago aprobado. El pedido fue enviado a preparación."
                : "Pago rechazado.";
            messageIsError = false;
        } catch (error) {
            message = error instanceof Error ? error.message : "No se pudo actualizar el pago.";
            messageIsError = true;
        } finally {
            actionPaymentId = "";
            render();
        }
    }

    container.addEventListener("click", (event) => {
        const filterButton = event.target.closest("[data-payment-filter]");
        if (filterButton) {
            selectedStatus = filterButton.dataset.paymentFilter;
            render();
            return;
        }
        if (event.target.closest("[data-refresh-payments]")) {
            loadPayments().catch((error) => {
                message = error.message;
                messageIsError = true;
                render();
            });
            return;
        }
        const proofButton = event.target.closest("[data-proof]");
        if (proofButton) {
            selectedProof = proofButton.dataset.proof;
            render();
            return;
        }
        if (event.target.closest("[data-close-proof]")) {
            selectedProof = "";
            render();
            return;
        }
        const approveButton = event.target.closest("[data-approve-payment]");
        if (approveButton) {
            void reviewPayment(approveButton.dataset.approvePayment, true, "Pago verificado por administración.");
            return;
        }
        const rejectButton = event.target.closest("[data-reject-payment]");
        if (rejectButton) {
            const reason = window.prompt("Indica el motivo del rechazo del comprobante:");
            if (reason === null) return;
            void reviewPayment(rejectButton.dataset.rejectPayment, false, reason.trim() || "Comprobante rechazado.");
        }
    });

    async function syncSession(session) {
        const currentVersion = ++sessionVersion;
        if (channel) {
            void supabase.removeChannel(channel);
            channel = null;
        }
        container.hidden = true;
        payments = [];
        if (!session?.user) return;

        const { error } = await supabase
            .from('usuarios_admin')
            .update({ activo: nuevoEstado })
            .eq('user_id', idDelTrabajador);
        if (currentVersion !== sessionVersion) return;
        if (error) {
            container.hidden = false;
            message = `No se pudo validar el acceso: ${error.message}`;
            messageIsError = true;
            render();
            return;
        }
        if (!profile?.activo || !allowedRoles.has(profile.rol)) return;

        container.hidden = false;
        message = "Cargando comprobantes…";
        messageIsError = false;
        render();
        try {
            await loadPayments();
        } catch (loadError) {
            message = loadError instanceof Error ? loadError.message : "No se pudieron cargar los pagos.";
            messageIsError = true;
            render();
        }
        if (currentVersion !== sessionVersion) return;

        channel = supabase.channel("pending-payments-review")
            .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => {
                loadPayments().catch((loadError) => {
                    message = loadError.message;
                    messageIsError = true;
                    render();
                });
            })
            .subscribe((status) => {
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    message = "No se pudo conectar la actualización en tiempo real.";
                    messageIsError = true;
                    render();
                }
            });
    }

    const { data, error } = await supabase.auth.getSession();
    if (error) {
        container.hidden = false;
        message = `No se pudo verificar la sesión: ${error.message}`;
        messageIsError = true;
        render();
    } else {
        await syncSession(data.session);
    }

    supabase.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => {
            syncSession(session).catch((error) => {
                container.hidden = false;
                message = error instanceof Error ? error.message : "No se pudo verificar el acceso.";
                messageIsError = true;
                render();
            });
        }, 0);
    });
}
