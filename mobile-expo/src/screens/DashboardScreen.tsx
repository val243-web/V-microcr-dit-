import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { VMicroTheme } from '../theme/tokens';
import { mobileApiRequest } from '../security/httpsClient';

interface DashboardPayload {
  account: { available_balance: number; locked_goals_balance: number; total_savings: number };
  goals: Array<{ id: string; title: string; current_amount: number; target_amount: number }>;
  nextInstallments: Array<{ installment_number: number; due_date: string; total_due: number }>;
  kyc: { status: string };
}

export function DashboardScreen({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await mobileApiRequest<DashboardPayload>('/dashboard');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur chargement');
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
    >
      <Text style={styles.headerTitle}>Tableau de bord</Text>
      <Text style={styles.simBanner}>Mode Simulation RDC · Aucune opération financière réelle</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      {data && (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>Épargne totale cumulée</Text>
            <Text style={styles.bigAmount}>{data.account.total_savings.toFixed(2)} USD</Text>
            <Text style={styles.sub}>
              Disponible : {data.account.available_balance.toFixed(2)} USD · Objectifs :{' '}
              {data.account.locked_goals_balance.toFixed(2)} USD
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Identité KYC</Text>
            <Text style={styles.value}>{data.kyc.status}</Text>
            <TouchableOpacity style={styles.outlineBtn} onPress={() => onNavigate('KYC')}>
              <Text style={styles.outlineBtnText}>Tester vérification Gemini / Biométrie</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Objectifs actifs ({data.goals.length})</Text>
            {data.goals.map((g) => (
              <View key={g.id} style={styles.goalRow}>
                <Text style={styles.goalTitle}>{g.title}</Text>
                <Text style={styles.goalVal}>
                  {g.current_amount.toFixed(0)} / {g.target_amount.toFixed(0)} USD
                </Text>
              </View>
            ))}
            <TouchableOpacity style={styles.primaryBtn} onPress={() => onNavigate('Épargne')}>
              <Text style={styles.primaryBtnText}>Gérer mon épargne</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: VMicroTheme.colors.background },
  content: { padding: 16, gap: 14 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: VMicroTheme.colors.text },
  simBanner: {
    padding: 10,
    borderWidth: 1,
    borderColor: VMicroTheme.colors.secondary,
    borderRadius: 10,
    fontSize: 12,
    color: VMicroTheme.colors.text,
  },
  card: {
    padding: 16,
    borderWidth: 1,
    borderColor: VMicroTheme.colors.border,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  label: { fontSize: 12, color: VMicroTheme.colors.muted },
  bigAmount: { fontSize: 28, fontWeight: '700', color: VMicroTheme.colors.primary, marginVertical: 4 },
  value: { fontSize: 16, fontWeight: '600', color: VMicroTheme.colors.text, marginVertical: 4 },
  sub: { fontSize: 12, color: VMicroTheme.colors.muted },
  goalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: VMicroTheme.colors.border },
  goalTitle: { fontSize: 13, fontWeight: '500', color: VMicroTheme.colors.text },
  goalVal: { fontSize: 13, fontWeight: '600', color: VMicroTheme.colors.primary },
  primaryBtn: {
    minHeight: 44,
    backgroundColor: VMicroTheme.colors.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  outlineBtn: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: VMicroTheme.colors.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  outlineBtnText: { color: VMicroTheme.colors.primary, fontWeight: '600', fontSize: 12 },
  error: { color: VMicroTheme.colors.primary, fontSize: 12 },
});
