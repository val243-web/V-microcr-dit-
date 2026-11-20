import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { VMicroTheme } from '../theme/tokens';
import { mobileApiRequest, toNumber } from '../security/httpsClient';

interface LoanItem {
  id: string;
  business_activity: string;
  requested_amount: unknown;
  duration_months: number;
  status: string;
  score?: number;
}

interface ScheduleRow {
  id: string;
  installment_number: number;
  due_date: string;
  total_due: unknown;
  status: string;
}

export function CreditScreen() {
  const [loans, setLoans] = useState<LoanItem[]>([]);
  const [amount, setAmount] = useState('350');
  const [months, setMonths] = useState('6');
  const [income, setIncome] = useState('650');
  const [expenses, setExpenses] = useState('300');
  const [activity, setActivity] = useState('Commerce alimentaire Kinshasa');
  const [purpose, setPurpose] = useState('Approvisionnement stock boutique');
  const [estimateText, setEstimateText] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [repayProvider, setRepayProvider] = useState<'AIRTEL_MONEY' | 'ORANGE_MONEY' | 'VODACOM_MPESA'>('AIRTEL_MONEY');

  async function load() {
    setErrorMsg(null);
    try {
      const res = await mobileApiRequest<{ applications: LoanItem[] }>('/loans');
      setLoans(res.applications);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur chargement crédits');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleEstimate() {
    setErrorMsg(null);
    setLoading(true);
    try {
      const est = await mobileApiRequest<{ monthlyInstallment: unknown; totalRepayable: unknown; annualInterestRate: unknown }>(
        '/loans/estimate',
        {
          method: 'POST',
          body: JSON.stringify({
            requestedAmount: Number(amount) || 100,
            durationMonths: Number(months) || 6,
          }),
        }
      );
      setEstimateText(
        `Mensualité estimée : ${toNumber(est.monthlyInstallment).toFixed(2)} USD · Total : ${toNumber(est.totalRepayable).toFixed(2)} USD (Taux ${toNumber(est.annualInterestRate)}%/an)`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur calcul');
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (activity.trim().length < 3 || Number(amount) < 20) {
      setErrorMsg('Activité économique requise et montant minimum 20 USD.');
      return;
    }
    setErrorMsg(null);
    setFeedback(null);
    setLoading(true);
    try {
      const res = await mobileApiRequest<{ loanId: string; solvency: { score: number; disclaimer: string } }>('/loans/apply', {
        method: 'POST',
        body: JSON.stringify({
          businessActivity: activity.trim(),
          businessYears: 2,
          monthlyIncome: Number(income),
          monthlyExpenses: Number(expenses),
          existingCommitments: 0,
          requestedAmount: Number(amount),
          durationMonths: Number(months),
          purpose: purpose.trim() || 'Développement activité commerciale',
        }),
      });
      setFeedback(`Demande ${res.loanId} enregistrée · Score indicatif : ${res.solvency.score}/100. ${res.solvency.disclaimer}`);
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur soumission demande');
    } finally {
      setLoading(false);
    }
  }

  async function openLoanDetail(loanId: string) {
    setErrorMsg(null);
    setLoading(true);
    try {
      const detail = await mobileApiRequest<{ schedule: ScheduleRow[] }>(`/loans/${loanId}`);
      setSchedule(detail.schedule || []);
      setSelectedLoanId(loanId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossible de charger l’échéancier');
    } finally {
      setLoading(false);
    }
  }

  async function handleRepay(scheduleId: string) {
    if (!selectedLoanId) return;
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await mobileApiRequest<{ reference: string; amountPaid: unknown }>(`/loans/${selectedLoanId}/repay`, {
        method: 'POST',
        body: JSON.stringify({
          scheduleId,
          provider: repayProvider,
          idempotencyKey: `rep_${scheduleId}_${Date.now()}`,
        }),
      });
      setFeedback(`Échéance réglée (Simulation · ${toNumber(res.amountPaid).toFixed(2)} USD · Réf ${res.reference})`);
      await openLoanDetail(selectedLoanId);
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur de remboursement');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Microcrédit Responsable</Text>
      {errorMsg && <Text style={styles.errorBox}>{errorMsg}</Text>}
      {feedback && <Text style={styles.info}>{feedback}</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Nouvelle demande de crédit</Text>
        <TextInput style={styles.input} placeholder="Activité économique" value={activity} onChangeText={setActivity} />
        <TextInput style={styles.input} placeholder="Objet du crédit" value={purpose} onChangeText={setPurpose} />
        <TextInput style={styles.input} keyboardType="numeric" placeholder="Revenu mensuel USD" value={income} onChangeText={setIncome} />
        <TextInput style={styles.input} keyboardType="numeric" placeholder="Dépenses mensuelles USD" value={expenses} onChangeText={setExpenses} />
        <TextInput style={styles.input} keyboardType="numeric" placeholder="Montant souhaité USD (20 - 10 000)" value={amount} onChangeText={setAmount} />
        <TextInput style={styles.input} keyboardType="numeric" placeholder="Durée en mois (1 - 24)" value={months} onChangeText={setMonths} />

        {estimateText && <Text style={[styles.info, { marginBottom: 10 }]}>{estimateText}</Text>}

        <View style={{ gap: 8 }}>
          <TouchableOpacity style={styles.outlineBtn} disabled={loading} onPress={handleEstimate}>
            <Text style={styles.outlineBtnText}>Simuler la mensualité</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryBtn} disabled={loading} onPress={handleApply}>
            {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Évaluer et soumettre</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {loans.map((l) => (
        <View key={l.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {toNumber(l.requested_amount).toFixed(2)} USD · {l.duration_months} mois
          </Text>
          <Text style={styles.sub}>
            Statut : {l.status} {l.score ? `· Score indicatif : ${l.score}/100` : ''}
          </Text>
          <TouchableOpacity style={[styles.outlineBtn, { marginTop: 10 }]} onPress={() => openLoanDetail(l.id)}>
            <Text style={styles.outlineBtnText}>Voir échéancier & rembourser</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Modal visible={Boolean(selectedLoanId)} animationType="slide" onRequestClose={() => setSelectedLoanId(null)}>
        <View style={styles.modalContainer}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Échéancier du crédit</Text>
            <TouchableOpacity style={styles.outlineBtn} onPress={() => setSelectedLoanId(null)}>
              <Text style={styles.outlineBtnText}>Fermer</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.row, { marginVertical: 10 }]}>
            {(['AIRTEL_MONEY', 'ORANGE_MONEY', 'VODACOM_MPESA'] as const).map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setRepayProvider(p)}
                style={[styles.chip, repayProvider === p && styles.chipActive]}
              >
                <Text style={[styles.chipText, repayProvider === p && styles.chipTextActive]}>{p.replace('_', ' ')}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView contentContainerStyle={{ gap: 10 }}>
            {schedule.length === 0 ? (
              <Text style={styles.sub}>Aucun échéancier actif (dossier en attente ou non approuvé).</Text>
            ) : (
              schedule.map((s) => (
                <View key={s.id} style={styles.card}>
                  <Text style={styles.cardTitle}>
                    Échéance #{s.installment_number} · {String(s.due_date).slice(0, 10)}
                  </Text>
                  <Text style={styles.sub}>
                    Montant : {toNumber(s.total_due).toFixed(2)} USD · Statut : {s.status}
                  </Text>
                  {s.status !== 'PAID' && (
                    <TouchableOpacity
                      style={[styles.primaryBtn, { marginTop: 10 }]}
                      disabled={loading}
                      onPress={() => handleRepay(s.id)}
                    >
                      <Text style={styles.primaryBtnText}>Payer via {repayProvider.replace('_', ' ')} (Simulation)</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { padding: 16, gap: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: '#111111' },
  card: { padding: 16, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 14 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#111111', marginBottom: 8 },
  sub: { fontSize: 12, color: VMicroTheme.colors.muted },
  input: { minHeight: 44, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 10, paddingHorizontal: 12, marginBottom: 10 },
  primaryBtn: { minHeight: 44, backgroundColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  outlineBtn: { minHeight: 40, paddingHorizontal: 14, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  outlineBtnText: { color: VMicroTheme.colors.primary, fontWeight: '600', fontSize: 12 },
  info: { padding: 10, borderWidth: 1, borderColor: VMicroTheme.colors.secondary, borderRadius: 8, fontSize: 12 },
  errorBox: { padding: 10, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 8, fontSize: 12, color: VMicroTheme.colors.primary },
  modalContainer: { flex: 1, backgroundColor: '#FFFFFF', padding: 16, paddingTop: 42 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 8 },
  chipActive: { backgroundColor: VMicroTheme.colors.primary, borderColor: VMicroTheme.colors.primary },
  chipText: { fontSize: 11, color: '#111111' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },
});
