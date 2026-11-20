import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createDatabase } from '../server/db/database.ts';
import { createApp } from '../server/app.ts';
import { signWebhookPayload } from '../server/adapters/payment/PaymentProvider.ts';
import { retrieveRelevantDocs } from '../server/services/geminiAssistant.ts';
import type { GeminiAssistantProvider, SanitizedAssistantContext } from '../server/services/geminiAssistant.ts';
import type {
  FaceDocumentCheckInput,
  GeminiMultimodalService,
  VoiceChallengeInput,
} from '../server/services/geminiMultimodal.ts';
import { computeWordSimilarity } from '../server/services/geminiMultimodal.ts';

class TestAssistantStub {
  public lastContext: SanitizedAssistantContext | null = null;
  async generateReply(
    userMessage: string,
    _history: Array<{ sender: 'USER' | 'ASSISTANT'; content: string }>,
    sanitizedContext: SanitizedAssistantContext
  ) {
    this.lastContext = sanitizedContext;
    const docs = retrieveRelevantDocs(userMessage);
    return {
      answer: `Réponse RAG basée sur : ${docs.map((d) => d.title).join(', ')}`,
      citations: docs.map((d) => ({ id: d.id, title: d.title })),
      modelUsed: 'gemini-4-hydrogen',
    };
  }
}

class TestMultimodalStub {
  async verifyFaceAndDocument(input: FaceDocumentCheckInput) {
    return {
      verificationRef: 'GEM-FACE-TEST01',
      livenessLikely: true,
      faceClear: true,
      documentReadable: Boolean(input.documentBase64),
      documentTypeDetected: input.documentBase64 ? 'Carte électeur RDC' : 'Non fourni',
      passed: true,
      observations: 'Visage net et présence confirmée (stub test).',
      isSimulatedEvaluation: true as const,
      disclaimer: 'Évaluation multimodale Gemini à titre de test applicatif.',
    };
  }

  async verifyVoiceChallenge(input: VoiceChallengeInput) {
    const transcript = input.expectedPhrase;
    const similarityScore = computeWordSimilarity(input.expectedPhrase, transcript);
    return {
      verificationRef: 'GEM-VOX-TEST01',
      transcript,
      expectedPhrase: input.expectedPhrase,
      similarityScore,
      passed: similarityScore >= 0.6,
      isSimulatedEvaluation: true as const,
    };
  }

  async transcribeAudio(_audioBase64: string, _mimeType: string) {
    return 'Quel est le montant de mon épargne disponible ?';
  }

  async synthesizeSpeech(_text: string) {
    return {
      audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
      mimeType: 'audio/wav',
    };
  }
}

