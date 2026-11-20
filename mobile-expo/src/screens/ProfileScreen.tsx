import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { VMicroTheme } from '../theme/tokens';
import { clearAuthTokens, isBiometricUnlockEnabled, setBiometricUnlockEnabled } from '../security/secureStorage';
import { mobileApiRequest } from '../security/httpsClient';

export function ProfileScreen({ onLogout }: { onLogout: () => void }) {
  const [bioEnabled, setBioEnabled] = useState(false);

  useEffect(() => {
    isBiometricUnlockEnabled().then(setBioEnabled);
  }, []);

  async function toggleBio(val: boolean) {
    setBioEnabled(val);
    await setBiometricUnlockEnabled(val);
  }

  async function handleLogout() {
    try {
      await mobileApiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    await clearAuthTokens();
    onLogout();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Profil & Sécurité</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Déverrouillage rapide par empreinte Android</Text>
          <Switch value={bioEnabled} onValueChange={toggleBio} trackColor={{ true: VMicroTheme.colors.primary }} />
        </View>
      </View>
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Déconnexion sécurisée</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { padding: 16, gap: 14 },
  title: { fontSize: 22, fontWeight: '700', color: '#111111' },
  card: { padding: 16, borderWidth: 1, borderColor: VMicroTheme.colors.border, borderRadius: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 13, color: '#111111', flex: 1, paddingRight: 12 },
  logoutBtn: { minHeight: 46, borderWidth: 1, borderColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logoutText: { color: VMicroTheme.colors.primary, fontWeight: '600', fontSize: 14 },
});
