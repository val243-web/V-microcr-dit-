import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { VMicroTheme } from '../theme/tokens';
import { mobileApiRequest, toNumber } from '../security/httpsClient';

type ProviderId = 'AIRTEL_MONEY' | 'ORANGE_MONEY' | 'VODACOM_MPESA' | 'FLEXPAY_AGGREGATOR';

interface GoalItem {
  id: string;
  title: string;
  category: string;
  current_amount: unknown;
  target_amount: unknown;
  target_date: string;
}

export function SavingsScreen() {
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [availableBalance, setAvailableBalance] = useState(0);
  const [lockedBalance, setLockedBalance] = useState(0);
  const [operationType, setOperationType] = useState<'DEPOSIT' | 'WITHDRAWAL' | 'GOAL_DEPOSIT'>('DEPOSIT');
  const [selectedGoalId, setSelectedGoalId] = useState<string>('');
  const [amount, setAmount] = useState('25');
  const [phone, setPhone] = useState('+243812345678');
  const [provider, setProvider] = useState<ProviderId>('AIRTEL_MONEY');
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalCategory, setNewGoalCategory] = useState('Commerce');
  const [newGoalTarget, setNewGoalTarget] = useState('200');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function load() {
    setErrorMsg(null);
    try {
      const [goalsRes, dashRes] = await Promise.all([
        mobileApiRequest<{ goals: GoalItem[] }>('/savings/goals'),
        mobileApiRequest<{ account: { available_balance: unknown; locked_goals_balance: unknown } }>('/dashboard'),
      ]);
      setGoals(goalsRes.goals);
      if (goalsRes.goals.length > 0 && !selectedGoalId) {
        setSelectedGoalId(goalsRes.goals[0].id);
      }
      setAvailableBalance(toNumber(dashRes.account.available_balance));
      setLockedBalance(toNumber(dashRes.account.locked_goals_balance));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur chargement épargne');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handlePaymentOperation() {
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setErrorMsg('Veuillez saisir un montant valide supérieur à 0.');
      return;
    }
    if (operationType === 'GOAL_DEPOSIT' && !selectedGoalId) {
      setErrorMsg('Veuillez sélectionner un objectif cible.');
      return;
    }

    setErrorMsg(null);
    setStatusMsg(null);
    setLoading(true);
    try {
      const init = await mobileApiRequest<{ payment: { reference: string } }>('/payments/initialize', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `mob_${operationType}_${Date.now()}`,
          provider,
          operationType,
          amount: numAmount,
          currency: 'USD',
          phoneNumber: phone.trim(),
          goalId: operationType === 'GOAL_DEPOSIT' ? selectedGoalId : undefined,
        }),
      });
      await mobileApiRequest('/payments/confirm', {
        method: 'POST',
        body: JSON.stringify({ reference: init.payment.reference }),
      });
      setStatusMsg(`Opération ${operationType} confirmée (Simulation · Réf ${init.payment.reference})`);
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Échec de l’opération Mobile Money');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGoal() {
    if (newGoalTitle.trim().length < 2) {
      setErrorMsg('Nom d’objectif requis (2 caractères minimum).');
      return;
    }
    setErrorMsg(null);
    setStatusMsg(null);
    setLoading(true);
    try {
      await mobileApiRequest('/savings/goals', {
        method: 'POST',
        body: JSON.stringify({
          title: newGoalTitle.trim(),
          category: newGoalCategory.trim() || 'Commerce',
          targetAmount: Number(newGoalTarget) || 100,
          targetDate: '2027-06-01',
        }),
      });
      setNewGoalTitle('');
      setStatusMsg('Nouvel objectif d’épargne créé.');
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossible de créer l’objectif');
    } finally {
      setLoading(false);
    }
  }

  async function handleReleaseGoal(goalId: string) {
    setErrorMsg(null);
    setStatusMsg(null);
    setLoading(true);
    try {
      const res = await mobileApiRequest<{ message: string }>(`/savings/goals/${goalId}/release`, {
        method: 'POST',
      });
      setStatusMsg(res.message);
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur libération');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteGoal(goalId: string) {
    setErrorMsg(null);
    setStatusMsg(null);
    setLoading(true);
    try {
      const res = await mobileApiRequest<{ message: string }>(`/savings/goals/${goalId}`, {
        method: 'DELETE',
      });
      setStatusMsg(res.message);
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur suppression');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Épargne & Objectifs</Text>

      <View style={styles.balanceCard}>
        <Text style={styles.sub}>Disponible : {availableBalance.toFixed(2)} USD</Text>
        <Text style={styles.sub}>Objectifs verrouillés : {lockedBalance.toFixed(2)} USD</Text>
      </View>

      {errorMsg && <Text style={styles.errorBox}>{errorMsg}</Text>}
      {statusMsg && <Text style={styles.info}>{statusMsg}</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Opérations Mobile Money (Simulation)</Text>
        <View style={styles.row}>
          {([
            ['DEPOSIT', 'Dépôt libre'],
            ['GOAL_DEPOSIT', 'Vers objectif'],
            ['WITHDRAWAL', 'Retrait'],
          ] as const).map(([op, label]) => (
            <TouchableOpacity
              key={op}
              onPress={() => setOperationType(op)}
              style={[styles.chip, operationType === op && styles.chipActive]}
            >
              <Text style={[styles.chipText, operationType === op && styles.chipTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.row}>
          {(['AIRTEL_MONEY', 'ORANGE_MONEY', 'VODACOM_MPESA', 'FLEXPAY_AGGREGATOR'] as const).map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => setProvider(p)}
              style={[styles.chip, provider === p && styles.chipActive]}
            >
              <Text style={[styles.chipText, provider === p && styles.chipTextActive]}>
                {p.replace('_AGGREGATOR', '').replace('_', ' ')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {operationType === 'GOAL_DEPOSIT' && goals.length > 0 && (
          <View style={styles.row}>
            {goals.map((g) => (
              <TouchableOpacity
                key={g.id}
                onPress={() => setSelectedGoalId(g.id)}
                style={[styles.chip, selectedGoalId === g.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, selectedGoalId === g.id && styles.chipTextActive]}>{g.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="Numéro Mobile Money (+243...)" />
        <TextInput style={styles.input} keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="Montant USD" />
        <TouchableOpacity style={styles.primaryBtn} disabled={loading} onPress={handlePaymentOperation}>
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryBtnText}>Exécuter l’opération (Simulation)</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Créer un objectif d’épargne</Text>
        <TextInput style={styles.input} placeholder="Nom de l'objectif" value={newGoalTitle} onChangeText={setNewGoalTitle} />
        <TextInput style={styles.input} placeholder="Catégorie (Commerce, Éducation...)" value={newGoalCategory} onChangeText={setNewGoalCategory} />
        <TextInput style={styles.input} keyboardType="numeric" placeholder="Cible USD" value={newGoalTarget} onChangeText={setNewGoalTarget} />
        <TouchableOpacity style={styles.primaryBtn} disabled={loading} onPress={handleCreateGoal}>
          <Text style={styles.primaryBtnText}>Ajouter l’objectif</Text>
        </TouchableOpacity>
      </View>

      {goals.map((g) => {
        const cur = toNumber(g.current_amount);
        const tgt = toNumber(g.target_amount);
        return (
          <View key={g.id} style={styles.card}>
            <Text style={styles.cardTitle}>{g.title}</Text>
            <Text style={styles.sub}>
              {g.category} · {cur.toFixed(2)} / {tgt.toFixed(2)} USD
            </Text>
            <View style={[styles.row, { marginTop: 10, marginBottom: 0 }]}>
              {cur > 0 && (
                <TouchableOpacity style={styles.outlineBtn} disabled={loading} onPress={() => handleReleaseGoal(g.id)}>
                  <Text style={styles.outlineBtnText}>Libérer vers libre</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.outlineBtn} disabled={loading} onPress={() => handleDeleteGoal(g.id)}>
                <Text style={styles.outlineBtnText}>Supprimer</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: '#111111' },
  balanceCard: { padding: 12, borderWidth: 1, borderColor: VMicroTheme.colors.secondary, borderRadius: 12, gap: 4 },
  card: { padding: 16, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 14 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#111111', marginBottom: 8 },
  sub: { fontSize: 13, color: VMicroTheme.colors.muted },
  input: { minHeight: 44, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 10, paddingHorizontal: 12, marginBottom: 10 },
  primaryBtn: { minHeight: 44, backgroundColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  outlineBtn: { minHeight: 38, paddingHorizontal: 12, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  outlineBtnText: { color: VMicroTheme.colors.primary, fontWeight: '600', fontSize: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: { paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 8 },
  chipActive: { backgroundColor: VMicroTheme.colors.primary, borderColor: VMicroTheme.colors.primary },
  chipText: { fontSize: 11, color: '#111111' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  info: { padding: 10, borderWidth: 1, borderColor: VMicroTheme.colors.secondary, borderRadius: 8, fontSize: 12 },
  errorBox: { padding: 10, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 8, fontSize: 12, color: VMicroTheme.colors.primary },
});
