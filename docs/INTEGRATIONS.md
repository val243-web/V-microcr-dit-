# Documentation des Intégrations Externes — V-Micro Crédit

## 1. Connecteurs Mobile Money RDC (Interface `PaymentProvider`)
Chaque opérateur implémente le contrat commun `PaymentProvider` (`initializePayment`, `verifyStatus`, `cancelPayment`, `verifyWebhookSignature`) aussi bien côté Node (`/server/adapters/payment/PaymentProvider.ts`) que côté Java Spring Boot (`/backend-spring/src/main/java/cd/vmicro/credit/payment/`).

| Identifiant | Opérateur | État actuel | Remplacement en production |
| --- | --- | --- | --- |
| `AIRTEL_MONEY` | Airtel Money RDC | `SIMULATION` | Renseigner client ID/secret, URL officielle Airtel Africa Open API et certificat webhook. |
| `ORANGE_MONEY` | Orange Money RDC | `SIMULATION` | Renseigner credentials OAuth2 Orange Developer RDC et URL de notification. |
| `VODACOM_MPESA` | Vodacom M-Pesa RDC | `SIMULATION` | Configurer API Key / Public Key officielle Vodacom M-Pesa RDC. |
| `FLEXPAY_AGGREGATOR` | Agrégateur RDC | `SIMULATION` | Configurer Merchant Code et Bearer Token de l'agrégateur agréé. |
| `CARD_INTL` | Cartes Bancaires | `DISABLED_SANDBOX` | Désactivé par défaut jusqu'à signature des contrats acquéreur et conformité PCI-DSS. |

**Protection des Webhooks** : Tous les webhooks vérifient l'en-tête HMAC-SHA256 (`x-vmicro-signature`) et garantissent l'idempotence via `payment_references.idempotency_key` et le statut terminal `CONFIRMED`.

## 2. Interfaces Halisi
Trois contrats abstraits sont prêts sans aucun endpoint inventé :
- `HalisiEnrollmentProvider`
- `HalisiIdentityVerificationProvider`
- `HalisiCreditAssessmentProvider`

Les implémentations actuelles (`MockHalisi...`) simulent les réponses en développement. Dès réception de la documentation API officielle Halisi, il suffit d'ajouter les adaptateurs HTTP concrets implémentant ces interfaces sans modifier les services métier.

## 3. Gemini Multimodal & Assistant V-Micro (Côté serveur uniquement)
- **Assistant texte + RAG** : `GeminiAssistantProvider` (`gemini-4-hydrogen`) avec contexte strictement anonymisé (aucun mot de passe, PII ou biométrie transmis).
- **Test Reconnaissance faciale + Liveness + Pièce d'identité** : `POST /api/v1/kyc/gemini-verify-face-doc` (`gemini-4-hydrogen`, sortie JSON structurée, traitement éphémère — aucune image base64 stockée en base).
- **Test Défi vocal & Dictée** : `POST /api/v1/kyc/gemini-verify-voice` et `POST /api/v1/assistant/transcribe` (`gemini-3.5-transcribe`).
- **Synthèse vocale (TTS WAV)** : `POST /api/v1/assistant/tts` (`gemini-3.8-flash-lite-tts`).
- Clé API stockée uniquement côté serveur (`process.env.GEMINI_API_KEY`).

## 4. Durcissement HTTPS & Android
- Backend Express & Spring Security : HSTS (`max-age=31536000; includeSubDomains`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, rejet HTTP optionnel (`FORCE_HTTPS=true` / `VMICRO_REQUIRE_HTTPS=true`).
- Application Android (`/mobile-expo/`) : `usesCleartextTraffic: false`, `network_security_config.xml` (`cleartextTrafficPermitted="false"`), stockage JWT dans **Expo SecureStore** et déverrouillage **BiometricPrompt** Android (`expo-local-authentication`).
