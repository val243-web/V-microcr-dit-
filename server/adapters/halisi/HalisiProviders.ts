import crypto from 'crypto';

// ============================================================================
// INTERFACES ABSTRAITES HALISI (Prêtes pour les API officielles Halisi)
// Aucun endpoint réel n'est inventé. Le remplacement se fait uniquement
// en implémentant ces interfaces avec les clients HTTP Halisi officiels.
// ============================================================================

export interface HalisiEnrollmentRequest {
  userId: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  city: string;
  country: string;
  consentReferenceId: string;
}

export interface HalisiEnrollmentResponse {
  halisiClientRef: string;
  enrolled: boolean;
  isSimulated: boolean;
  timestamp: string;
}

export interface HalisiIdentityCheckRequest {
  userId: string;
  consentGranted: boolean;
  livenessCheckCompleted: boolean;
  documentReferenceProvided: boolean;
  simulateFailure?: boolean;
}

export interface HalisiIdentityCheckResponse {
  verificationRef: string;
  providerName: string;
  status: 'VERIFIED' | 'FAILED' | 'MANUAL_REVIEW_REQUIRED';
  livenessPassed: boolean;
  documentMatched: boolean;
  failureReason?: string;
  isSimulated: boolean;
  disclaimer: string;
}

export interface HalisiCreditAssessmentRequest {
  userId: string;
  requestedAmount: number;
  durationMonths: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  existingCommitments: number;
  savingsTotal: number;
  kycVerified: boolean;
}

export interface HalisiCreditAssessmentResponse {
  assessmentRef: string;
  externalRiskSignal: 'LOW' | 'MODERATE' | 'ELEVATED';
  confidenceNote: string;
  isSimulated: boolean;
}

export interface HalisiEnrollmentProvider {
  enrollClient(request: HalisiEnrollmentRequest): Promise<HalisiEnrollmentResponse>;
}

export interface HalisiIdentityVerificationProvider {
  verifyIdentity(request: HalisiIdentityCheckRequest): Promise<HalisiIdentityCheckResponse>;
}

export interface HalisiCreditAssessmentProvider {
  assessCreditProfile(request: HalisiCreditAssessmentRequest): Promise<HalisiCreditAssessmentResponse>;
}

// ============================================================================
// IMPLÉMENTATIONS MOCK POUR DÉVELOPPEMENT ET TESTS
// ============================================================================

export class MockHalisiEnrollmentProvider implements HalisiEnrollmentProvider {
  async enrollClient(request: HalisiEnrollmentRequest): Promise<HalisiEnrollmentResponse> {
    if (!request.consentReferenceId) {
      throw new Error('HalisiEnrollmentError: Le consentement explicite est obligatoire.');
    }
    return {
      halisiClientRef: `HLS-ENR-SIM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      enrolled: true,
      isSimulated: true,
      timestamp: new Date().toISOString(),
    };
  }
}

export class MockHalisiIdentityVerificationProvider implements HalisiIdentityVerificationProvider {
  async verifyIdentity(request: HalisiIdentityCheckRequest): Promise<HalisiIdentityCheckResponse> {
    if (!request.consentGranted) {
      throw new Error('HalisiIdentityError: Consentement biométrique non accordé.');
    }

    if (request.simulateFailure || !request.livenessCheckCompleted) {
      return {
        verificationRef: `HLS-ID-SIM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        providerName: 'HalisiMockIdentityProvider',
        status: 'FAILED',
        livenessPassed: false,
        documentMatched: request.documentReferenceProvided,
        failureReason: '[SIMULATION] Contrôle de présence réelle (liveness) non concluant. Veuillez réessayer dans un endroit éclairé ou utiliser le parcours alternatif.',
        isSimulated: true,
        disclaimer: 'Vérification simulée pour environnement de développement. Ne constitue pas une validation biométrique réelle.',
      };
    }

    return {
      verificationRef: `HLS-ID-SIM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      providerName: 'HalisiMockIdentityProvider',
      status: request.documentReferenceProvided ? 'VERIFIED' : 'MANUAL_REVIEW_REQUIRED',
      livenessPassed: true,
      documentMatched: request.documentReferenceProvided,
      isSimulated: true,
      disclaimer: 'Vérification simulée via adaptateur Halisi Mock. Aucune donnée biométrique brute n’est stockée.',
    };
  }
}

export class MockHalisiCreditAssessmentProvider implements HalisiCreditAssessmentProvider {
  async assessCreditProfile(request: HalisiCreditAssessmentRequest): Promise<HalisiCreditAssessmentResponse> {
    const disposable = request.monthlyIncome - request.monthlyExpenses - request.existingCommitments;
    const monthlyEst = request.requestedAmount / Math.max(1, request.durationMonths);
    const ratio = disposable > 0 ? monthlyEst / disposable : 1;

    let externalRiskSignal: 'LOW' | 'MODERATE' | 'ELEVATED' = 'MODERATE';
    if (request.kycVerified && ratio <= 0.35 && request.savingsTotal >= request.requestedAmount * 0.15) {
      externalRiskSignal = 'LOW';
    } else if (ratio > 0.6 || disposable <= 0) {
      externalRiskSignal = 'ELEVATED';
    }

    return {
      assessmentRef: `HLS-CRD-SIM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      externalRiskSignal,
      confidenceNote: '[MOCK HALISI] Signal externe indicatif généré par adaptateur de développement.',
      isSimulated: true,
    };
  }
}
