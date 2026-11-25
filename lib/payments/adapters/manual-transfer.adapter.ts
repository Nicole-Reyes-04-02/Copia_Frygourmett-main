import { 
    PaymentGatewayProvider, 
    PaymentProviderType, 
    CreatePaymentIntentInput, 
    PaymentIntentResult, 
    VerificationResult, 
    WebhookResult,
    BankAccountInfo 
} from '../types';
import { createClient } from '@supabase/supabase-js';

const OFFICIAL_ACCOUNTS: BankAccountInfo[] = [
    {
        bank: 'Yape / Plin',
        accountType: 'Ahorros',
        accountNumber: '968776288',
        cci: '',
        beneficiary: 'Cristopher Sifontes / FRYGOURMETT'
    },
    {
        bank: 'Interbank',
        accountType: 'Ahorros',
        accountNumber: '',
        cci: '00310701348562090009',
        beneficiary: 'Cristopher Sifontes / FRYGOURMETT'
    }
];

export class ManualTransferAdapter implements PaymentGatewayProvider {
    public readonly providerType: PaymentProviderType = 'yape_plin_manual';

    private supabaseUrl: string;
    private supabaseKey: string;

    constructor(supabaseUrl?: string, supabaseKey?: string) {
        this.supabaseUrl = supabaseUrl || import.meta.env.VITE_SUPABASE_URL || '';
        this.supabaseKey = supabaseKey || import.meta.env.VITE_SUPABASE_ANON_KEY || '';
    }

    private getClient() {
        return createClient(this.supabaseUrl, this.supabaseKey);
    }

    getBankAccounts(): BankAccountInfo[] {
        return OFFICIAL_ACCOUNTS.map((account) => ({ ...account }));
    }

    /**
     * Paso 1: Crea el intento de pago manual en estado "pending_verification"
     */
    async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
        const supabase = this.getClient();

        const { data, error } = await supabase
            .from('payments')
            .insert({
                order_id: input.orderId,
                provider: this.providerType,
                payment_method: input.paymentMethod,
                amount: input.amount,
                currency: input.currency || 'PEN',
                status: 'pending_verification',
                metadata: {
                    customer: input.customer,
                    channel: 'web_checkout_v1',
                    created_via: 'manual_transfer_adapter',
                    ...input.metadata
                }
            })
            .select('id, status')
            .single();

        if (error) {
            throw new Error(`[ManualTransferAdapter] Error al registrar intento de pago: ${error.message}`);
        }

        return {
            paymentId: data.id,
            provider: this.providerType,
            status: 'pending_verification',
            requiresManualProof: true,
            ...(input.paymentMethod === 'yape' || input.paymentMethod === 'plin'
                ? { qrCodeUrl: '/img/qr-yape-plin.png' }
                : {}),
            bankAccounts: this.getBankAccounts(),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 min de ventana para pagar
        };
    }

    /**
     * Paso 2: Subir captura de comprobante a Supabase Storage y asociar código de operación
     */
    async submitProof(params: {
        paymentId: string;
        orderId: string;
        transactionCode: string;
        file: File | Blob;
        fileName?: string;
    }): Promise<{ proofUrl: string; paymentId: string }> {
        const supabase = this.getClient();
        const extension = params.fileName ? params.fileName.split('.').pop() : 'jpg';
        const storagePath = `proofs/${params.orderId}/${Date.now()}_${params.transactionCode}.${extension}`;

        // Subir al bucket 'payment-proofs'
        const { error: uploadError } = await supabase
            .storage
            .from('payment-proofs')
            .upload(storagePath, params.file, {
                cacheControl: '3600',
                upsert: false
            });

        if (uploadError) {
            throw new Error(`Error al subir comprobante a Storage: ${uploadError.message}`);
        }

        // Obtener URL del archivo (o firmada si es privado)
        const { data: urlData } = supabase
            .storage
            .from('payment-proofs')
            .getPublicUrl(storagePath);

        const proofUrl = urlData.publicUrl;

        // Actualizar tabla payments
        const { error: updateError } = await supabase
            .from('payments')
            .update({
                transaction_code: params.transactionCode,
                proof_url: proofUrl,
                status: 'pending_verification',
                updated_at: new Date().toISOString()
            })
            .eq('id', params.paymentId);

        if (updateError) {
            throw new Error(`Error al asociar comprobante al pago: ${updateError.message}`);
        }

        return { proofUrl, paymentId: params.paymentId };
    }

    /**
     * Paso 3: Validación por el Administrador / Chef
     */
    async verifyPayment(
        paymentId: string, 
        proofData?: { transactionCode: string; proofUrl?: string; adminNotes?: string; approved?: boolean }
    ): Promise<VerificationResult> {
        const supabase = this.getClient();
        const isApproved = proofData?.approved !== false;
        const newStatus = isApproved ? 'paid' : 'failed';

        // 1. Actualizar el pago
        const { data: payment, error } = await supabase
            .from('payments')
            .update({
                status: newStatus,
                metadata: {
                    verified_by: 'manual_chef',
                    verified_at: new Date().toISOString(),
                    admin_notes: proofData?.adminNotes || (isApproved ? 'Pago verificado manualmente en cuenta' : 'Comprobante no coincide o ilegible')
                },
                updated_at: new Date().toISOString()
            })
            .eq('id', paymentId)
            .select('id, order_id, status')
            .single();

        if (error || !payment) {
            throw new Error(`Error al actualizar estado del pago: ${error?.message}`);
        }

        // 2. Si se aprueba, pasar el pedido a 'En preparación' (preparing)
        if (isApproved) {
            const { error: orderError } = await supabase
                .from('pedidos')
                .update({ 
                    estado: 'En preparación',
                    nota: `Pago validado #${paymentId.slice(0, 8)}`
                })
                .eq('id', payment.order_id);
            if (orderError) {
                throw new Error(`Pago actualizado, pero no se pudo enviar el pedido a cocina: ${orderError.message}`);
            }
        }

        return {
            paymentId: payment.id,
            orderId: payment.order_id,
            status: newStatus,
            verifiedAt: new Date().toISOString(),
            verifiedBy: 'manual_chef',
            message: isApproved ? 'Pago verificado con éxito. Pedido enviado a cocina.' : 'Pago rechazado.'
        };
    }

    /**
     * Webhook para conciliación externa (o bots automáticos como bot de Telegram / SMS bancario)
     */
    async handleWebhook(payload: unknown): Promise<WebhookResult> {
        const body = payload as { transactionCode?: string; amount?: number; paymentId?: string };
        if (!body.paymentId) {
            return { handled: false, error: 'Falta paymentId en el payload' };
        }

        const verification = await this.verifyPayment(body.paymentId, {
            transactionCode: body.transactionCode || 'AUTO_BOT',
            approved: true,
            adminNotes: 'Verificación automática asistida por conciliación'
        });

        return {
            handled: true,
            paymentId: verification.paymentId,
            orderId: verification.orderId,
            newStatus: verification.status
        };
    }
}
