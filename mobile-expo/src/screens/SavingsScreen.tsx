import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { VMicroTheme } from '../theme/tokens';
import { mobileApiRequest } from '../security/httpsClient';

export function SavingsScreen() {
  const [goals, setGoals] = useState<Array<{ id: string; title: string; current_amount: number; target_amount: number }>>([]);
  const [amount, setAmount] = useState('25');
  const [provider, setProvider] = useState<'AIRTEL_MONEY' | 'ORANGE_MONEY' | 'VODACOM_MPESA'>('AIRTEL_MONEY');
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalTarget, setNewGoalTarget] = useState('200');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  async function load() {
    const res = await mobileApiRequest<{ goals: typeof goals }>('/savings/goals');
    setGoals(res.goals);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function handleDeposit() {
    setStatusMsg(null);
    const init = await mobileApiRequest<{ payment: { reference: string } }>('/payments/initialize', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `mob_${Date.now()}`,
        provider,
        operationType: 'DEPOSIT',
        amount: Number(amount),
        currency: 'USD',
      }),
    });
    await mobileApiRequest('/payments/confirm', {
      method: 'POST',
      body: JSON.stringify({ reference: init.payment.reference }),
    });
    setStatusMsg(`Dépôt simulé confirmé (${init.payment.reference})`);
    await load();
  }

  async function handleCreateGoal() {
    if (!newGoalTitle.trim()) return;
    await mobileApiRequest('/savings/goals', {
      method: 'POST',
      body: JSON.stringify({
        title: newGoalTitle,
        category: 'Commerce',
        targetAmount: Number(newGoalTarget) || 100,
        targetDate: '2027-06-01',
      }),
    });
    setNewGoalTitle('');
    await load();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Épargne & Objectifs</Text>
      {statusMsg && <Text style={styles.info}>{statusMsg}</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Dépôt Mobile Money (Simulation)</Text>
        <View style={styles.row}>
          {(['AIRTEL_MONEY', 'ORANGE_MONEY', 'VODACOM_MPESA'] as const).map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => setProvider(p)}
              style={[styles.chip, provider === p && styles.chipActive]}
            >
              <Text style={[styles.chipText, provider === p && styles.chipTextActive]}>{p.replace('_', ' ')}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput style={styles.input} keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="Montant USD" />
        <TouchableOpacity style={styles.primaryBtn} onPress={handleDeposit}>
          <Text style={styles.primaryBtnText}>Déposer (Simulation)</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Créer un objectif</Text>
        <TextInput style={styles.input} placeholder="Nom de l'objectif" value={newGoalTitle} onChangeText={setNewGoalTitle} />
        <TextInput style={styles.input} keyboardType="numeric" placeholder="Cible USD" value={newGoalTarget} onChangeText={setNewGoalTarget} />
        <TouchableOpacity style={styles.primaryBtn} onPress={handleCreateGoal}>
          <Text style={styles.primaryBtnText}>Ajouter l'objectif</Text>
        </TouchableOpacity>
      </View>

      {goals.map((g) => (
        <View key={g.id} style={styles.card}>
          <Text style={styles.cardTitle}>{g.title}</Text>
          <Text style={styles.sub}>
            {g.current_amount.toFixed(2)} / {g.target_amount.toFixed(2)} USD
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: '#111111' },
  card: { padding: 16, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 14 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#111111', marginBottom: 8 },
  sub: { fontSize: 13, color: VMicroTheme.colors.muted },
  input: { minHeight: 44, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 10, paddingHorizontal: 12, marginBottom: 10 },
  primaryBtn: { minHeight: 44, backgroundColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: { paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 8 },
  chipActive: { backgroundColor: VMicroTheme.colors.primary, borderColor: VMicroTheme.colors.primary },
  chipText: { fontSize: 11, color: '#111111' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  info: { padding: 10, borderWidth: 1, borderColor: VMicroTheme.colors.secondary, borderRadius: 8, fontSize: 12 },
});
