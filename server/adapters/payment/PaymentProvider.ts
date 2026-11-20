import crypto from 'crypto';

export type PaymentProviderId =
  | 'AIRTEL_MONEY'
  | 'ORANGE_MONEY'
  | 'VODACOM_MPESA'
  | 'FLEXPAY_AGGREGATOR'
  | 'CARD_INTL';

export type PaymentStatus = 'INITIATED' | 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';

export interface PaymentInitRequest {
  reference: string;
  idempotencyKey: string;
  amount: number;
  currency: 'USD' | 'CDF';
  phoneNumber?: string;
  description: string;
}

export interface PaymentInitResponse {
  reference: string;
  externalRef: string;
  provider: PaymentProviderId;
  status: PaymentStatus;
  isSimulated: boolean;
  instructions: string;
}

export interface PaymentStatusResponse {
  reference: string;
  externalRef: string;
  status: PaymentStatus;
  isSimulated: boolean;
  failureReason?: string;
}

export interface PaymentWebhookPayload {
  reference: string;
  externalRef: string;
  status: 'CONFIRMED' | 'FAILED';
  failureReason?: string;
  timestamp: string;
}

export interface PaymentProvider {
  readonly providerId: PaymentProviderId;
  readonly displayName: string;
  readonly mode: 'SIMULATION' | 'SANDBOX_DISABLED';
  readonly supportsCancellation: boolean;

  initializePayment(request: PaymentInitRequest): PaymentInitResponse;
  verifyStatus(reference: string, currentExternalRef: string): PaymentStatusResponse;
  confirmSimulated(reference: string, currentExternalRef: string, shouldFail?: boolean): PaymentStatusResponse;
  cancelPayment(reference: string, currentExternalRef: string): PaymentStatusResponse;
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean;
}

const WEBHOOK_SECRET = process.env.WEBHOOK_HMAC_SECRET || 'vmicro_webhook_dev_hmac_secret';

export function signWebhookPayload(rawBody: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

abstract class BaseSimulatedMobileMoneyProvider implements PaymentProvider {
  abstract readonly providerId: PaymentProviderId;
  abstract readonly displayName: string;
  readonly mode: 'SIMULATION' | 'SANDBOX_DISABLED' = 'SIMULATION';
  readonly supportsCancellation: boolean = true;

  initializePayment(request: PaymentInitRequest): PaymentInitResponse {
    if (request.amount <= 0) {
      throw new Error('Le montant du paiement doit être strictement positif.');
    }
    const prefix = this.providerId.split('_')[0];
    const externalRef = `${prefix}-SIM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    return {
      reference: request.reference,
      externalRef,
      provider: this.providerId,
      status: 'PENDING_CONFIRMATION',
      isSimulated: true,
      instructions: `[MODE SIMULATION] Confirmez la demande ${this.displayName} (${request.amount.toFixed(2)} ${request.currency}) pour le numéro ${request.phoneNumber || 'RDC'}. Aucune transaction financière réelle n’est effectuée.`,
    };
  }

  verifyStatus(reference: string, currentExternalRef: string): PaymentStatusResponse {
    return {
      reference,
      externalRef: currentExternalRef,
      status: 'PENDING_CONFIRMATION',
      isSimulated: true,
    };
  }

  confirmSimulated(reference: string, currentExternalRef: string, shouldFail = false): PaymentStatusResponse {
    if (shouldFail) {
      return {
        reference,
        externalRef: currentExternalRef,
        status: 'FAILED',
        isSimulated: true,
        failureReason: `[SIMULATION] Solde Mobile Money insuffisant ou délai d’approbation USSD expiré (${this.displayName}).`,
      };
    }
    return {
      reference,
      externalRef: currentExternalRef,
      status: 'CONFIRMED',
      isSimulated: true,
    };
  }

  cancelPayment(reference: string, currentExternalRef: string): PaymentStatusResponse {
    return {
      reference,
      externalRef: currentExternalRef,
      status: 'CANCELLED',
      isSimulated: true,
    };
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const expected = signWebhookPayload(rawBody);
    const sigBuf = Buffer.from(signatureHeader);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  }
}

export class AirtelMoneyProvider extends BaseSimulatedMobileMoneyProvider {
  readonly providerId: PaymentProviderId = 'AIRTEL_MONEY';
  readonly displayName = 'Airtel Money RDC';
}

export class OrangeMoneyProvider extends BaseSimulatedMobileMoneyProvider {
  readonly providerId: PaymentProviderId = 'ORANGE_MONEY';
  readonly displayName = 'Orange Money RDC';
}

export class VodacomMPesaProvider extends BaseSimulatedMobileMoneyProvider {
  readonly providerId: PaymentProviderId = 'VODACOM_MPESA';
  readonly displayName = 'Vodacom M-Pesa RDC';
}

export class FlexPayAggregatorProvider extends BaseSimulatedMobileMoneyProvider {
  readonly providerId: PaymentProviderId = 'FLEXPAY_AGGREGATOR';
  readonly displayName = 'Agrégateur Multi-Opérateurs (Simulation)';
}

export class InternationalCardProvider extends BaseSimulatedMobileMoneyProvider {
  readonly providerId: PaymentProviderId = 'CARD_INTL';
  readonly displayName = 'Cartes Bancaires Internationales';
  override readonly mode = 'SANDBOX_DISABLED' as const;
  override readonly supportsCancellation = false;

  override initializePayment(): PaymentInitResponse {
    throw new Error('Les paiements par carte bancaire internationale sont désactivés tant que les contrats acquéreur ne sont pas validés.');
  }
}

const PROVIDERS: Record<PaymentProviderId, PaymentProvider> = {
  AIRTEL_MONEY: new AirtelMoneyProvider(),
  ORANGE_MONEY: new OrangeMoneyProvider(),
  VODACOM_MPESA: new VodacomMPesaProvider(),
  FLEXPAY_AGGREGATOR: new FlexPayAggregatorProvider(),
  CARD_INTL: new InternationalCardProvider(),
};

export function getPaymentProvider(providerId: PaymentProviderId): PaymentProvider {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Fournisseur de paiement inconnu : ${providerId}`);
  }
  return provider;
}

export function listPaymentProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    providerId: p.providerId,
    displayName: p.displayName,
    mode: p.mode,
    supportsCancellation: p.supportsCancellation,
  }));
}
