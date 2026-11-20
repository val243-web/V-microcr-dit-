import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { VMicroTheme } from '../theme/tokens';
import { mobileApiRequest } from '../security/httpsClient';
import { saveAuthTokens, isBiometricUnlockEnabled, getAuthTokens } from '../security/secureStorage';
import { authenticateWithDeviceBiometrics } from '../security/biometricAuth';

interface AuthScreenProps {
  onAuthenticated: () => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [identifier, setIdentifier] = useState('grace.kabongo@vmicro.cd');
  const [password, setPassword] = useState('Password123!');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('+243');
  const [dob, setDob] = useState('1995-01-15');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      const res = await mobileApiRequest<{ accessToken: string; refreshToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier,
          password,
          deviceLabel: 'Android App V-Micro Crédit',
        }),
      });
      await saveAuthTokens(res.accessToken, res.refreshToken);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  }

  async function handleBiometricUnlock() {
    setError(null);
    const enabled = await isBiometricUnlockEnabled();
    const { refreshToken } = await getAuthTokens();
    if (!enabled || !refreshToken) {
      setError('Connectez-vous une première fois et activez le déverrouillage biométrique dans Profil.');
      return;
    }
    const bio = await authenticateWithDeviceBiometrics('Déverrouiller V-Micro Crédit');
    if (!bio.success) {
      setError(bio.error || 'Authentification annulée.');
      return;
    }
    onAuthenticated();
  }

  async function handleRegister() {
    setError(null);
    setLoading(true);
    try {
      const res = await mobileApiRequest<{ simulatedOtpPreview: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: identifier,
          phone,
          password,
          firstName,
          lastName,
          dateOfBirth: dob,
          city: 'Kinshasa',
          acceptDataConsent: true,
        }),
      });
      setNotice(`Compte créé. Code OTP simulé : ${res.simulatedOtpPreview}`);
      setMode('LOGIN');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur d’inscription');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.brand}>V-Micro Crédit</Text>
      <Text style={styles.slogan}>Épargner. Préparer. Avancer.</Text>
      <Text style={styles.notice}>HTTPS Strict · Mode Simulation RDC</Text>

      {error && <Text style={styles.errorBox}>{error}</Text>}
      {notice && <Text style={styles.infoBox}>{notice}</Text>}

      <View style={styles.card}>
        <Text style={styles.title}>{mode === 'LOGIN' ? 'Connexion sécurisée' : 'Ouvrir un compte'}</Text>

        {mode === 'REGISTER' && (
          <>
            <TextInput style={styles.input} placeholder="Prénom" value={firstName} onChangeText={setFirstName} />
            <TextInput style={styles.input} placeholder="Nom" value={lastName} onChangeText={setLastName} />
            <TextInput style={styles.input} placeholder="Téléphone (+243...)" value={phone} onChangeText={setPhone} />
            <TextInput style={styles.input} placeholder="Date naissance (AAAA-MM-JJ)" value={dob} onChangeText={setDob} />
          </>
        )}

        <TextInput
          style={styles.input}
          placeholder="E-mail ou téléphone"
          autoCapitalize="none"
          value={identifier}
          onChangeText={setIdentifier}
        />
        <TextInput
          style={styles.input}
          placeholder="Mot de passe"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity
          style={styles.primaryBtn}
          disabled={loading}
          onPress={mode === 'LOGIN' ? handleLogin : handleRegister}
        >
          <Text style={styles.primaryBtnText}>
            {loading ? 'Traitement...' : mode === 'LOGIN' ? 'Se connecter' : 'Créer mon compte'}
          </Text>
        </TouchableOpacity>

        {mode === 'LOGIN' && (
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleBiometricUnlock}>
            <Text style={styles.secondaryBtnText}>Déverrouiller par empreinte Android</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={() => setMode(mode === 'LOGIN' ? 'REGISTER' : 'LOGIN')} style={styles.linkBtn}>
          <Text style={styles.linkText}>
            {mode === 'LOGIN' ? 'Pas encore de compte ? S’inscrire' : 'Déjà inscrit ? Se connecter'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: VMicroTheme.colors.background },
  content: { padding: 20, paddingTop: 48 },
  brand: { fontSize: 26, fontWeight: '700', color: VMicroTheme.colors.primary },
  slogan: { fontSize: 14, color: VMicroTheme.colors.muted, marginBottom: 12 },
  notice: {
    fontSize: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: VMicroTheme.colors.secondary,
    borderRadius: 10,
    color: VMicroTheme.colors.text,
    marginBottom: 18,
  },
  card: {
    padding: 18,
    borderWidth: 1,
    borderColor: VMicroTheme.colors.border,
    borderRadius: 14,
    backgroundColor: VMicroTheme.colors.background,
  },
  title: { fontSize: 18, fontWeight: '700', color: VMicroTheme.colors.text, marginBottom: 14 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: VMicroTheme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    fontSize: 14,
    color: VMicroTheme.colors.text,
  },
  primaryBtn: {
    minHeight: 48,
    backgroundColor: VMicroTheme.colors.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  secondaryBtn: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: VMicroTheme.colors.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  secondaryBtnText: { color: VMicroTheme.colors.primary, fontWeight: '600', fontSize: 13 },
  linkBtn: { marginTop: 16, alignItems: 'center' },
  linkText: { color: VMicroTheme.colors.muted, fontSize: 13 },
  errorBox: {
    padding: 12,
    borderWidth: 1,
    borderColor: VMicroTheme.colors.primary,
    borderRadius: 10,
    color: VMicroTheme.colors.primary,
    marginBottom: 12,
    fontSize: 12,
  },
  infoBox: {
    padding: 12,
    borderWidth: 1,
    borderColor: VMicroTheme.colors.secondary,
    borderRadius: 10,
    color: VMicroTheme.colors.text,
    marginBottom: 12,
    fontSize: 12,
  },
});
