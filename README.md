# V-Micro Crédit

**« Épargner. Préparer. Avancer. »**

Plateforme fintech modulaire conçue pour l'inclusion financière en République démocratique du Congo (RDC), combinant épargne personnelle et par objectifs, microcrédit avec évaluation de solvabilité explicable, vérification d'identité biométrique & multimodale Gemini avec consentement, connecteurs Mobile Money (en mode simulation, prêts pour vos providers réels), Assistant V-Micro vocal et texte propulsé par Google Gemini, application Android native (`Expo` + `SecureStore` + `BiometricPrompt` + HTTPS strict) et console d'administration RBAC.

> **Avertissement réglementaire et simulation** : Dans cet environnement de démonstration, toutes les opérations financières (soldes, dépôts, retraits, décaissements, remboursements), les vérifications Halisi et les tests multimodaux Gemini fonctionnent en **MODE SIMULATION / TEST**. Aucun argent réel n'est transféré et aucun prêt réel n'est octroyé.

## Structure du dépôt

- `/server/` — Backend API REST Node.js / Express / TypeScript (port `3000`) avec SQLite relationnel (`better-sqlite3`), JWT + Refresh tokens, RBAC, HSTS/HTTPS strict, webhooks HMAC, adaptateurs simulés Mobile Money & Halisi, et services Gemini (`@google/genai`) texte, vision KYC, transcription vocale et TTS.
- `/src/` — Application Web Client responsive + Console Web Administrateur (React 19, TypeScript, Tailwind CSS, i18n FR/SW/EN).
- `/database/migrations/` — Migration PostgreSQL Flyway `V1__init_schema.sql`.
- `/backend-spring/` — Backend production Java 21 / Spring Boot 3.3 + PostgreSQL + Flyway (`JwtService`, `SecurityConfig` HTTPS/HSTS/BCrypt-12, `SolvencyService`, `PaymentProvider`, `HalisiProviders`, contrôleurs REST, tests JUnit 5).
- `/mobile-expo/` — Application mobile native Android React Native / Expo SDK 52 (`Expo SecureStore`, `BiometricPrompt`, HTTPS strict `usesCleartextTraffic: false`, caméra selfie + enregistrement vocal Gemini).
- `/.github/workflows/` — Pipelines CI (`ci.yml`) et compilation automatique APK Android vers **GitHub Releases** (`android-release.yml`) via Gradle sans compte Expo.
- `/tests/` — Suite de tests automatisés Vitest + Supertest.
- `/docs/` — Documentation d'architecture et d'intégrations (`ARCHITECTURE.md`, `INTEGRATIONS.md`).

## Démarrage rapide (Runtime Live Port 3000)

```bash
npm install
npm run dev
```

L'application est accessible sur `http://localhost:3000` (API REST sous `/api/v1`, spécification OpenAPI sous `/api/v1/openapi.json`).

### Tests automatisés

```bash
npm test
npm run lint
npm run build
```

### Démarrage PostgreSQL + Spring Boot (Docker)

```bash
docker compose up -d --build
```

- API Spring Boot : `http://localhost:8080/api/v1/health`
- PostgreSQL 16 : port `5432` (migrations Flyway exécutées automatiquement au démarrage)
- Adminer : `http://localhost:8081`

## Obtenir l'APK Android directement depuis GitHub Releases (sans compte Expo)

Le workflow `/.github/workflows/android-release.yml` compile automatiquement l'application Android native avec Gradle sur les serveurs GitHub Actions et publie le fichier `.apk` dans **GitHub Releases**.

1. Pousser le projet sur votre dépôt GitHub (`git push origin main`).
2. *(Optionnel, recommandé en production)* Ajouter dans **Settings > Secrets and variables > Actions** :
   - `EXPO_PUBLIC_API_URL` : l'URL **HTTPS** publique de votre backend (sinon l'URL HTTPS de prévisualisation actuelle est utilisée par défaut).
   - Pour un APK signé Release : `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (sinon un APK signé debug installable directement sur téléphone est généré automatiquement).
3. Déclencher la build Android :
   - Soit en créant un tag : `git tag v1.0.0 && git push origin v1.0.0`
   - Soit depuis GitHub : onglet **Actions** → **Build & Publish Android APK (GitHub Releases)** → **Run workflow**.
4. Ouvrir la page **Releases** du dépôt GitHub depuis votre téléphone Android, télécharger `v-micro-credit-v1.0.0.apk` et l'installer.

## Comptes de démonstration pré-remplis

- **Client (Grâce Kabongo, Kinshasa)** : `grace.kabongo@vmicro.cd` / `Password123!`
- **Super Administrateur** : `admin@vmicro.cd` / `Admin123!`
- **Agent de Crédit** : `credit.agent@vmicro.cd` / `Agent123!`
- **Agent de Vérification KYC** : `kyc.agent@vmicro.cd` / `Agent123!`
- **Auditeur** : `auditor@vmicro.cd` / `Audit123!`
