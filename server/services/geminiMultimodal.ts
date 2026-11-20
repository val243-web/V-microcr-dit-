import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';

export interface FaceDocumentCheckInput {
  selfieBase64: string;
  selfieMimeType: string;
  documentBase64?: string;
  documentMimeType?: string;
}

export interface FaceDocumentCheckResult {
  verificationRef: string;
  livenessLikely: boolean;
  faceClear: boolean;
  documentReadable: boolean;
  documentTypeDetected: string;
  passed: boolean;
  observations: string;
  isSimulatedEvaluation: true;
  disclaimer: string;
}

export interface VoiceChallengeInput {
  audioBase64: string;
  audioMimeType: string;
  expectedPhrase: string;
}

export interface VoiceChallengeResult {
  verificationRef: string;
  transcript: string;
  expectedPhrase: string;
  similarityScore: number;
  passed: boolean;
  isSimulatedEvaluation: true;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY non configurée côté serveur. Veuillez configurer votre clé API Gemini dans Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeWordSimilarity(expected: string, actual: string): number {
  const expWords = normalizeText(expected).split(' ').filter(Boolean);
  const actWords = new Set(normalizeText(actual).split(' ').filter(Boolean));
  if (expWords.length === 0) return 0;
  let matched = 0;
  for (const w of expWords) {
    if (actWords.has(w)) matched += 1;
  }
  return Number((matched / expWords.length).toFixed(2));
}

export class GeminiMultimodalService {
  async verifyFaceAndDocument(input: FaceDocumentCheckInput): Promise<FaceDocumentCheckResult> {
    const ai = getGeminiClient();

    const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [
      {
        inlineData: {
          mimeType: input.selfieMimeType || 'image/jpeg',
          data: input.selfieBase64,
        },
      },
    ];

    if (input.documentBase64) {
      parts.push({
        inlineData: {
          mimeType: input.documentMimeType || 'image/jpeg',
          data: input.documentBase64,
        },
      });
    }

    const prompt = input.documentBase64
      ? `Tu es un module d'évaluation expérimentale KYC (test uniquement) pour V-Micro Crédit.
Analyse ces deux images de façon éphémère :
Image 1 : selfie utilisateur pour contrôle de présence (liveness).
Image 2 : pièce d'identité (ex. carte d'électeur RDC, passeport, permis).
Évalue en français :
1. livenessLikely : le visage semble-t-il être une personne réelle devant la caméra (pas un écran flou ou une image vide) ?
2. faceClear : le visage est-il suffisamment éclairé et visible ?
3. documentReadable : la seconde image montre-t-elle un document d'identité lisible ?
4. documentTypeDetected : type de document identifié ou "Aucun".
5. passed : true si livenessLikely && faceClear && documentReadable.
6. observations : résumé concis (1 à 2 phrases) sans répéter de numéro sensible.`
      : `Tu es un module d'évaluation expérimentale KYC (test uniquement) pour V-Micro Crédit.
Analyse cette photo selfie pour contrôle de présence (liveness) :
1. livenessLikely : le visage semble-t-il être une personne réelle devant la caméra ?
2. faceClear : le visage est-il net et bien visible ?
3. documentReadable : false (aucun document fourni).
4. documentTypeDetected : "Non fourni".
5. passed : true si livenessLikely && faceClear.
6. observations : résumé concis en français.`;

    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            livenessLikely: { type: Type.BOOLEAN },
            faceClear: { type: Type.BOOLEAN },
            documentReadable: { type: Type.BOOLEAN },
            documentTypeDetected: { type: Type.STRING },
            passed: { type: Type.BOOLEAN },
            observations: { type: Type.STRING },
          },
          required: [
            'livenessLikely',
            'faceClear',
            'documentReadable',
            'documentTypeDetected',
            'passed',
            'observations',
          ],
        },
      },
    });

    const rawJson = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawJson) as {
      livenessLikely: boolean;
      faceClear: boolean;
      documentReadable: boolean;
      documentTypeDetected: string;
      passed: boolean;
      observations: string;
    };

    return {
      verificationRef: `GEM-FACE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      livenessLikely: Boolean(parsed.livenessLikely),
      faceClear: Boolean(parsed.faceClear),
      documentReadable: Boolean(parsed.documentReadable),
      documentTypeDetected: parsed.documentTypeDetected || 'Non détecté',
      passed: Boolean(parsed.passed),
      observations: parsed.observations || 'Analyse multimodale complétée.',
      isSimulatedEvaluation: true,
      disclaimer:
        'Évaluation multimodale Gemini à titre de test applicatif. Les images ne sont pas conservées en base de données.',
    };
  }

  async verifyVoiceChallenge(input: VoiceChallengeInput): Promise<VoiceChallengeResult> {
    const transcript = await this.transcribeAudio(input.audioBase64, input.audioMimeType);
    const similarityScore = computeWordSimilarity(input.expectedPhrase, transcript);
    return {
      verificationRef: `GEM-VOX-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      transcript,
      expectedPhrase: input.expectedPhrase,
      similarityScore,
      passed: similarityScore >= 0.6,
      isSimulatedEvaluation: true,
    };
  }

  async transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'audio/webm',
              data: audioBase64,
            },
          },
          { text: 'Transcribe this audio accurately in the spoken language (French, Swahili, or English).' },
        ],
      },
    });
    const text = response.text?.trim();
    if (!text) {
      throw new Error('Transcription vide retournée par Gemini.');
    }
    return text;
  }

  async synthesizeSpeech(text: string): Promise<{ audioBase64: string; mimeType: string }> {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: text.slice(0, 1200),
              speechMetadata: {
                style: 'Clear, calm, reassuring financial advisor',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error('Audio TTS non généré par Gemini.');
    }
    return {
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
    };
  }
}
