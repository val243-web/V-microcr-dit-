import React, { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { VMicroTheme } from './src/theme/tokens';
import { getAuthTokens } from './src/security/secureStorage';
import { AuthScreen } from './src/screens/AuthScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { SavingsScreen } from './src/screens/SavingsScreen';
import { CreditScreen } from './src/screens/CreditScreen';
import { KycMultimodalScreen } from './src/screens/KycMultimodalScreen';
import { AssistantScreen } from './src/screens/AssistantScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';

type TabName = 'Accueil' | 'Épargne' | 'Crédit' | 'KYC' | 'Assistant' | 'Profil';

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [tab, setTab] = useState<TabName>('Accueil');

  useEffect(() => {
    getAuthTokens().then(({ accessToken }) => {
      if (accessToken) setAuthenticated(true);
    });
  }, []);

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
        {tab === 'Profil' && <ProfileScreen onLogout={() => setAuthenticated(false)} />}
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
