import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { VMicroTheme } from '../theme/tokens';
import { mobileApiRequest, toNumber } from '../security/httpsClient';

interface DashboardPayload {
  account: { available_balance: unknown; locked_goals_balance: unknown; total_savings: unknown };
  goals: Array<{ id: string; title: string; current_amount: unknown; target_amount: unknown }>;
  nextInstallments: Array<{ id: string; installment_number: number; due_date: string; total_due: unknown }>;
  recentTransactions: Array<{ id: string; description: string; amount: unknown; type: string; created_at: string }>;
  recentNotifications: Array<{ id: string; title: string; message: string; read: boolean | number }>;
  kyc: { status: string };
}

export function DashboardScreen({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await mobileApiRequest<DashboardPayload>('/dashboard');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur chargement tableau de bord');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function markNotificationRead(id: string) {
    try {
      await mobileApiRequest(`/notifications/${id}/read`, { method: 'PUT' });
      await load(true);
    } catch {
      // ignore non-critical error
    }
  }

  const unreadCount = data?.recentNotifications?.filter((n) => !n.read).length || 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
    >
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Tableau de bord</Text>
        <TouchableOpacity style={styles.notifBtn} onPress={() => setShowNotifications(true)}>
          <Text style={styles.notifBtnText}>Alertes ({unreadCount})</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.simBanner}>Agrégateurs Mobile Money en mode simulation · Base PostgreSQL prête</Text>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && !data && <ActivityIndicator size="large" color={VMicroTheme.colors.primary} style={{ marginTop: 24 }} />}

      {data && (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>Épargne totale cumulée</Text>
            <Text style={styles.bigAmount}>{toNumber(data.account.total_savings).toFixed(2)} USD</Text>
            <Text style={styles.sub}>
              Disponible : {toNumber(data.account.available_balance).toFixed(2)} USD · Objectifs :{' '}
              {toNumber(data.account.locked_goals_balance).toFixed(2)} USD
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Identité KYC</Text>
            <Text style={styles.value}>{data.kyc.status}</Text>
            <TouchableOpacity style={styles.outlineBtn} onPress={() => onNavigate('KYC')}>
              <Text style={styles.outlineBtnText}>Vérification Biométrique / Gemini</Text>
            </TouchableOpacity>
          </View>

          {data.nextInstallments.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Prochaines échéances de crédit</Text>
              {data.nextInstallments.map((inst) => (
                <View key={inst.id} style={styles.goalRow}>
                  <Text style={styles.goalTitle}>
                    Échéance #{inst.installment_number} · {String(inst.due_date).slice(0, 10)}
                  </Text>
                  <Text style={styles.goalVal}>{toNumber(inst.total_due).toFixed(2)} USD</Text>
                </View>
              ))}
              <TouchableOpacity style={styles.outlineBtn} onPress={() => onNavigate('Crédit')}>
                <Text style={styles.outlineBtnText}>Rembourser une échéance</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Objectifs actifs ({data.goals.length})</Text>
            {data.goals.length === 0 ? (
              <Text style={styles.sub}>Aucun objectif créé pour le moment.</Text>
            ) : (
              data.goals.map((g) => (
                <View key={g.id} style={styles.goalRow}>
                  <Text style={styles.goalTitle}>{g.title}</Text>
                  <Text style={styles.goalVal}>
                    {toNumber(g.current_amount).toFixed(0)} / {toNumber(g.target_amount).toFixed(0)} USD
                  </Text>
                </View>
              ))
            )}
            <TouchableOpacity style={styles.primaryBtn} onPress={() => onNavigate('Épargne')}>
              <Text style={styles.primaryBtnText}>Gérer mon épargne</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Dernières opérations</Text>
            {data.recentTransactions.length === 0 ? (
              <Text style={styles.sub}>Aucune transaction enregistrée.</Text>
            ) : (
              data.recentTransactions.slice(0, 5).map((tx) => (
                <View key={tx.id} style={styles.goalRow}>
                  <Text style={[styles.goalTitle, { flex: 1, paddingRight: 8 }]} numberOfLines={1}>
                    {tx.description}
                  </Text>
                  <Text style={styles.goalVal}>{toNumber(tx.amount).toFixed(2)} USD</Text>
                </View>
              ))
            )}
          </View>
        </>
      )}

      <Modal visible={showNotifications} animationType="slide" onRequestClose={() => setShowNotifications(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Notifications</Text>
            <TouchableOpacity onPress={() => setShowNotifications(false)} style={styles.notifBtn}>
              <Text style={styles.notifBtnText}>Fermer</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ gap: 10, paddingVertical: 12 }}>
            {(data?.recentNotifications || []).map((n) => (
              <TouchableOpacity
                key={n.id}
                style={[styles.card, !n.read && { borderColor: VMicroTheme.colors.primary }]}
                onPress={() => markNotificationRead(n.id)}
              >
                <Text style={styles.cardTitle}>{n.title}</Text>
                <Text style={styles.sub}>{n.message}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: VMicroTheme.colors.background },
  content: { padding: 16, gap: 14 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '700', color: VMicroTheme.colors.text },
  notifBtn: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 10 },
  notifBtnText: { fontSize: 12, fontWeight: '600', color: VMicroTheme.colors.primary },
  simBanner: { padding: 10, borderWidth: 1, borderColor: VMicroTheme.colors.secondary, borderRadius: 10, fontSize: 12, color: VMicroTheme.colors.text },
  card: { padding: 16, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 14, backgroundColor: '#FFFFFF' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: VMicroTheme.colors.text, marginBottom: 6 },
  label: { fontSize: 12, color: VMicroTheme.colors.muted },
  bigAmount: { fontSize: 28, fontWeight: '700', color: VMicroTheme.colors.primary, marginVertical: 4 },
  value: { fontSize: 16, fontWeight: '600', color: VMicroTheme.colors.text, marginVertical: 4 },
  sub: { fontSize: 12, color: VMicroTheme.colors.muted },
  goalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: VMicroTheme.colors.border },
  goalTitle: { fontSize: 13, fontWeight: '500', color: VMicroTheme.colors.text },
  goalVal: { fontSize: 13, fontWeight: '600', color: VMicroTheme.colors.primary },
  primaryBtn: { minHeight: 44, backgroundColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  outlineBtn: { minHeight: 42, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  outlineBtnText: { color: VMicroTheme.colors.primary, fontWeight: '600', fontSize: 12 },
  errorBox: { padding: 12, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 10 },
  errorText: { color: VMicroTheme.colors.primary, fontSize: 12, marginBottom: 8 },
  retryBtn: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: VMicroTheme.colors.primary, borderRadius: 8 },
  retryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  modalContainer: { flex: 1, backgroundColor: '#FFFFFF', padding: 16, paddingTop: 42 },
});
