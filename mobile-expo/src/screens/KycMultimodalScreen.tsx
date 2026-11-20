import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import { VMicroTheme } from '../theme/tokens';
import { mobileApiRequest } from '../security/httpsClient';
import { authenticateWithDeviceBiometrics } from '../security/biometricAuth';

const VOICE_PHRASE = 'Je confirme mon identité sur V-Micro Crédit';

export function KycMultimodalScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [consent, setConsent] = useState(false);
  const [kycStatus, setKycStatus] = useState<string>('NOT_STARTED');
  const [cameraMode, setCameraMode] = useState<'NONE' | 'SELFIE' | 'DOCUMENT'>('NONE');
  const [selfieBase64, setSelfieBase64] = useState<string | null>(null);
  const [docBase64, setDocBase64] = useState<string | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [altLast4, setAltLast4] = useState('');
  const [altReason, setAltReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cameraRef = useRef<CameraView | null>(null);

  async function loadStatus() {
    try {
      const res = await mobileApiRequest<{
        verification: { status?: string } | null;
        biometricConsent: { granted?: boolean | number } | null;
      }>('/kyc/status');
      setKycStatus(res.verification?.status || 'NOT_STARTED');
      setConsent(Boolean(res.biometricConsent?.granted));
    } catch {
      // ignore initial fetch warning
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function toggleConsent(granted: boolean) {
    setErrorMsg(null);
    setLoading(true);
    try {
      await mobileApiRequest('/kyc/consent', {
        method: 'POST',
        body: JSON.stringify({ granted }),
      });
      setConsent(granted);
      setResultMsg(granted ? 'Consentement biométrique accordé.' : 'Consentement révoqué.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur consentement');
    } finally {
      setLoading(false);
    }
  }

  async function runHardwareBiometricAndHalisi() {
    setErrorMsg(null);
    setLoading(true);
    try {
      const bio = await authenticateWithDeviceBiometrics('Vérifier empreinte matérielle Android');
      if (!bio.success) {
        setErrorMsg(bio.error || 'Échec biométrique Android.');
        return;
      }
      const res = await mobileApiRequest<{ verificationRef: string; status: string }>('/kyc/verify-biometric', {
        method: 'POST',
        body: JSON.stringify({
          livenessCompleted: true,
          documentProvided: true,
          deviceBiometricUsed: true,
        }),
      });
      setResultMsg(`Biométrie Android + Halisi (${res.verificationRef}) : ${res.status}`);
      await loadStatus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur vérification');
    } finally {
      setLoading(false);
    }
  }

  async function capturePhoto() {
    if (!cameraRef.current) return;
    setErrorMsg(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.55 });
      if (!photo?.base64) {
        setErrorMsg('Capture invalide, veuillez réessayer.');
        return;
      }
      if (cameraMode === 'SELFIE') {
        setSelfieBase64(photo.base64);
        setResultMsg('Selfie capturé (traitement éphémère).');
      } else if (cameraMode === 'DOCUMENT') {
        setDocBase64(photo.base64);
        setResultMsg('Pièce d’identité capturée (traitement éphémère).');
      }
      setCameraMode('NONE');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur caméra');
    }
  }

  async function submitGeminiFaceDoc() {
    if (!selfieBase64) {
      setErrorMsg('Veuillez d’abord capturer un selfie.');
      return;
    }
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await mobileApiRequest<{
        verificationRef: string;
        passed: boolean;
        documentTypeDetected: string;
        observations: string;
      }>('/kyc/gemini-verify-face-doc', {
        method: 'POST',
        body: JSON.stringify({
          selfieBase64,
          selfieMimeType: 'image/jpeg',
          documentBase64: docBase64 || undefined,
          documentMimeType: docBase64 ? 'image/jpeg' : undefined,
        }),
      });
      setResultMsg(
        `Gemini Facial (${res.verificationRef}) : ${res.passed ? 'VALIDÉ' : 'NON CONCLUANT'} · Doc: ${res.documentTypeDetected} — ${res.observations}`
      );
      setSelfieBase64(null);
      setDocBase64(null);
      await loadStatus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur analyse Gemini');
    } finally {
      setLoading(false);
    }
  }

  async function toggleVoiceChallenge() {
    setErrorMsg(null);
    if (!recording) {
      try {
        const perm = await Audio.requestPermissionsAsync();
        if (!perm.granted) {
          setErrorMsg('Permission microphone refusée.');
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        setRecording(rec);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Impossible de démarrer le micro');
      }
    } else {
      setLoading(true);
      try {
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        setRecording(null);
        if (!uri) return;
        const response = await fetch(uri);
        const blob = await response.blob();
        const base64: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || '').split(',')[1] || '');
          reader.onerror = () => reject(new Error('Lecture audio impossible'));
          reader.readAsDataURL(blob);
        });
        const res = await mobileApiRequest<{ verificationRef: string; transcript: string; passed: boolean; similarityScore: number }>(
          '/kyc/gemini-verify-voice',
          {
            method: 'POST',
            body: JSON.stringify({
              audioBase64: base64,
              audioMimeType: 'audio/m4a',
              expectedPhrase: VOICE_PHRASE,
            }),
          }
        );
        setResultMsg(
          `Voix Gemini (${res.verificationRef}) : ${res.passed ? 'VALIDÉ' : 'ÉCHEC'} (${Math.round(res.similarityScore * 100)}%) — « ${res.transcript} »`
        );
        await loadStatus();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Erreur analyse vocale');
      } finally {
        setLoading(false);
      }
    }
  }

  async function submitAlternative() {
    if (altLast4.trim().length < 4 || altReason.trim().length < 5) {
      setErrorMsg('Saisissez les 4 derniers chiffres de la pièce et la raison.');
      return;
    }
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await mobileApiRequest<{ message: string; providerReference: string }>('/kyc/alternative', {
        method: 'POST',
        body: JSON.stringify({
          documentType: 'CARTE_ELECTEUR_RDC',
          documentLast4: altLast4.trim(),
          reason: altReason.trim(),
        }),
      });
      setResultMsg(`${res.message} (${res.providerReference})`);
      setAltLast4('');
      setAltReason('');
      await loadStatus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur soumission alternative');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Identité KYC ({kycStatus})</Text>
      {errorMsg && <Text style={styles.errorBox}>{errorMsg}</Text>}
      {resultMsg && <Text style={styles.info}>{resultMsg}</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>1. Consentement biométrique obligatoire</Text>
        <TouchableOpacity style={styles.primaryBtn} disabled={loading} onPress={() => toggleConsent(!consent)}>
          <Text style={styles.primaryBtnText}>{consent ? 'Retirer mon consentement' : 'Accorder mon consentement'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>2. Biométrie matérielle Android (BiometricPrompt)</Text>
        <TouchableOpacity style={styles.outlineBtn} disabled={!consent || loading} onPress={runHardwareBiometricAndHalisi}>
          <Text style={styles.outlineBtnText}>Vérifier capteur système & Halisi Mock</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>3. Selfie + Pièce d’identité (Gemini Éphémère)</Text>
        <Text style={styles.sub}>
          Selfie : {selfieBase64 ? 'Capturé ✓' : 'En attente'} · Document : {docBase64 ? 'Capturé ✓' : 'Optionnel'}
        </Text>

        {cameraMode !== 'NONE' && cameraPermission?.granted ? (
          <View>
            <CameraView ref={cameraRef} style={styles.camera} facing={cameraMode === 'SELFIE' ? 'front' : 'back'} />
            <TouchableOpacity style={styles.primaryBtn} onPress={capturePhoto}>
              <Text style={styles.primaryBtnText}>Prendre la photo ({cameraMode})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.outlineBtn, { marginTop: 8 }]} onPress={() => setCameraMode('NONE')}>
              <Text style={styles.outlineBtnText}>Annuler caméra</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <TouchableOpacity
              style={styles.outlineBtn}
              disabled={!consent}
              onPress={async () => {
                const p = await requestCameraPermission();
                if (p.granted) setCameraMode('SELFIE');
                else setErrorMsg('Permission caméra refusée.');
              }}
            >
              <Text style={styles.outlineBtnText}>Capturer Selfie (Caméra avant)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.outlineBtn}
              disabled={!consent}
              onPress={async () => {
                const p = await requestCameraPermission();
                if (p.granted) setCameraMode('DOCUMENT');
                else setErrorMsg('Permission caméra refusée.');
              }}
            >
              <Text style={styles.outlineBtnText}>Capturer Pièce d’identité (Caméra arrière)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.primaryBtn} disabled={!consent || !selfieBase64 || loading} onPress={submitGeminiFaceDoc}>
              {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Analyser via Gemini</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>4. Défi vocal Gemini</Text>
        <Text style={styles.sub}>Phrase à lire : « {VOICE_PHRASE} »</Text>
        <TouchableOpacity style={styles.outlineBtn} disabled={!consent || loading} onPress={toggleVoiceChallenge}>
          <Text style={styles.outlineBtnText}>{recording ? 'Arrêter & Analyser' : 'Enregistrer ma voix'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>5. Parcours alternatif (Validation agent)</Text>
        <TextInput style={styles.input} placeholder="4 derniers chiffres Carte Électeur / Passeport" value={altLast4} onChangeText={setAltLast4} />
        <TextInput style={styles.input} placeholder="Motif (ex. Caméra indisponible)" value={altReason} onChangeText={setAltReason} />
        <TouchableOpacity style={styles.outlineBtn} disabled={loading} onPress={submitAlternative}>
          <Text style={styles.outlineBtnText}>Envoyer à un agent KYC</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: '#111111' },
  card: { padding: 16, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 14 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#111111', marginBottom: 8 },
  sub: { fontSize: 12, color: VMicroTheme.colors.muted, marginBottom: 10 },
  camera: { height: 240, borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  input: { minHeight: 44, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 10, paddingHorizontal: 12, marginBottom: 10 },
  primaryBtn: { minHeight: 44, backgroundColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  outlineBtn: { minHeight: 44, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  outlineBtnText: { color: VMicroTheme.colors.primary, fontWeight: '600', fontSize: 13 },
  info: { padding: 10, borderWidth: 1, borderColor: VMicroTheme.colors.secondary, borderRadius: 8, fontSize: 12 },
  errorBox: { padding: 10, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 8, fontSize: 12, color: VMicroTheme.colors.primary },
});
