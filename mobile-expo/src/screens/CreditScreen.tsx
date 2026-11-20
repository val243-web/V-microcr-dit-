import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { VMicroTheme } from '../theme/tokens';
import { mobileApiRequest } from '../security/httpsClient';

export function CreditScreen() {
  const [loans, setLoans] = useState<Array<{ id: string; requested_amount: number; duration_months: number; status: string; score?: number }>>([]);
  const [amount, setAmount] = useState('350');
  const [months, setMonths] = useState('6');
  const [income, setIncome] = useState('650');
  const [expenses, setExpenses] = useState('300');
  const [activity, setActivity] = useState('Commerce alimentaire Kinshasa');
  const [feedback, setFeedback] = useState<string | null>(null);

  async function load() {
    const res = await mobileApiRequest<{ applications: typeof loans }>('/loans');
    setLoans(res.applications);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function handleApply() {
    setFeedback(null);
    const res = await mobileApiRequest<{ loanId: string; solvency: { score: number; disclaimer: string } }>('/loans/apply', {
      method: 'POST',
      body: JSON.stringify({
        businessActivity: activity,
        businessYears: 2,
        monthlyIncome: Number(income),
        monthlyExpenses: Number(expenses),
        existingCommitments: 0,
        requestedAmount: Number(amount),
        durationMonths: Number(months),
        purpose: 'Développement activité commerciale',
      }),
    });
    setFeedback(`Demande ${res.loanId} enregistrée · Score indicatif : ${res.solvency.score}/100. ${res.solvency.disclaimer}`);
    await load();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Microcrédit Responsable</Text>
      {feedback && <Text style={styles.info}>{feedback}</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Nouvelle demande de crédit</Text>
        <TextInput style={styles.input} placeholder="Activité économique" value={activity} onChangeText={setActivity} />
        <TextInput style={styles.input} keyboardType="numeric" placeholder="Revenu mensuel USD" value={income} onChangeText={setIncome} />
        <TextInput style={styles.input} keyboardType="numeric" placeholder="Dépenses mensuelles USD" value={expenses} onChangeText={setExpenses} />
        <TextInput style={styles.input} keyboardType="numeric" placeholder="Montant souhaité USD" value={amount} onChangeText={setAmount} />
        <TextInput style={styles.input} keyboardType="numeric" placeholder="Durée (mois)" value={months} onChangeText={setMonths} />
        <TouchableOpacity style={styles.primaryBtn} onPress={handleApply}>
          <Text style={styles.primaryBtnText}>Évaluer et soumettre</Text>
        </TouchableOpacity>
      </View>

      {loans.map((l) => (
        <View key={l.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {l.requested_amount.toFixed(2)} USD · {l.duration_months} mois
          </Text>
          <Text style={styles.sub}>
            Statut : {l.status} {l.score ? `· Score indicatif : ${l.score}/100` : ''}
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
  sub: { fontSize: 12, color: VMicroTheme.colors.muted },
  input: { minHeight: 44, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 10, paddingHorizontal: 12, marginBottom: 10 },
  primaryBtn: { minHeight: 44, backgroundColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  info: { padding: 10, borderWidth: 1, borderColor: VMicroTheme.colors.secondary, borderRadius: 8, fontSize: 12 },
});
