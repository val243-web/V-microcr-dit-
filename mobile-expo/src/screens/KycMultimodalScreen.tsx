import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import { VMicroTheme } from '../theme/tokens';
import { mobileApiRequest } from '../security/httpsClient';
import { authenticateWithDeviceBiometrics } from '../security/biometricAuth';

const VOICE_PHRASE = 'Je confirme mon identité sur V-Micro Crédit';

export function KycMultimodalScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [consent, setConsent] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const cameraRef = useRef<CameraView | null>(null);

  async function toggleConsent(granted: boolean) {
    await mobileApiRequest('/kyc/consent', {
      method: 'POST',
      body: JSON.stringify({ granted }),
    });
    setConsent(granted);
    setResultMsg(granted ? 'Consentement biométrique accordé.' : 'Consentement révoqué.');
  }

  async function runHardwareBiometric() {
    const res = await authenticateWithDeviceBiometrics('Vérifier empreinte matérielle Android');
    setResultMsg(res.success ? 'Biométrie matérielle Android confirmée.' : res.error || 'Échec biométrique.');
  }

  async function captureAndVerifyFace() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.6 });
    setCameraOpen(false);
    if (!photo?.base64) return;

    const res = await mobileApiRequest<{ verificationRef: string; passed: boolean; observations: string }>(
      '/kyc/gemini-verify-face-doc',
      {
        method: 'POST',
        body: JSON.stringify({
          selfieBase64: photo.base64,
          selfieMimeType: 'image/jpeg',
        }),
      }
    );
    setResultMsg(`Gemini Facial (${res.verificationRef}) : ${res.passed ? 'VALIDÉ' : 'NON CONCLUANT'} — ${res.observations}`);
  }

  async function toggleVoiceChallenge() {
    if (!recording) {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
    } else {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (!uri) return;
      const response = await fetch(uri);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = String(reader.result || '').split(',')[1];
        if (!base64) return;
        const res = await mobileApiRequest<{ verificationRef: string; transcript: string; passed: boolean }>(
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
        setResultMsg(`Voix Gemini (${res.verificationRef}) : ${res.passed ? 'VALIDÉ' : 'ÉCHEC'} — « ${res.transcript} »`);
      };
      reader.readAsDataURL(blob);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Identité & Tests Gemini</Text>
      {resultMsg && <Text style={styles.info}>{resultMsg}</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>1. Consentement biométrique</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => toggleConsent(!consent)}>
          <Text style={styles.primaryBtnText}>{consent ? 'Retirer consentement' : 'Accorder mon consentement'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>2. Biométrie matérielle Android (BiometricPrompt)</Text>
        <TouchableOpacity style={styles.outlineBtn} onPress={runHardwareBiometric}>
          <Text style={styles.outlineBtnText}>Tester empreinte / capteur système</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>3. Reconnaissance faciale & Liveness (Gemini)</Text>
        {cameraOpen && cameraPermission?.granted ? (
          <View>
            <CameraView ref={cameraRef} style={styles.camera} facing="front" />
            <TouchableOpacity style={styles.primaryBtn} onPress={captureAndVerifyFace}>
              <Text style={styles.primaryBtnText}>Capturer & Analyser via Gemini</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.primaryBtn}
            disabled={!consent}
            onPress={async () => {
              await requestCameraPermission();
              setCameraOpen(true);
            }}
          >
            <Text style={styles.primaryBtnText}>Ouvrir caméra selfie</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>4. Vérification vocale (Gemini Audio)</Text>
        <Text style={styles.sub}>Phrase à lire : « {VOICE_PHRASE} »</Text>
        <TouchableOpacity style={styles.outlineBtn} disabled={!consent} onPress={toggleVoiceChallenge}>
          <Text style={styles.outlineBtnText}>{recording ? 'Arrêter & Vérifier' : 'Enregistrer ma voix'}</Text>
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
  primaryBtn: { minHeight: 44, backgroundColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  outlineBtn: { minHeight: 44, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  outlineBtnText: { color: VMicroTheme.colors.primary, fontWeight: '600', fontSize: 13 },
  info: { padding: 10, borderWidth: 1, borderColor: VMicroTheme.colors.secondary, borderRadius: 8, fontSize: 12 },
});
