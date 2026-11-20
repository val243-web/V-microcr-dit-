import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { VMicroTheme } from './src/theme/tokens';
import { clearAuthTokens, getAuthTokens, isBiometricUnlockEnabled } from './src/security/secureStorage';
import { authenticateWithDeviceBiometrics } from './src/security/biometricAuth';
import { setOnSessionExpired } from './src/security/httpsClient';
import { AuthScreen } from './src/screens/AuthScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { SavingsScreen } from './src/screens/SavingsScreen';
import { CreditScreen } from './src/screens/CreditScreen';
import { KycMultimodalScreen } from './src/screens/KycMultimodalScreen';
import { AssistantScreen } from './src/screens/AssistantScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';

type TabName = 'Accueil' | 'Épargne' | 'Crédit' | 'KYC' | 'Assistant' | 'Profil';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [lockedByBiometric, setLockedByBiometric] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabName>('Accueil');

  async function runStartupCheck() {
    setBooting(true);
    try {
      const [{ accessToken, refreshToken }, bioEnabled] = await Promise.all([
        getAuthTokens(),
        isBiometricUnlockEnabled(),
      ]);

      if (!accessToken && !refreshToken) {
        setAuthenticated(false);
        setLockedByBiometric(false);
        return;
      }

      if (bioEnabled) {
        setLockedByBiometric(true);
        const bio = await authenticateWithDeviceBiometrics('Déverrouiller V-Micro Crédit');
        if (bio.success) {
          setLockedByBiometric(false);
          setAuthenticated(true);
        } else {
          setLockError(bio.error || 'Déverrouillage biométrique requis.');
        }
      } else {
        setAuthenticated(true);
      }
    } finally {
      setBooting(false);
    }
  }

  useEffect(() => {
    setOnSessionExpired(() => {
      setAuthenticated(false);
      setLockedByBiometric(false);
      setTab('Accueil');
    });
    runStartupCheck();
    return () => setOnSessionExpired(null);
  }, []);

  if (booting) {
    return (
      <SafeAreaView style={styles.centerRoot}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={VMicroTheme.colors.primary} />
        <Text style={styles.bootText}>V-Micro Crédit · Sécurité HTTPS...</Text>
      </SafeAreaView>
    );
  }

  if (lockedByBiometric) {
    return (
      <SafeAreaView style={styles.centerRoot}>
        <StatusBar style="dark" />
        <Text style={styles.lockTitle}>V-Micro Crédit verrouillé</Text>
        <Text style={styles.lockSub}>Confirmez votre empreinte Android pour accéder à vos comptes.</Text>
        {lockError && <Text style={styles.lockError}>{lockError}</Text>}
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={async () => {
            setLockError(null);
            const bio = await authenticateWithDeviceBiometrics('Déverrouiller V-Micro Crédit');
            if (bio.success) {
              setLockedByBiometric(false);
              setAuthenticated(true);
            } else {
              setLockError(bio.error || 'Échec du déverrouillage.');
            }
          }}
        >
          <Text style={styles.primaryBtnText}>Déverrouiller par empreinte</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkBtn}
          onPress={async () => {
            await clearAuthTokens();
            setLockedByBiometric(false);
            setAuthenticated(false);
          }}
        >
          <Text style={styles.linkText}>Utiliser mon mot de passe</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!authenticated) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <AuthScreen onAuthenticated={() => setAuthenticated(true)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.body}>
        {tab === 'Accueil' && <DashboardScreen onNavigate={(t) => setTab(t as TabName)} />}
        {tab === 'Épargne' && <SavingsScreen />}
        {tab === 'Crédit' && <CreditScreen />}
        {tab === 'KYC' && <KycMultimodalScreen />}
        {tab === 'Assistant' && <AssistantScreen />}
        {tab === 'Profil' && (
          <ProfileScreen
            onLogout={() => {
              setAuthenticated(false);
              setTab('Accueil');
            }}
          />
        )}
      </View>
      <View style={styles.tabBar}>
        {(['Accueil', 'Épargne', 'Crédit', 'KYC', 'Assistant', 'Profil'] as TabName[]).map((item) => (
          <TouchableOpacity key={item} onPress={() => setTab(item)} style={styles.tabItem}>
            <Text style={[styles.tabLabel, tab === item && styles.tabLabelActive]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  centerRoot: { flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', padding: 24 },
  bootText: { marginTop: 12, fontSize: 13, color: VMicroTheme.colors.muted },
  lockTitle: { fontSize: 20, fontWeight: '700', color: VMicroTheme.colors.primary, marginBottom: 8 },
  lockSub: { fontSize: 13, color: VMicroTheme.colors.muted, textAlign: 'center', marginBottom: 18 },
  lockError: { fontSize: 12, color: VMicroTheme.colors.primary, marginBottom: 12, textAlign: 'center' },
  primaryBtn: { minHeight: 46, paddingHorizontal: 22, backgroundColor: VMicroTheme.colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  linkBtn: { marginTop: 16, padding: 8 },
  linkText: { color: VMicroTheme.colors.muted, fontSize: 13 },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: VMicroTheme.colors.border,
    backgroundColor: '#FFFFFF',
    height: 58,
    alignItems: 'center',
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  tabLabel: { fontSize: 11, color: VMicroTheme.colors.muted },
  tabLabelActive: { color: VMicroTheme.colors.primary, fontWeight: '700' },
});