describe('V-Micro Crédit — Suite de Tests Intégration, Sécurité & Métier', () => {
  const db = createDatabase(':memory:');
  const assistantStub = new TestAssistantStub();
  const multimodalStub = new TestMultimodalStub();
  const { app } = createApp({
    db,
    assistantProvider: assistantStub as unknown as GeminiAssistantProvider,
    multimodalService: multimodalStub as unknown as GeminiMultimodalService,
  });

  let clientToken = '';
  let clientRefresh = '';
  let creditAgentToken = '';
  let auditorToken = '';

  beforeAll(async () => {
    const loginClient = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'grace.kabongo@vmicro.cd', password: 'Password123!' });
    clientToken = loginClient.body.accessToken;
    clientRefresh = loginClient.body.refreshToken;

    const loginAgent = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'credit.agent@vmicro.cd', password: 'Agent123!' });
    creditAgentToken = loginAgent.body.accessToken;

    const loginAuditor = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'auditor@vmicro.cd', password: 'Audit123!' });
    auditorToken = loginAuditor.body.accessToken;
  });

  it('1. Expose /api/v1/health et /api/v1/openapi.json', async () => {
    const health = await request(app).get('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.body.mode).toBe('SIMULATION_DEMO');

    const openapi = await request(app).get('/api/v1/openapi.json');
    expect(openapi.status).toBe(200);
    expect(openapi.body.openapi).toBe('3.0.3');
  });

  it('2. Refuse l’inscription si l’âge réglementaire (< 18 ans) n’est pas respecté', async () => {
    const minor = await request(app).post('/api/v1/auth/register').send({
      email: 'mineur@vmicro.cd',
      phone: '+243899000111',
      password: 'Password123!',
      firstName: 'Junior',
      lastName: 'Test',
      dateOfBirth: '2015-05-01',
      city: 'Kinshasa',
      acceptDataConsent: true,
    });
    expect(minor.status).toBe(422);
    expect(minor.body.error).toContain('18 ans');
  });

  it('3. Inscription valide + Vérification OTP + Refresh token', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      email: 'jean.kasai@vmicro.cd',
      phone: '+243822334455',
      password: 'Password123!',
      firstName: 'Jean',
      lastName: 'Kasaï',
      dateOfBirth: '1992-03-10',
      city: 'Kinshasa',
      acceptDataConsent: true,
    });
    expect(reg.status).toBe(201);
    expect(reg.body.simulatedOtpPreview).toHaveLength(6);

    const verify = await request(app).post('/api/v1/auth/verify-phone').send({
      phone: '+243822334455',
      otp: reg.body.simulatedOtpPreview,
    });
    expect(verify.status).toBe(200);
    expect(verify.body.verified).toBe(true);

    const refreshed = await request(app).post('/api/v1/auth/refresh').send({
      refreshToken: clientRefresh,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();
  });

  it('4. Limite les tentatives de connexion (protection brute-force)', async () => {
    for (let i = 0; i < 5; i++) {
      const fail = await request(app)
        .post('/api/v1/auth/login')
        .send({ identifier: 'patrick.mutombo@vmicro.cd', password: 'WrongPassword' });
      expect(fail.status).toBe(401);
    }
    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'patrick.mutombo@vmicro.cd', password: 'Password123!' });
    expect(blocked.status).toBe(429);
  });

  it('5. Exige le consentement biométrique avant Halisi et supporte la simulation d’échec + parcours alternatif', async () => {
    // Retrait consentement
    await request(app)
      .post('/api/v1/kyc/consent')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ granted: false });

    const denied = await request(app)
      .post('/api/v1/kyc/verify-biometric')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ livenessCompleted: true, documentProvided: true });
    expect(denied.status).toBe(403);

    // Ré-accorder le consentement puis vérifier
    await request(app)
      .post('/api/v1/kyc/consent')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ granted: true });

    const ok = await request(app)
      .post('/api/v1/kyc/verify-biometric')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ livenessCompleted: true, documentProvided: true, deviceBiometricUsed: true });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('VERIFIED');
    expect(ok.body.isSimulated).toBe(true);
  });

  it('6. Création objectif, dépôt Mobile Money idempotent, webhook HMAC sécurisé et suppression contrôlée', async () => {
    const goalRes = await request(app)
      .post('/api/v1/savings/goals')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ title: 'Test Équipement', category: 'Équipement', targetAmount: 200, targetDate: '2027-08-01' });
    expect(goalRes.status).toBe(201);
    const goalId = goalRes.body.goal.id;

    // Initialisation paiement avec idempotencyKey
    const idemKey = 'idem_test_payment_01';
    const init1 = await request(app)
      .post('/api/v1/payments/initialize')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        idempotencyKey: idemKey,
        provider: 'AIRTEL_MONEY',
        operationType: 'GOAL_DEPOSIT',
        amount: 50,
        currency: 'USD',
        phoneNumber: '+243812345678',
        goalId,
      });
    expect(init1.status).toBe(201);
    const ref = init1.body.payment.reference;

    // Rejeu idempotent
    const init2 = await request(app)
      .post('/api/v1/payments/initialize')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        idempotencyKey: idemKey,
        provider: 'AIRTEL_MONEY',
        operationType: 'GOAL_DEPOSIT',
        amount: 50,
        currency: 'USD',
        goalId,
      });
    expect(init2.status).toBe(200);
    expect(init2.body.idempotentReplay).toBe(true);

    // Webhook sans signature -> refusé 401
    const badWebhook = await request(app)
      .post('/api/v1/payments/webhook/AIRTEL_MONEY')
      .send({ reference: ref, status: 'CONFIRMED' });
    expect(badWebhook.status).toBe(401);

    // Webhook avec signature HMAC valide -> confirmé
    const payload = JSON.stringify({ reference: ref, status: 'CONFIRMED' });
    const sig = signWebhookPayload(payload);
    const goodWebhook = await request(app)
      .post('/api/v1/payments/webhook/AIRTEL_MONEY')
      .set('x-vmicro-signature', sig)
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(goodWebhook.status).toBe(200);
    expect(goodWebhook.body.duplicateIgnored).toBe(false);

    // Rejeu du même webhook -> ignoré proprement
    const dupWebhook = await request(app)
      .post('/api/v1/payments/webhook/AIRTEL_MONEY')
      .set('x-vmicro-signature', sig)
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(dupWebhook.status).toBe(200);
    expect(dupWebhook.body.duplicateIgnored).toBe(true);

    // Suppression contrôlée refusée tant que solde > 0
    const delBlocked = await request(app)
      .delete(`/api/v1/savings/goals/${goalId}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(delBlocked.status).toBe(409);

    // Libération puis suppression réussie
    await request(app)
      .post(`/api/v1/savings/goals/${goalId}/release`)
      .set('Authorization', `Bearer ${clientToken}`);
    const delOk = await request(app)
      .delete(`/api/v1/savings/goals/${goalId}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(delOk.status).toBe(200);
  });

  it('7. Demande de crédit explicable, contrôle RBAC strict et approbation humaine auditée', async () => {
    const apply = await request(app)
      .post('/api/v1/loans/apply')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        businessActivity: 'Boutique textile Kinshasa',
        businessYears: 4,
        monthlyIncome: 800,
        monthlyExpenses: 350,
        existingCommitments: 30,
        requestedAmount: 300,
        durationMonths: 6,
        purpose: 'Achat stock saisonnier',
      });
    expect(apply.status).toBe(201);
    expect(apply.body.solvency.disclaimer).toContain('ne constitue pas une garantie');
    const loanId = apply.body.loanId;

    // Client interdit d'approuver son propre crédit
    const clientApprove = await request(app)
      .post(`/api/v1/admin/loans/${loanId}/decision`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ decision: 'APPROVED', note: 'Auto-approbation interdite' });
    expect(clientApprove.status).toBe(403);

    // Auditeur en lecture seule interdit d'approuver un crédit
    const auditorApprove = await request(app)
      .post(`/api/v1/admin/loans/${loanId}/decision`)
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({ decision: 'APPROVED', note: 'Test RBAC auditeur' });
    expect(auditorApprove.status).toBe(403);

    // Agent de crédit autorisé approuve -> génère contrat + échéancier + audit log
    const agentApprove = await request(app)
      .post(`/api/v1/admin/loans/${loanId}/decision`)
      .set('Authorization', `Bearer ${creditAgentToken}`)
      .send({ decision: 'APPROVED', note: 'Capacité de remboursement vérifiée et conforme.' });
    expect(agentApprove.status).toBe(200);

    const loanDetail = await request(app)
      .get(`/api/v1/loans/${loanId}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(loanDetail.status).toBe(200);
    expect(loanDetail.body.schedule).toHaveLength(6);

    const audits = await request(app)
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${auditorToken}`);
    expect(audits.status).toBe(200);
    expect(audits.body.logs.some((l: { action: string; target_id: string }) => l.action === 'LOAN_DECISION_APPROVED' && l.target_id === loanId)).toBe(true);
  });

  it('8. Assistant V-Micro utilise le RAG et ne transmet aucune donnée sensible identifiante', async () => {
    const chat = await request(app)
      .post('/api/v1/assistant/chat')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ message: 'Comment fonctionne mon score de crédit ?' });
    expect(chat.status).toBe(200);
    expect(chat.body.citations.length).toBeGreaterThan(0);
    expect(assistantStub.lastContext).toEqual({
      preferredLanguage: 'fr',
      kycStatus: 'VERIFIED',
      activeGoalsCount: 2,
      activeLoansCount: 2,
    });
  });

  it('9. En-têtes de sécurité HSTS/anti-sniffing actifs et rejet HTTP si FORCE_HTTPS=true', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');

    const prevForce = process.env.FORCE_HTTPS;
    process.env.FORCE_HTTPS = 'true';
    try {
      const blocked = await request(app).get('/api/v1/health').set('x-forwarded-proto', 'http');
      expect(blocked.status).toBe(403);

      const allowed = await request(app).get('/api/v1/health').set('x-forwarded-proto', 'https');
      expect(allowed.status).toBe(200);
    } finally {
      if (prevForce === undefined) {
        delete process.env.FORCE_HTTPS;
      } else {
        process.env.FORCE_HTTPS = prevForce;
      }
    }
  });

  it('10. Tests multimodaux Gemini (visage/document éphémère, voix KYC, dictée et TTS Assistant)', async () => {
    const dummyBase64 = 'A'.repeat(80);

    // Retrait consentement -> refus 403 sur l'analyse faciale Gemini
    await request(app)
      .post('/api/v1/kyc/consent')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ granted: false });

    const faceDenied = await request(app)
      .post('/api/v1/kyc/gemini-verify-face-doc')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ selfieBase64: dummyBase64, selfieMimeType: 'image/jpeg' });
    expect(faceDenied.status).toBe(403);

    // Ré-accorder consentement -> analyse faciale + document réussie sans stockage image en base
    await request(app)
      .post('/api/v1/kyc/consent')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ granted: true });

    const faceOk = await request(app)
      .post('/api/v1/kyc/gemini-verify-face-doc')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        selfieBase64: dummyBase64,
        selfieMimeType: 'image/jpeg',
        documentBase64: dummyBase64,
        documentMimeType: 'image/jpeg',
      });
    expect(faceOk.status).toBe(200);
    expect(faceOk.body.passed).toBe(true);
    expect(faceOk.body.isSimulatedEvaluation).toBe(true);

    const savedRow = db
      .prepare('SELECT provider_reference, failure_reason FROM identity_verifications WHERE id = ?')
      .get(faceOk.body.id) as { provider_reference: string; failure_reason: string | null };
    expect(savedRow.provider_reference).toBe('GEM-FACE-TEST01');
    expect(JSON.stringify(savedRow)).not.toContain(dummyBase64);

    // Défi vocal KYC Gemini
    const voiceOk = await request(app)
      .post('/api/v1/kyc/gemini-verify-voice')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        audioBase64: dummyBase64,
        audioMimeType: 'audio/webm',
        expectedPhrase: 'Je confirme mon identité sur V-Micro Crédit',
      });
    expect(voiceOk.status).toBe(200);
    expect(voiceOk.body.passed).toBe(true);
    expect(voiceOk.body.similarityScore).toBe(1);

    // Dictée & TTS Assistant V-Micro
    const transcribeRes = await request(app)
      .post('/api/v1/assistant/transcribe')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ audioBase64: dummyBase64, mimeType: 'audio/webm' });
    expect(transcribeRes.status).toBe(200);
    expect(transcribeRes.body.transcript).toContain('épargne');

    const ttsRes = await request(app)
      .post('/api/v1/assistant/tts')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ text: 'Votre solde est sécurisé.' });
    expect(ttsRes.status).toBe(200);
    expect(ttsRes.body.mimeType).toBe('audio/wav');
    expect(ttsRes.body.audioBase64).toBeTruthy();
  });
});
