/**
 * FRYGOURMETT - Sistema de Pagos
 * Definición de tipos, contratos y arquitectura desacoplada (Strategy Pattern)
 */

export type PaymentProviderType = 
    | 'yape_plin_manual' 
    | 'culqi_niubiz_temp' 
    | 'bank_direct';

export type PaymentMethodType = 
    | 'yape' 
    | 'plin' 
    | 'transferencia_interbank'
    | 'tarjeta_debito_credito'
    | 'efectivo_contraentrega';

export type PaymentStatus = 
    | 'pending_verification' 
    | 'paid' 
    | 'failed' 
    | 'refunded';

export type Currency = 'PEN' | 'USD';

export interface PaymentRecord {
    id: string;
    order_id: string;
    provider: PaymentProviderType;
    payment_method: PaymentMethodType;
    amount: number;
    currency: Currency;
    status: PaymentStatus;
    transaction_code?: string | null;
    proof_url?: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface CreatePaymentIntentInput {
    orderId: string;
    amount: number;
    currency?: Currency;
    paymentMethod: PaymentMethodType;
    customer: {
        id?: string;
        fullName: string;
        email: string;
        phone: string;
    };
    metadata?: Record<string, unknown>;
}

export interface PaymentIntentResult {
    paymentId: string;
    provider: PaymentProviderType;
    status: PaymentStatus;
    requiresManualProof: boolean;
    qrCodeUrl?: string;
    bankAccounts?: BankAccountInfo[];
    checkoutUrl?: string;
    expiresAt?: string;
    rawResponse?: Record<string, unknown>;
}

export interface BankAccountInfo {
    bank: string;
    accountType: 'Ahorros' | 'Corriente';
    accountNumber: string;
    cci: string;
    beneficiary: string;
}

export interface ManualProofSubmission {
    paymentId: string;
    orderId: string;
    transactionCode: string;
    proofFile: File | Blob;
    fileName?: string;
    notes?: string;
}

export interface VerificationResult {
    paymentId: string;
    orderId: string;
    status: PaymentStatus;
    verifiedAt: string;
    verifiedBy?: string; // 'manual_chef' | 'webhook_banco'
    message: string;
    metadata?: Record<string, unknown>;
}

export interface WebhookResult {
    handled: boolean;
    paymentId?: string;
    orderId?: string;
    newStatus?: PaymentStatus;
    error?: string;
}

/**
 * Contrato Strategy: Interfaz universal para pasarelas de pago.
 * Permite cambiar de validación manual a API bancaria directa
 * sin tocar el frontend ni la capa de pedidos.
 */
export interface PaymentGatewayProvider {
    readonly providerType: PaymentProviderType;

    /**
     * Inicializa el intento de pago para la orden
     */
    createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult>;

    /**
     * Valida o aprueba el pago (manual asistido o consulta a API del banco)
     */
    verifyPayment(
        paymentId: string, 
        proofData?: { transactionCode: string; proofUrl?: string; adminNotes?: string }
    ): Promise<VerificationResult>;

    /**
     * Procesa notificaciones asíncronas de bancos / adquirentes (Webhooks)
     */
    handleWebhook(payload: unknown, signature?: string): Promise<WebhookResult>;
}
