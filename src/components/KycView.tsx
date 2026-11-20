import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  FileText,
  Fingerprint,
  Mic,
  ScanFace,
  Shield,
  Square,
} from 'lucide-react';
import { apiRequest } from '../api/client';

interface KycViewProps {
  onStatusChanged: () => void;
}

const VOICE_CHALLENGE_PHRASE = 'Je confirme mon identité sur V-Micro Crédit';

export function KycView({ onStatusChanged }: KycViewProps) {
  const [statusData, setStatusData] = useState<{
    verification: {
      status: string;
      method: string;
      provider: string;
      provider_reference: string;
      liveness_passed: number;
      document_matched: number;
      device_biometric_verified: number;
      failure_reason?: string;
    } | null;
    biometricConsent: { granted: number; granted_at: string } | null;
  } | null>(null);

  const [consentGranted, setConsentGranted] = useState(false);
  const [livenessChecked, setLivenessChecked] = useState(true);
  const [docChecked, setDocChecked] = useState(true);
  const [deviceBioSupported, setDeviceBioSupported] = useState<boolean>(false);
  const [deviceBioVerified, setDeviceBioVerified] = useState(false);
  const [showAlternative, setShowAlternative] = useState(false);
  const [altForm, setAltForm] = useState({
    documentType: 'CARTE_ELECTEUR_RDC' as 'CARTE_ELECTEUR_RDC' | 'PASSEPORT' | 'PERMIS_CONDUIRE',
    documentLast4: '',
    reason: 'Appareil sans capteur biométrique compatible',
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Multimodal Gemini Camera & Document Test State
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [selfieDataUrl, setSelfieDataUrl] = useState<string | null>(null);
  const [docDataUrl, setDocDataUrl] = useState<string | null>(null);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiFaceResult, setGeminiFaceResult] = useState<{
    verificationRef: string;
    livenessLikely: boolean;
    faceClear: boolean;
    documentReadable: boolean;
    documentTypeDetected: string;
    passed: boolean;
    observations: string;
    disclaimer: string;
  } | null>(null);

  // Multimodal Gemini Voice Challenge State
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [voiceResult, setVoiceResult] = useState<{
    verificationRef: string;
    transcript: string;
    similarityScore: number;
    passed: boolean;
  } | null>(null);

  async function loadKyc() {
    try {
      const res = await apiRequest<typeof statusData>('/kyc/status');
      setStatusData(res);
      setConsentGranted(res?.biometricConsent?.granted === 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur chargement KYC');
    }
  }

  useEffect(() => {
    loadKyc();
    setDeviceBioSupported(typeof window !== 'undefined' && 'PublicKeyCredential' in window);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function handleToggleConsent(granted: boolean) {
    setError(null);
    setMessage(null);
    try {
      await apiRequest('/kyc/consent', {
        method: 'POST',
        body: JSON.stringify({ granted }),
      });
      setConsentGranted(granted);
      setMessage(granted ? 'Consentement biométrique enregistré.' : 'Consentement biométrique révoqué.');
      await loadKyc();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur consentement');
    }
  }

  async function handleCheckDeviceBiometric() {
    setError(null);
    if (!deviceBioSupported || !window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) {
      setError('Authentificateur biométrique matériel non détecté sur ce navigateur. Utilisez le parcours alternatif.');
      return;
    }
    const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      setError('Capteur biométrique matériel indisponible sur cet appareil. Utilisez le parcours alternatif ci-dessous.');
      return;
    }
    setDeviceBioVerified(true);
    setMessage('Capacité biométrique matérielle de l’appareil vérifiée (aucune image d’empreinte collectée).');
  }

  async function handleRunVerification(simulateFailure = false) {
    setError(null);
    setMessage(null);
    try {
      const res = await apiRequest<{
        status: string;
        verificationRef: string;
        disclaimer: string;
        failureReason?: string;
      }>('/kyc/verify-biometric', {
        method: 'POST',
        body: JSON.stringify({
          livenessCompleted: livenessChecked,
          documentProvided: docChecked,
          deviceBiometricUsed: deviceBioVerified,
          simulateFailure,
        }),
      });
      if (res.status === 'FAILED') {
        setError(res.failureReason || 'Échec de vérification.');
      } else {
        setMessage(`${res.status} — Réf: ${res.verificationRef}. ${res.disclaimer}`);
      }
      await loadKyc();
      onStatusChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur vérification');
    }
  }

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 50);
    } catch {
      setError('Caméra inaccessible dans ce navigateur. Vous pouvez téléverser une photo ci-dessous.');
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }

  function captureSelfieFrame() {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      setSelfieDataUrl(canvas.toDataURL('image/jpeg', 0.82));
      stopCamera();
    }
  }

  function handleFileRead(file: File, setter: (val: string) => void) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setter(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function splitDataUrl(dataUrl: string) {
    const [header, data] = dataUrl.split(',');
    const mimeMatch = header.match(/data:(.*?);base64/);
    return { mimeType: mimeMatch?.[1] || 'image/jpeg', base64: data };
  }

  async function handleRunGeminiFaceDoc() {
    if (!selfieDataUrl) {
      setError('Capturez ou sélectionnez d’abord un selfie.');
      return;
    }
    setError(null);
    setMessage(null);
    setGeminiLoading(true);
    setGeminiFaceResult(null);
    try {
      const selfie = splitDataUrl(selfieDataUrl);
      const doc = docDataUrl ? splitDataUrl(docDataUrl) : null;
      const res = await apiRequest<NonNullable<typeof geminiFaceResult> & { status: string }>(
        '/kyc/gemini-verify-face-doc',
        {
          method: 'POST',
          body: JSON.stringify({
            selfieBase64: selfie.base64,
            selfieMimeType: selfie.mimeType,
            documentBase64: doc?.base64,
            documentMimeType: doc?.mimeType,
          }),
        }
      );
      setGeminiFaceResult(res);
      setMessage(`Analyse Gemini complétée (${res.verificationRef}) — Statut : ${res.status}`);
      await loadKyc();
      onStatusChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur analyse multimodale Gemini');
    } finally {
      setGeminiLoading(false);
    }
  }

  async function startVoiceRecording() {
    setError(null);
    setVoiceResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const dataUrl = String(reader.result || '');
          const base64 = dataUrl.split(',')[1];
          if (!base64) return;
          setGeminiLoading(true);
          try {
            const res = await apiRequest<NonNullable<typeof voiceResult> & { status: string }>(
              '/kyc/gemini-verify-voice',
              {
                method: 'POST',
                body: JSON.stringify({
                  audioBase64: base64,
                  audioMimeType: blob.type || 'audio/webm',
                  expectedPhrase: VOICE_CHALLENGE_PHRASE,
                }),
              }
            );
            setVoiceResult(res);
            setMessage(`Vérification vocale Gemini (${res.verificationRef}) : ${res.status}`);
            await loadKyc();
            onStatusChanged();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Erreur vérification vocale Gemini');
          } finally {
            setGeminiLoading(false);
          }
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingVoice(true);
    } catch {
      setError('Microphone inaccessible dans ce navigateur.');
    }
  }

  function stopVoiceRecording() {
    if (mediaRecorderRef.current && recordingVoice) {
      mediaRecorderRef.current.stop();
      setRecordingVoice(false);
    }
  }

  async function handleSubmitAlternative(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const res = await apiRequest<{ message: string; providerReference: string }>('/kyc/alternative', {
        method: 'POST',
        body: JSON.stringify(altForm),
      });
      setMessage(`${res.message} (${res.providerReference})`);
      setShowAlternative(false);
      await loadKyc();
      onStatusChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur soumission alternative');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-[#111111]">
          Vérification d’identité, Biométrie & Tests Multimodaux Gemini
        </h2>
        <p className="text-sm text-[#52525B] mt-1">
          Traitement éphémère des captures · Aucune donnée biométrique brute stockée · Aucune photo d’empreinte demandée
        </p>
      </div>

      {error && <div className="p-3.5 rounded-lg border border-[#4F0000] bg-[#4F0000]/10 text-xs text-[#4F0000]">{error}</div>}
      {message && <div className="p-3.5 rounded-lg border border-[#87CEEB] bg-[#87CEEB]/20 text-xs text-[#111111]">{message}</div>}

      {/* Statut actuel */}
      <div className="p-5 border border-[#E5E7EB] rounded-xl bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          {statusData?.verification?.status === 'VERIFIED' ? (
            <CheckCircle2 className="w-6 h-6 text-[#4F0000] shrink-0" />
          ) : (
            <AlertCircle className="w-6 h-6 text-[#52525B] shrink-0" />
          )}
          <div>
            <p className="text-sm font-semibold text-[#111111]">
              Statut actuel : {statusData?.verification?.status ?? 'NON DÉMARRÉE'}
            </p>
            {statusData?.verification && (
              <p className="text-xs text-[#52525B] mt-1">
                Méthode : {statusData.verification.method} · Prestataire : {statusData.verification.provider} · Réf :{' '}
                <span className="font-mono-tabular">{statusData.verification.provider_reference}</span>
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowAlternative(!showAlternative)}
          className="min-h-[40px] px-4 border border-[#E5E7EB] hover:border-[#4F0000] text-xs font-medium rounded-lg cursor-pointer whitespace-nowrap"
        >
          Parcours alternatif (sans biométrie)
        </button>
      </div>

      {/* Consentement + Halisi Mock + Capteur Appareil */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#4F0000]" />
            <h3 className="font-display text-base font-semibold">1. Consentement biométrique explicite</h3>
          </div>
          <p className="text-xs text-[#52525B] leading-relaxed">
            La vérification faciale (liveness), documentaire et vocale nécessite votre accord explicite. Les captures envoyées à Gemini pour test sont analysées en mémoire puis détruites. Vous pouvez retirer votre consentement à tout moment.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleToggleConsent(true)}
              className={`min-h-[40px] px-4 text-xs font-medium rounded-lg cursor-pointer ${
                consentGranted ? 'bg-[#4F0000] text-white' : 'border border-[#E5E7EB] text-[#111111]'
              }`}
            >
              Accorder mon consentement
            </button>
            {consentGranted && (
              <button
                type="button"
                onClick={() => handleToggleConsent(false)}
                className="min-h-[40px] px-4 text-xs border border-[#4F0000] text-[#4F0000] rounded-lg cursor-pointer"
              >
                Retirer le consentement
              </button>
            )}
          </div>
        </div>

        <div className="border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4">
          <div className="flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-[#4F0000]" />
            <h3 className="font-display text-base font-semibold">2. Halisi Mock & Biométrie Appareil</h3>
          </div>
          <div className="space-y-2 text-xs">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={livenessChecked}
                onChange={(e) => setLivenessChecked(e.target.checked)}
                className="accent-[#4F0000]"
              />
              <span>Contrôle de présence réelle (Liveness Halisi Mock)</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={docChecked}
                onChange={(e) => setDocChecked(e.target.checked)}
                className="accent-[#4F0000]"
              />
              <span>Correspondance pièce d’identité RDC</span>
            </label>
          </div>
          <div className="p-3 border border-[#E5E7EB] rounded-lg bg-[#F8F8F9] flex items-center justify-between gap-3">
            <span className="text-xs text-[#52525B]">
              Capteur appareil WebAuthn / Android BiometricPrompt ({deviceBioSupported ? 'API disponible' : 'Non détecté'})
            </span>
            <button
              type="button"
              onClick={handleCheckDeviceBiometric}
              className="px-3 py-1.5 text-xs bg-white border border-[#E5E7EB] rounded cursor-pointer whitespace-nowrap"
            >
              {deviceBioVerified ? 'Vérifié' : 'Tester capteur'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!consentGranted}
              onClick={() => handleRunVerification(false)}
              className="min-h-[40px] px-4 bg-[#4F0000] text-white text-xs font-medium rounded-lg disabled:opacity-40 cursor-pointer"
            >
              Vérifier via Halisi Mock
            </button>
            <button
              type="button"
              disabled={!consentGranted}
              onClick={() => handleRunVerification(true)}
              className="min-h-[40px] px-4 border border-[#E5E7EB] text-xs font-medium rounded-lg disabled:opacity-40 cursor-pointer"
            >
              Simuler un échec
            </button>
          </div>
        </div>
      </div>

      {/* Section Tests Multimodaux Gemini (Visage/Document + Voix) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Test Facial & Document Gemini */}
        <div className="border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4">
          <div className="flex items-center gap-2">
            <ScanFace className="w-5 h-5 text-[#4F0000]" />
            <h3 className="font-display text-base font-semibold">3. Test Facial Liveness & Document (Gemini)</h3>
          </div>
          <p className="text-xs text-[#52525B]">
            Capturez un selfie via webcam ou fichier, et joignez optionnellement une pièce d’identité pour évaluation multimodale Gemini.
          </p>

          {cameraActive && (
            <div className="space-y-2">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-52 object-cover rounded-lg border border-[#E5E7EB] bg-[#F8F8F9]" />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={captureSelfieFrame}
                  className="min-h-[40px] px-4 bg-[#4F0000] text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  Capturer le selfie
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="min-h-[40px] px-3 border border-[#E5E7EB] text-xs rounded-lg cursor-pointer"
                >
                  Fermer caméra
                </button>
              </div>
            </div>
          )}

          {!cameraActive && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!consentGranted}
                onClick={startCamera}
                className="min-h-[40px] px-3.5 border border-[#4F0000] text-[#4F0000] text-xs font-medium rounded-lg inline-flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                Ouvrir la caméra
              </button>
              <label className="min-h-[40px] px-3.5 border border-[#E5E7EB] text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer">
                <span>Importer selfie</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFileRead(e.target.files[0], setSelfieDataUrl)}
                />
              </label>
              <label className="min-h-[40px] px-3.5 border border-[#E5E7EB] text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer">
                <FileText className="w-4 h-4" />
                <span>{docDataUrl ? 'Document prêt' : 'Joindre pièce ID'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFileRead(e.target.files[0], setDocDataUrl)}
                />
              </label>
            </div>
          )}

          {selfieDataUrl && (
            <div className="flex items-center gap-3">
              <img src={selfieDataUrl} alt="Aperçu selfie temporaire" className="w-16 h-16 rounded-lg object-cover border border-[#E5E7EB]" />
              {docDataUrl && (
                <img src={docDataUrl} alt="Aperçu document temporaire" className="w-24 h-16 rounded-lg object-cover border border-[#E5E7EB]" />
              )}
              <button
                type="button"
                disabled={!consentGranted || geminiLoading}
                onClick={handleRunGeminiFaceDoc}
                className="min-h-[42px] px-4 bg-[#4F0000] text-white text-xs font-medium rounded-lg disabled:opacity-40 cursor-pointer ml-auto"
              >
                {geminiLoading ? 'Analyse Gemini...' : 'Analyser via Gemini'}
              </button>
            </div>
          )}

          {geminiFaceResult && (
            <div className="p-3.5 border border-[#87CEEB] bg-[#87CEEB]/15 rounded-lg text-xs space-y-1">
              <p className="font-semibold">
                Résultat : {geminiFaceResult.passed ? 'VALIDÉ' : 'NON CONCLUANT'} · Réf : {geminiFaceResult.verificationRef}
              </p>
              <p>
                Liveness : {geminiFaceResult.livenessLikely ? 'Oui' : 'Non'} · Visage net :{' '}
                {geminiFaceResult.faceClear ? 'Oui' : 'Non'} · Document ({geminiFaceResult.documentTypeDetected}) :{' '}
                {geminiFaceResult.documentReadable ? 'Lisible' : 'Non fourni / Illisible'}
              </p>
              <p className="text-[#52525B]">{geminiFaceResult.observations}</p>
            </div>
          )}
        </div>

        {/* Test Vérification Vocale Gemini */}
        <div className="border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4">
          <div className="flex items-center gap-2">
            <Mic className="w-5 h-5 text-[#4F0000]" />
            <h3 className="font-display text-base font-semibold">4. Test Vérification Vocale (Gemini Audio)</h3>
          </div>
          <p className="text-xs text-[#52525B]">
            Lisez à voix haute la phrase de contrôle ci-dessous pour tester la transcription et la vérification vocale :
          </p>
          <div className="p-3.5 border border-[#E5E7EB] bg-[#F8F8F9] rounded-lg text-sm font-medium text-[#111111]">
            « {VOICE_CHALLENGE_PHRASE} »
          </div>
          <div className="flex items-center gap-3">
            {!recordingVoice ? (
              <button
                type="button"
                disabled={!consentGranted || geminiLoading}
                onClick={startVoiceRecording}
                className="min-h-[42px] px-4 bg-[#4F0000] text-white text-xs font-medium rounded-lg inline-flex items-center gap-2 disabled:opacity-40 cursor-pointer"
              >
                <Mic className="w-4 h-4" />
                Enregistrer ma voix
              </button>
            ) : (
              <button
                type="button"
                onClick={stopVoiceRecording}
                className="min-h-[42px] px-4 border border-[#4F0000] text-[#4F0000] text-xs font-medium rounded-lg inline-flex items-center gap-2 cursor-pointer"
              >
                <Square className="w-4 h-4" />
                Arrêter et vérifier
              </button>
            )}
          </div>
          {voiceResult && (
            <div className="p-3.5 border border-[#87CEEB] bg-[#87CEEB]/15 rounded-lg text-xs space-y-1">
              <p className="font-semibold">
                {voiceResult.passed ? 'CORRESPONDANCE VALIDÉE' : 'CORRESPONDANCE INSUFFISANTE'} (
                {Math.round(voiceResult.similarityScore * 100)}%)
              </p>
              <p>Transcription Gemini : « {voiceResult.transcript} »</p>
            </div>
          )}
        </div>
      </div>

      {/* Parcours alternatif */}
      {showAlternative && (
        <form onSubmit={handleSubmitAlternative} className="border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4">
          <h3 className="font-display text-base font-semibold">
            Parcours alternatif (Incompatibilité matérielle ou refus biométrique)
          </h3>
          <p className="text-xs text-[#52525B]">
            Votre dossier sera transmis à un agent de vérification habilité sans utiliser la biométrie.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <select
              value={altForm.documentType}
              onChange={(e) => setAltForm({ ...altForm, documentType: e.target.value as typeof altForm.documentType })}
              className="min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg bg-white"
            >
              <option value="CARTE_ELECTEUR_RDC">Carte d’électeur RDC</option>
              <option value="PASSEPORT">Passeport</option>
              <option value="PERMIS_CONDUIRE">Permis de conduire</option>
            </select>
            <input
              type="text"
              required
              minLength={4}
              maxLength={6}
              placeholder="4 derniers chiffres du document"
              value={altForm.documentLast4}
              onChange={(e) => setAltForm({ ...altForm, documentLast4: e.target.value })}
              className="min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg font-mono-tabular"
            />
            <input
              type="text"
              required
              placeholder="Motif"
              value={altForm.reason}
              onChange={(e) => setAltForm({ ...altForm, reason: e.target.value })}
              className="min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
            />
          </div>
          <button type="submit" className="min-h-[42px] px-5 bg-[#4F0000] text-white text-xs font-medium rounded-lg cursor-pointer">
            Soumettre au contrôle manuel
          </button>
        </form>
      )}
    </div>
  );
}
