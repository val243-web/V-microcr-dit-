import { GoogleGenAI, ThinkingLevel } from '@google/genai';

interface RagDocument {
  id: string;
  title: string;
  keywords: string[];
  content: string;
}

const V_MICRO_KNOWLEDGE_BASE: RagDocument[] = [
  {
    id: 'doc_savings',
    title: 'Épargne libre et objectifs d’épargne',
    keywords: ['épargne', 'epargne', 'objectif', 'objectifs', 'dépôt', 'retrait', 'akiba', 'savings'],
    content:
      'V-Micro Crédit propose l’épargne libre (disponible à tout moment) et l’épargne par objectifs (commerce, éducation, équipement, urgence). Les dépôts et retraits en environnement de démonstration utilisent le mode simulation Mobile Money (Airtel Money, Orange Money, Vodacom M-Pesa). L’épargne programmée automatique n’est pas activée dans la version 1.',
  },
  {
    id: 'doc_credit',
    title: 'Fonctionnement des demandes de microcrédit et solvabilité',
    keywords: ['crédit', 'credit', 'prêt', 'pret', 'solvabilité', 'score', 'échéancier', 'echeancier', 'remboursement', 'mkopo', 'loan'],
    content:
      'Une demande de microcrédit suit un parcours structuré : activité professionnelle, revenus mensuels, dépenses, charges existantes, montant, durée et estimation de mensualité. Le système calcule un score de solvabilité explicable (ratio d’endettement, revenu disponible net, épargne préalable, vérification d’identité). Ce score est purement indicatif et ne garantit jamais l’octroi : la décision finale appartient à un agent de crédit autorisé.',
  },
  {
    id: 'doc_kyc',
    title: 'Vérification d’identité et consentement biométrique',
    keywords: ['identité', 'identite', 'kyc', 'biométrie', 'biometrie', 'visage', 'empreinte', 'halisi', 'utambulisho', 'verification'],
    content:
      'La vérification d’identité nécessite votre consentement explicite (révocable à tout moment). Elle s’appuie sur des connecteurs spécialisés (Halisi en développement via adaptateur simulé) pour le contrôle de présence (liveness) et sur la biométrie sécurisée du téléphone. L’application ne demande jamais de photo d’empreinte digitale. Un parcours alternatif manuel examiné par un agent est disponible si votre appareil est incompatible.',
  },
  {
    id: 'doc_payments',
    title: 'Paiements Mobile Money RDC et mode simulation',
    keywords: ['airtel', 'orange', 'mpesa', 'm-pesa', 'vodacom', 'paiement', 'mobile money', 'simulation', 'frais', 'malipo'],
    content:
      'V-Micro Crédit prépare des connecteurs indépendants pour Airtel Money, Orange Money, Vodacom M-Pesa et les agrégateurs locaux. Dans le prototype actuel, toutes les transactions sont clairement étiquetées MODE SIMULATION et n’impliquent aucun mouvement d’argent réel. Chaque transaction possède une référence unique et une vérification d’idempotence.',
  },
  {
    id: 'doc_security_support',
    title: 'Sécurité, confidentialité et support humain',
    keywords: ['sécurité', 'securite', 'mot de passe', 'support', 'humain', 'aide', 'suppression', 'données', 'confidentialité', 'msaada'],
    content:
      'Vos mots de passe sont chiffrés et vos sessions peuvent être révoquées à tout moment depuis Profil > Sécurité. L’Assistant V-Micro ne reçoit jamais vos mots de passe, données biométriques brutes ou pièces d’identité. Pour une réclamation ou un examen de dossier, vous pouvez contacter le support humain V-Micro Crédit (support@vmicro.cd) ou utiliser le centre d’aide.',
  },
];

export function retrieveRelevantDocs(query: string): RagDocument[] {
  const normalized = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const scored = V_MICRO_KNOWLEDGE_BASE.map((doc) => {
    let hits = 0;
    for (const kw of doc.keywords) {
      const normKw = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (normalized.includes(normKw)) hits += 1;
    }
    return { doc, hits };
  })
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (scored.length === 0) {
    return V_MICRO_KNOWLEDGE_BASE.slice(0, 2);
  }
  return scored.slice(0, 3).map((s) => s.doc);
}

export interface SanitizedAssistantContext {
  preferredLanguage: 'fr' | 'sw' | 'en';
  kycStatus: string;
  activeGoalsCount: number;
  activeLoansCount: number;
}

export interface AssistantReply {
  answer: string;
  citations: Array<{ id: string; title: string }>;
  modelUsed: string;
}

export class GeminiAssistantProvider {
  async generateReply(
    userMessage: string,
    history: Array<{ sender: 'USER' | 'ASSISTANT'; content: string }>,
    sanitizedContext: SanitizedAssistantContext
  ): Promise<AssistantReply> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      throw new Error(
        'GEMINI_API_KEY non configurée côté serveur. Veuillez configurer votre clé API Gemini dans Settings > Secrets.'
      );
    }

    const docs = retrieveRelevantDocs(userMessage);
    const ragContext = docs.map((d) => `[${d.title}]\n${d.content}`).join('\n\n');

    const langInstruction =
      sanitizedContext.preferredLanguage === 'sw'
        ? 'Réponds en kiswahili clair et professionnel.'
        : sanitizedContext.preferredLanguage === 'en'
          ? 'Respond in clear, professional English.'
          : 'Réponds en français clair, bienveillant et pédagogique.';

    const systemInstruction = `Tu es l'Assistant V-Micro pour l'application fintech V-Micro Crédit (« Épargner. Préparer. Avancer. ») destinée principalement à la République démocratique du Congo.
${langInstruction}

RÈGLES STRICTES DE SÉCURITÉ ET DE CONFORMITÉ :
1. Tu ne peux JAMAIS approuver un crédit, modifier un solde, exécuter un paiement ou inventer un solde/historique.
2. Si l'utilisateur demande d'approuver son prêt ou de faire un transfert à sa place, refuse poliment et explique le parcours dans l'application ou oriente vers le support humain (support@vmicro.cd).
3. Rappelle que les paiements et vérifications actuels du prototype fonctionnent en MODE SIMULATION lorsque cela est pertinent.
4. Ne demande jamais de mot de passe, code PIN, photo d'empreinte ou numéro de pièce d'identité dans le chat.
5. Appuie-toi en priorité sur la base documentaire ci-dessous. Sois concis (3 à 6 phrases structurées).

CONTEXTE NON IDENTIFIANT DE L'UTILISATEUR :
- Statut KYC : ${sanitizedContext.kycStatus}
- Nombre d'objectifs d'épargne actifs : ${sanitizedContext.activeGoalsCount}
- Nombre de crédits actifs : ${sanitizedContext.activeLoansCount}

BASE DOCUMENTAIRE V-MICRO CRÉDIT :
${ragContext}`;

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const formattedHistory = history.slice(-6).map((m) => ({
      role: m.sender === 'USER' ? ('user' as const) : ('model' as const),
      parts: [{ text: m.content }],
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        ...formattedHistory,
        {
          role: 'user',
          parts: [{ text: userMessage }],
        },
      ],
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const text = response.text?.trim();
    if (!text) {
      throw new Error('Réponse vide reçue depuis le fournisseur Gemini.');
    }

    return {
      answer: text,
      citations: docs.map((d) => ({ id: d.id, title: d.title })),
      modelUsed: 'gemini-4-hydrogen',
    };
  }
}
