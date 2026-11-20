import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Audio } from 'expo-av';
import { VMicroTheme } from '../theme/tokens';
import { mobileApiRequest } from '../security/httpsClient';

interface ChatMsg {
  sender: 'USER' | 'ASSISTANT';
  text: string;
  citations?: Array<{ id: string; title: string }>;
}

export function AssistantScreen() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    mobileApiRequest<{ messages: Array<{ sender: 'USER' | 'ASSISTANT'; content: string }> }>('/assistant/conversations')
      .then((res) => {
        if (res.messages?.length) {
          setMessages(res.messages.map((m) => ({ sender: m.sender, text: m.content })));
        }
      })
      .catch(() => {});

    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  async function send(textOverride?: string) {
    const msg = (textOverride ?? input).trim();
    if (!msg || loading) return;
    setInput('');
    setErrorMsg(null);
    setMessages((prev) => [...prev, { sender: 'USER', text: msg }]);
    setLoading(true);
    try {
      const res = await mobileApiRequest<{ reply: string; citations?: Array<{ id: string; title: string }> }>('/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({ message: msg }),
      });
      setMessages((prev) => [...prev, { sender: 'ASSISTANT', text: res.reply, citations: res.citations }]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur Assistant');
    } finally {
      setLoading(false);
    }
  }

  async function toggleDictation() {
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
        setErrorMsg(err instanceof Error ? err.message : 'Erreur microphone');
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
        const res = await mobileApiRequest<{ transcript: string }>('/assistant/transcribe', {
          method: 'POST',
          body: JSON.stringify({ audioBase64: base64, mimeType: 'audio/m4a' }),
        });
        setInput(res.transcript);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Erreur transcription vocale');
      } finally {
        setLoading(false);
      }
    }
  }

  async function speakReply(text: string, idx: number) {
    setErrorMsg(null);
    setPlayingIdx(idx);
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      const res = await mobileApiRequest<{ audioBase64: string; mimeType: string }>('/assistant/tts', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: `data:${res.mimeType || 'audio/wav'};base64,${res.audioBase64}` },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingIdx(null);
        }
      });
    } catch (err) {
      setPlayingIdx(null);
      setErrorMsg(err instanceof Error ? err.message : 'Lecture vocale indisponible');
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Assistant V-Micro</Text>
      <Text style={styles.disclaimer}>
        Ne reçoit ni mot de passe ni biométrie. Ne peut pas approuver de crédit ou modifier un solde.
      </Text>
      {errorMsg && <Text style={styles.errorBox}>{errorMsg}</Text>}

      <ScrollView style={styles.feed} contentContainerStyle={{ gap: 10 }}>
        {messages.map((m, idx) => (
          <View key={idx} style={[styles.bubble, m.sender === 'USER' ? styles.userBubble : styles.aiBubble]}>
            <Text style={m.sender === 'USER' ? styles.userText : styles.aiText}>{m.text}</Text>
            {m.citations && m.citations.length > 0 && (
              <Text style={styles.citationText}>Sources : {m.citations.map((c) => c.title).join(', ')}</Text>
            )}
            {m.sender === 'ASSISTANT' && (
              <TouchableOpacity onPress={() => speakReply(m.text, idx)} style={styles.ttsBtn}>
                <Text style={styles.ttsBtnText}>{playingIdx === idx ? 'Lecture en cours...' : 'Écouter'}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        {loading && <ActivityIndicator size="small" color={VMicroTheme.colors.primary} />}
      </ScrollView>

      <View style={styles.inputRow}>
        <TouchableOpacity style={styles.micBtn} onPress={toggleDictation}>
          <Text style={styles.micText}>{recording ? 'Stop' : 'Micro'}</Text>
        </TouchableOpacity>
        <TextInput style={styles.input} value={input} onChangeText={setInput} placeholder="Posez une question..." />
        <TouchableOpacity style={styles.sendBtn} disabled={loading} onPress={() => send()}>
          <Text style={styles.sendText}>Envoyer</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', padding: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#111111' },
  disclaimer: { fontSize: 11, color: VMicroTheme.colors.muted, marginVertical: 6 },
  errorBox: { padding: 8, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 8, fontSize: 12, color: VMicroTheme.colors.primary, marginBottom: 6 },
  feed: { flex: 1, marginVertical: 8 },
  bubble: { padding: 12, borderRadius: 12, maxWidth: '88%' },
  userBubble: { alignSelf: 'flex-end', backgroundColor: VMicroTheme.colors.primary },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: VMicroTheme.colors.surface, borderWidth: 1, borderColor: VMicroTheme.colors.border },
  userText: { color: '#FFFFFF', fontSize: 13 },
  aiText: { color: '#111111', fontSize: 13 },
  citationText: { fontSize: 10, color: VMicroTheme.colors.muted, marginTop: 6 },
  ttsBtn: { marginTop: 8, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 6 },
  ttsBtnText: { fontSize: 11, color: VMicroTheme.colors.primary, fontWeight: '600' },
  inputRow: { flexDirection: 'row', gap: 6, paddingTop: 8 },
  micBtn: { minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 10, justifyContent: 'center' },
  micText: { color: VMicroTheme.colors.primary, fontWeight: '600', fontSize: 12 },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 10, paddingHorizontal: 10 },
  sendBtn: { minHeight: 44, paddingHorizontal: 14, backgroundColor: VMicroTheme.colors.primary, borderRadius: 10, justifyContent: 'center' },
  sendText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
});
