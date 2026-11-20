import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { VMicroTheme } from '../theme/tokens';
import { clearAuthTokens, isBiometricUnlockEnabled, setBiometricUnlockEnabled } from '../security/secureStorage';
import { mobileApiRequest } from '../security/httpsClient';

interface SessionRow {
  id: string;
  device_label: string;
  revoked: boolean | number;
  last_used_at: string;
}

export function ProfileScreen({ onLogout }: { onLogout: () => void }) {
  const [bioEnabled, setBioEnabled] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [city, setCity] = useState('');
  const [profession, setProfession] = useState('');
  const [language, setLanguage] = useState<'fr' | 'sw' | 'en'>('fr');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [loanUpdates, setLoanUpdates] = useState(true);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function load() {
    setErrorMsg(null);
    try {
      const [bio, me, notif, sess] = await Promise.all([
        isBiometricUnlockEnabled(),
        mobileApiRequest<{
          profile: { first_name: string; last_name: string; city: string; profession?: string; language?: 'fr' | 'sw' | 'en' };
        }>('/me'),
        mobileApiRequest<{ preferences: { push_enabled: boolean | number; loan_updates: boolean | number } }>('/notifications'),
        mobileApiRequest<{ currentSessionId: string; sessions: SessionRow[] }>('/auth/sessions'),
      ]);
      setBioEnabled(bio);
      setFirstName(me.profile.first_name || '');
      setLastName(me.profile.last_name || '');
      setCity(me.profile.city || '');
      setProfession(me.profile.profession || '');
      setLanguage(me.profile.language || 'fr');
      setPushEnabled(Boolean(notif.preferences?.push_enabled));
      setLoanUpdates(Boolean(notif.preferences?.loan_updates));
      setCurrentSessionId(sess.currentSessionId || '');
      setSessions(sess.sessions || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur chargement profil');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveProfile() {
    setErrorMsg(null);
    setFeedback(null);
    setLoading(true);
    try {
      await mobileApiRequest('/me/profile', {
        method: 'PUT',
        body: JSON.stringify({ firstName, lastName, city, profession, language }),
      });
      setFeedback('Profil mis à jour.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur mise à jour profil');
    } finally {
      setLoading(false);
    }
  }

  async function changeLanguage(lang: 'fr' | 'sw' | 'en') {
    setLanguage(lang);
    try {
      await mobileApiRequest('/me/preferences', {
        method: 'PUT',
        body: JSON.stringify({ language: lang }),
      });
      setFeedback(`Langue mise à jour : ${lang.toUpperCase()}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur langue');
    }
  }

  async function toggleBio(val: boolean) {
    setBioEnabled(val);
    await setBiometricUnlockEnabled(val);
  }

  async function updateNotifPref(nextPush: boolean, nextLoans: boolean) {
    setPushEnabled(nextPush);
    setLoanUpdates(nextLoans);
    try {
      await mobileApiRequest('/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({ push_enabled: nextPush, loan_updates: nextLoans }),
      });
    } catch {
      // ignore
    }
  }

  async function revokeSession(id: string) {
    try {
      await mobileApiRequest(`/auth/sessions/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossible de révoquer la session');
    }
  }

  async function requestAccountDeletion() {
    if (deleteReason.trim().length < 5) {
      setErrorMsg('Veuillez indiquer le motif de suppression (5+ caractères).');
      return;
    }
    setLoading(true);
    try {
      const res = await mobileApiRequest<{ message: string }>('/me/deletion-request', {
        method: 'POST',
        body: JSON.stringify({ reason: deleteReason.trim() }),
      });
      setFeedback(res.message);
      setDeleteReason('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur demande suppression');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await mobileApiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // ignore network failure during logout
    }
    await clearAuthTokens();
    onLogout();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Profil & Sécurité</Text>
      {errorMsg && <Text style={styles.errorBox}>{errorMsg}</Text>}
      {feedback && <Text style={styles.info}>{feedback}</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Informations personnelles</Text>
        <TextInput style={styles.input} placeholder="Prénom" value={firstName} onChangeText={setFirstName} />
        <TextInput style={styles.input} placeholder="Nom" value={lastName} onChangeText={setLastName} />
        <TextInput style={styles.input} placeholder="Ville" value={city} onChangeText={setCity} />
        <TextInput style={styles.input} placeholder="Profession" value={profession} onChangeText={setProfession} />
        <TouchableOpacity style={styles.primaryBtn} disabled={loading} onPress={saveProfile}>
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Enregistrer le profil</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Langue de l’application</Text>
        <View style={styles.langRow}>
          {(['fr', 'sw', 'en'] as const).map((l) => (
            <TouchableOpacity
              key={l}
              onPress={() => changeLanguage(l)}
              style={[styles.chip, language === l && styles.chipActive]}
            >
              <Text style={[styles.chipText, language === l && styles.chipTextActive]}>{l.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Déverrouillage rapide par empreinte Android</Text>
          <Switch value={bioEnabled} onValueChange={toggleBio} trackColor={{ true: VMicroTheme.colors.primary }} />
        </View>
        <View style={[styles.row, { marginTop: 10 }]}>
          <Text style={styles.label}>Alertes push & sécurité</Text>
          <Switch value={pushEnabled} onValueChange={(v) => updateNotifPref(v, loanUpdates)} trackColor={{ true: VMicroTheme.colors.primary }} />
        </View>
        <View style={[styles.row, { marginTop: 10 }]}>
          <Text style={styles.label}>Mises à jour dossiers de crédit</Text>
          <Switch value={loanUpdates} onValueChange={(v) => updateNotifPref(pushEnabled, v)} trackColor={{ true: VMicroTheme.colors.primary }} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sessions actives</Text>
        {sessions.slice(0, 4).map((s) => (
          <View key={s.id} style={styles.sessionRow}>
            <Text style={styles.sub}>
              {s.device_label} {s.id === currentSessionId ? '(Actuelle)' : s.revoked ? '(Révoquée)' : ''}
            </Text>
            {s.id !== currentSessionId && !s.revoked && (
              <TouchableOpacity onPress={() => revokeSession(s.id)}>
                <Text style={{ color: VMicroTheme.colors.primary, fontSize: 12, fontWeight: '600' }}>Révoquer</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Demande de suppression de compte</Text>
        <TextInput style={styles.input} placeholder="Motif de la demande" value={deleteReason} onChangeText={setDeleteReason} />
        <TouchableOpacity style={styles.logoutBtn} disabled={loading} onPress={requestAccountDeletion}>
          <Text style={styles.logoutText}>Soumettre la demande</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Déconnexion sécurisée</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: '#111111' },
  card: { padding: 16, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 14 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#111111', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sessionRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: VMicroTheme.colors.border },
  langRow: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 8 },
  chipActive: { backgroundColor: VMicroTheme.colors.primary, borderColor: VMicroTheme.colors.primary },
  chipText: { fontSize: 12, color: '#111111' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  label: { fontSize: 13, color: '#111111', flex: 1, paddingRight: 12 },
  sub: { fontSize: 12, color: VMicroTheme.colors.muted },
  input: { minHeight: 44, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 10, paddingHorizontal: 12, marginBottom: 10 },
  primaryBtn: { minHeight: 44, backgroundColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  logoutBtn: { minHeight: 46, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logoutText: { color: VMicroTheme.colors.primary, fontWeight: '600', fontSize: 14 },
  info: { padding: 10, borderWidth: 1, borderColor: VMicroTheme.colors.secondary, borderRadius: 8, fontSize: 12 },
  errorBox: { padding: 10, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 8, fontSize: 12, color: VMicroTheme.colors.primary },
});
