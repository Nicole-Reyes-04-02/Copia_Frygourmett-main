import { PaymentGatewayProvider, PaymentProviderType } from './types';
import { ManualTransferAdapter } from './adapters/manual-transfer.adapter';
import { DirectBankAdapter } from './adapters/direct-bank.adapter';

/**
 * Factory para resolver pasarelas de pago de forma desacoplada.
 */
export class PaymentProviderFactory {
    private static manualAdapter: ManualTransferAdapter;
    private static directBankAdapter: DirectBankAdapter;

    /**
     * Obtiene el proveedor adecuado según el tipo o la configuración global del sistema
     */
    static getProvider(type?: PaymentProviderType): PaymentGatewayProvider {
        const activeType = type || (import.meta.env.VITE_ACTIVE_PAYMENT_PROVIDER as PaymentProviderType) || 'yape_plin_manual';

        switch (activeType) {
            case 'bank_direct':
                if (!this.directBankAdapter) {
                    this.directBankAdapter = new DirectBankAdapter();
                }
                return this.directBankAdapter;

            case 'yape_plin_manual':
            case 'culqi_niubiz_temp':
            default:
                if (!this.manualAdapter) {
                    this.manualAdapter = new ManualTransferAdapter();
                }
                return this.manualAdapter;
        }
    }
}
