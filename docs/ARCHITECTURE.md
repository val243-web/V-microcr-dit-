# Architecture Logicielle — V-Micro Crédit

## 1. Vue d'ensemble
V-Micro Crédit adopte une architecture modulaire en couches séparant strictement les contrôleurs HTTP, les services métier, la persistance relationnelle et les adaptateurs externes.

```
[Client Mobile Expo / Web Client]  +  [Console Web Admin RBAC]
                  |
                  v  (REST JSON + JWT Bearer)
       [API REST & Sécurité]
         ├── Auth & Sessions (JWT, Refresh, Rate Limiter)
         ├── KYC & Consentements (Halisi Mock + Biométrie Appareil)
         ├── Épargne & Objectifs (Sans épargne programmée v1)
         ├── Crédit & Solvabilité Explicable (Revue humaine obligatoire)
         ├── Paiements Mobile Money RDC (Simulation + Idempotence + HMAC)
         ├── Assistant V-Micro (Google Gemini + RAG sans PII)
         └── Administration RBAC & Audit Logs
                  |
                  v
     [Base de Données Relationnelle]
   (PostgreSQL + Flyway / SQLite Node Runtime)
```

## 2. Sécurité et Protection des Données
- **Mots de passe** : Hashage BCrypt (coût 10+) ; jamais stockés en clair.
- **Sessions** : JWT d'accès court terme (2h) + Refresh Token tournant hashé en SHA-256 en base (`sessions`) permettant la révocation immédiate par appareil.
- **Limitation anti-brute-force** : Blocage temporaire après 5 tentatives de connexion échouées.
- **RBAC** : Matrice granulaire de permissions pour `CLIENT`, `SUPER_ADMIN`, `ADMIN`, `VERIFICATION_AGENT`, `CREDIT_AGENT`, `CLIENT_SUPPORT`, `AUDITOR`.
- **Biométrie** : Aucun gabarit biométrique brut ni photographie d'empreinte digitale n'est collecté ou stocké. Seules les références de vérification et le consentement révocable sont persistés.
- **Confidentialité IA** : Le module `GeminiAssistantProvider` ne transmet jamais les mots de passe, pièces d'identité, images faciales ou données personnelles identifiantes au modèle cloud.

## 3. Choix d'exécution dans le dépôt
- Le runtime actif sur le port `3000` (Express + TypeScript + React 19 + Vite + SQLite relationnel + `@google/genai`) exécute l'ensemble des parcours client, admin, paiements simulés, Halisi mock et Gemini RAG en temps réel.
- Les modules complémentaires `/backend-spring` (Java Spring Boot + Flyway) et `/mobile-expo` (React Native Expo) reflètent la même architecture modulaire prête pour un déploiement JVM / natif iOS & Android.
