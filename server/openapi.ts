export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'V-Micro Crédit API',
    version: '1.0.0',
    description:
      'API REST modulaire de V-Micro Crédit (Épargner. Préparer. Avancer.) — Authentification JWT, Vérification d’identité Halisi (Mock), Épargne & Objectifs, Microcrédit & Solvabilité explicable, Connecteurs Mobile Money RDC (Simulation), Assistant V-Micro (Gemini) et Administration RBAC.',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  paths: {
    '/health': { get: { summary: 'État de santé de l’API', responses: { '200': { description: 'OK' } } } },
    '/auth/register': { post: { summary: 'Inscription client avec contrôle d’âge réglementaire', responses: { '201': { description: 'Compte créé' } } } },
    '/auth/verify-phone': { post: { summary: 'Vérification OTP du numéro de téléphone', responses: { '200': { description: 'Téléphone vérifié' } } } },
    '/auth/login': { post: { summary: 'Connexion sécurisée avec limitation anti-brute-force', responses: { '200': { description: 'Jetons JWT délivrés' } } } },
    '/auth/refresh': { post: { summary: 'Renouvellement de session via refresh token', responses: { '200': { description: 'Nouveau jeton d’accès' } } } },
    '/auth/sessions': { get: { summary: 'Lister les sessions actives', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Liste des sessions' } } } },
    '/kyc/consent': { post: { summary: 'Enregistrer ou révoquer le consentement biométrique', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Consentement mis à jour' } } } },
    '/kyc/verify-biometric': { post: { summary: 'Vérification d’identité via adaptateur Halisi et biométrie appareil', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Résultat de vérification' } } } },
    '/kyc/alternative': { post: { summary: 'Parcours alternatif manuel si appareil incompatible', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Dossier soumis à révision humaine' } } } },
    '/dashboard': { get: { summary: 'Tableau de bord client complet', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Données du tableau de bord' } } } },
    '/savings/goals': {
      get: { summary: 'Lister les objectifs d’épargne', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Liste des objectifs' } } },
      post: { summary: 'Créer un objectif d’épargne', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Objectif créé' } } },
    },
    '/payments/initialize': { post: { summary: 'Initialiser un paiement Mobile Money (Mode Simulation)', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Référence créée' } } } },
    '/payments/confirm': { post: { summary: 'Confirmer ou simuler un échec de paiement', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Statut mis à jour' } } } },
    '/payments/webhook/{provider}': { post: { summary: 'Webhook opérateur protégé par signature HMAC et idempotence', responses: { '200': { description: 'Webhook traité' } } } },
    '/loans/estimate': { post: { summary: 'Simuler une mensualité et un échéancier', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Estimation calculée' } } } },
    '/loans/apply': { post: { summary: 'Soumettre une demande de microcrédit avec évaluation de solvabilité', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Demande enregistrée' } } } },
    '/loans/{id}/repay': { post: { summary: 'Effectuer un remboursement sur échéance', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Remboursement confirmé' } } } },
    '/assistant/chat': { post: { summary: 'Discuter avec l’Assistant V-Micro propulsé par Gemini', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Réponse générée' } } } },
    '/admin/overview': { get: { summary: 'KPIs globaux administrateur', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Statistiques globales' } } } },
    '/admin/loans/{id}/decision': { post: { summary: 'Décision humaine autorisée sur demande de crédit', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Décision enregistrée et auditée' } } } },
    '/admin/audit-logs': { get: { summary: 'Consultation des journaux d’audit immuables', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Journaux d’audit' } } } },
  },
};
