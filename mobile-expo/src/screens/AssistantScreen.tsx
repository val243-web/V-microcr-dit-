import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { VMicroTheme } from '../theme/tokens';
import { mobileApiRequest } from '../security/httpsClient';

export function AssistantScreen() {
  const [messages, setMessages] = useState<Array<{ sender: 'USER' | 'ASSISTANT'; text: string }>>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function send() {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { sender: 'USER', text: msg }]);
    setLoading(true);
    try {
      const res = await mobileApiRequest<{ reply: string }>('/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({ message: msg }),
      });
      setMessages((prev) => [...prev, { sender: 'ASSISTANT', text: res.reply }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { sender: 'ASSISTANT', text: err instanceof Error ? err.message : 'Erreur Assistant' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Assistant V-Micro</Text>
      <Text style={styles.disclaimer}>
        Ne reçoit ni mot de passe ni biométrie. Ne peut pas approuver de crédit ou modifier un solde.
      </Text>
      <ScrollView style={styles.feed} contentContainerStyle={{ gap: 10 }}>
        {messages.map((m, idx) => (
          <View key={idx} style={[styles.bubble, m.sender === 'USER' ? styles.userBubble : styles.aiBubble]}>
            <Text style={m.sender === 'USER' ? styles.userText : styles.aiText}>{m.text}</Text>
          </View>
        ))}
        {loading && <Text style={styles.loading}>Assistant V-Micro rédige...</Text>}
      </ScrollView>
      <View style={styles.inputRow}>
        <TextInput style={styles.input} value={input} onChangeText={setInput} placeholder="Posez une question..." />
        <TouchableOpacity style={styles.sendBtn} onPress={send}>
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
  feed: { flex: 1, marginVertical: 8 },
  bubble: { padding: 12, borderRadius: 12, maxWidth: '85%' },
  userBubble: { alignSelf: 'flex-end', backgroundColor: VMicroTheme.colors.primary },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: VMicroTheme.colors.surface, borderWidth: 1, borderColor: VMicroTheme.colors.border },
  userText: { color: '#FFFFFF', fontSize: 13 },
  aiText: { color: '#111111', fontSize: 13 },
  loading: { fontSize: 12, color: VMicroTheme.colors.muted },
  inputRow: { flexDirection: 'row', gap: 8, paddingTop: 8 },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 10, paddingHorizontal: 12 },
  sendBtn: { minHeight: 44, paddingHorizontal: 16, backgroundColor: VMicroTheme.colors.primary, borderRadius: 10, justifyContent: 'center' },
  sendText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
});
