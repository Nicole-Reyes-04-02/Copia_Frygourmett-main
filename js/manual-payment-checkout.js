import { PaymentProviderFactory } from "../lib/payments/factory.ts";
import { escapeHtml, isSupabaseConfigured } from "./supabase.js";

const PAYMENT_METHODS = [
    { value: "yape", label: "Yape", account: "yape" },
    { value: "plin", label: "Plin", account: "yape" },
    { value: "transferencia_interbank", label: "Interbank", account: "interbank" }
];

export function mountManualPaymentCheckout(options) {
    if (!isSupabaseConfigured) {
        throw new Error("Configura Supabase antes de registrar un pago.");
    }

    const provider = PaymentProviderFactory.getProvider();
    if (provider.providerType !== "yape_plin_manual"
        || typeof provider.submitProof !== "function"
        || typeof provider.getBankAccounts !== "function") {
        throw new Error("El pago manual Yape, Plin e Interbank no está habilitado.");
    }

    const accounts = provider.getBankAccounts();
    let requestedMethod = options.paymentMethod;
    if (requestedMethod === "interbank") requestedMethod = "transferencia_interbank";

    const initialPaymentMethod = PAYMENT_METHODS.some(({ value }) => value === requestedMethod)
        ? requestedMethod
        : "yape";
    const availableMethods = options.lockPaymentMethod
        ? PAYMENT_METHODS.filter(({ value }) => value === initialPaymentMethod)
        : PAYMENT_METHODS;
    const root = document.createElement("div");
    root.className = "manual-payment-backdrop";
    root.innerHTML = `
        <section class="manual-payment-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-payment-title">
            <header class="manual-payment-header">
                <div>
                    <span class="manual-payment-eyebrow">PAGO SEGURO · FRYGOURMETT</span>
                    <h2 id="manual-payment-title">Completa tu pago</h2>
                </div>
                <button class="manual-payment-close" type="button" data-close-payment aria-label="Pagar más tarde">×</button>
            </header>
            <p class="manual-payment-amount">Monto a transferir <strong>S/ ${Number(options.totalAmount || options.orderTotal || 0).toFixed(2)}</strong></p>
            <fieldset class="manual-payment-methods">
                <legend>Elige tu método de pago</legend>
                ${availableMethods.map((method) => `
                    <button class="manual-payment-method" type="button" data-payment-method="${method.value}">
                        ${method.label}
                    </button>
                `).join("")}
            </fieldset>
            <div class="manual-payment-account" data-account-details></div>
            <form class="manual-payment-form" data-payment-form>
                <label>Número de operación
                    <input name="transactionCode" type="text" minlength="4" maxlength="80" autocomplete="off" required>
                </label>
                <label>Comprobante (PNG, JPG o WEBP; máximo 5 MB)
                    <input name="proofFile" type="file" accept="image/png,image/jpeg,image/webp" required>
                </label>
                <img class="manual-payment-preview" data-preview alt="Vista previa del comprobante" hidden>
                <p class="manual-payment-message" data-payment-message role="status" aria-live="polite"></p>
                <div class="manual-payment-actions">
                    <button class="manual-payment-secondary" type="button" data-close-payment>Pagar más tarde</button>
                    <button class="manual-payment-submit" type="submit">Enviar comprobante</button>
                </div>
            </form>
        </section>`;
    document.body.append(root);
    document.body.classList.add("modal-open");

    const form = root.querySelector("[data-payment-form]");
    const message = root.querySelector("[data-payment-message]");
    const preview = root.querySelector("[data-preview]");
    const methodButtons = [...root.querySelectorAll("[data-payment-method]")];
    let selectedMethod = initialPaymentMethod;
    let paymentId = options.paymentId || null;
    let previewUrl = null;
    let isSubmitting = false;

    function getAccount() {
        const method = PAYMENT_METHODS.find(({ value }) => value === selectedMethod);
        const accountName = method?.account;
        if (accountName === "interbank") return accounts.find((account) => account.bank === "Interbank");
        return accounts.find((account) => account.bank === "Yape / Plin");
    }

    function renderAccount() {
        methodButtons.forEach((button) => {
            const active = button.dataset.paymentMethod === selectedMethod;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
            button.disabled = Boolean(paymentId);
        });

        const account = getAccount();
        if (!account) {
            root.querySelector("[data-account-details]").textContent = "No hay datos bancarios disponibles.";
            return;
        }

        const isWallet = selectedMethod === "yape" || selectedMethod === "plin";
        const label = PAYMENT_METHODS.find(({ value }) => value === selectedMethod)?.label;
        root.querySelector("[data-account-details]").innerHTML = `
            <p class="manual-payment-account-title">Destinatario / Entidad</p>
            <strong>${escapeHtml(isWallet ? label : account.bank)}</strong>
            ${isWallet ? '<img class="manual-payment-qr" src="img/qr-yape-plin.png" alt="Código QR para pagar con Yape o Plin">' : ""}
            <dl>
                ${account.accountNumber ? `<div><dt>${isWallet ? "Número celular" : "Número de cuenta"}</dt>
                    <dd><span>${escapeHtml(account.accountNumber)}</span>
                        <button type="button" data-copy="${escapeHtml(account.accountNumber)}">Copiar</button>
                    </dd>
                </div>` : ""}
                ${!isWallet ? `<div><dt>CCI</dt><dd><span>${escapeHtml(account.cci)}</span>
                    <button type="button" data-copy="${escapeHtml(account.cci)}">Copiar</button></dd></div>` : ""}
                <div><dt>Titular</dt><dd>${escapeHtml(account.beneficiary)}</dd></div>
            </dl>`;
    }

    function close() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        root.remove();
        document.body.classList.remove("modal-open");
        options.onClose?.();
    }

    methodButtons.forEach((button) => {
        button.addEventListener("click", () => {
            if (paymentId) return;
            selectedMethod = button.dataset.paymentMethod;
            renderAccount();
        });
    });

    root.addEventListener("click", async (event) => {
        const closeButton = event.target.closest("[data-close-payment]");
        if (closeButton) {
            close();
            return;
        }
        const copyButton = event.target.closest("[data-copy]");
        if (!copyButton) return;
        try {
            await navigator.clipboard.writeText(copyButton.dataset.copy);
            message.textContent = "Dato copiado.";
            message.classList.remove("is-error");
        } catch {
            message.textContent = "No se pudo copiar. Selecciona y copia el dato manualmente.";
            message.classList.add("is-error");
        }
    });

    root.querySelector('[name="proofFile"]').addEventListener("change", (event) => {
        const file = event.currentTarget.files?.[0];
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        preview.hidden = true;
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            event.currentTarget.value = "";
            message.textContent = "La imagen no debe superar los 5 MB.";
            message.classList.add("is-error");
            return;
        }
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
            event.currentTarget.value = "";
            message.textContent = "Adjunta una imagen PNG, JPG o WEBP.";
            message.classList.add("is-error");
            return;
        }
        previewUrl = URL.createObjectURL(file);
        preview.src = previewUrl;
        preview.hidden = false;
        message.textContent = "";
        message.classList.remove("is-error");
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (isSubmitting || !form.reportValidity()) return;

        const transactionCode = form.elements.transactionCode.value.trim();
        const file = form.elements.proofFile.files?.[0];
        if (transactionCode.length < 4 || !file) {
            message.textContent = "Ingresa un número de operación y adjunta el comprobante.";
            message.classList.add("is-error");
            return;
        }

        const submitButton = form.querySelector('[type="submit"]');
        isSubmitting = true;
        submitButton.disabled = true;
        submitButton.textContent = "Enviando…";
        message.textContent = "";
        message.classList.remove("is-error");

        try {
            if (!paymentId) {
                const intent = await provider.createPaymentIntent({
                    orderId: options.orderId,
                    amount: Number(options.totalAmount || options.orderTotal || 0),
                    currency: "PEN",
                    paymentMethod: selectedMethod,
                    customer: {
                        id: options.customerId,
                        fullName: options.customerName,
                        email: options.customerEmail,
                        phone: options.customerPhone
                    }
                });
                paymentId = intent.paymentId;
                renderAccount();
            }

            await provider.submitProof({
                paymentId,
                orderId: options.orderId,
                transactionCode,
                file,
                fileName: file.name
            });
            close();
            await options.onPaymentSubmitted?.(paymentId);
            if (options.onSuccess) options.onSuccess({ orderId: options.orderId, code: transactionCode });
        } catch (error) {
            message.textContent = error instanceof Error ? error.message : "No se pudo enviar el comprobante.";
            message.classList.add("is-error");
        } finally {
            isSubmitting = false;
            if (submitButton.isConnected) {
                submitButton.disabled = false;
                submitButton.textContent = "Enviar comprobante";
            }
        }
    });

    renderAccount();
    root.querySelector(`[data-payment-method="${selectedMethod}"]`)?.focus();
    return { close };
}

export function openManualPaymentCheckout(options) {
    return mountManualPaymentCheckout({
        orderId: options.orderId,
        totalAmount: options.orderTotal ?? options.totalAmount,
        paymentMethod: options.paymentMethod,
        lockPaymentMethod: Boolean(options.paymentMethod),
        customerName: options.customerName,
        customerEmail: options.customerEmail,
        customerPhone: options.customerPhone,
        onPaymentSubmitted: options.onSuccess,
        onSuccess: options.onSuccess,
        onClose: options.onCancel
    });
}
