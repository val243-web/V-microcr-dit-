import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { VMicroTheme } from '../theme/tokens';
import { mobileApiRequest } from '../security/httpsClient';
import { saveAuthTokens, isBiometricUnlockEnabled, getAuthTokens } from '../security/secureStorage';
import { authenticateWithDeviceBiometrics } from '../security/biometricAuth';

interface AuthScreenProps {
  onAuthenticated: () => void;
}

type AuthMode = 'LOGIN' | 'REGISTER' | 'VERIFY_OTP' | 'FORGOT' | 'RESET';

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('LOGIN');
  const [identifier, setIdentifier] = useState('grace.kabongo@vmicro.cd');
  const [password, setPassword] = useState('Password123!');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('+243');
  const [dob, setDob] = useState('1995-01-15');
  const [city, setCity] = useState('Kinshasa');
  const [otpCode, setOtpCode] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!identifier.trim() || !password) {
      setError('Veuillez saisir votre identifiant et mot de passe.');
      return;
    }
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await mobileApiRequest<{ accessToken: string; refreshToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: identifier.trim(),
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
    if (!firstName.trim() || !lastName.trim() || phone.trim().length < 9 || !identifier.includes('@')) {
      setError('Veuillez remplir prénom, nom, e-mail valide et numéro +243...');
      return;
    }
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await mobileApiRequest<{ simulatedOtpPreview?: string; message: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: identifier.trim(),
          phone: phone.trim(),
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dateOfBirth: dob.trim(),
          city: city.trim() || 'Kinshasa',
          acceptDataConsent: true,
        }),
      });
      setNotice(
        res.simulatedOtpPreview
          ? `Compte créé. Code OTP de validation : ${res.simulatedOtpPreview}`
          : res.message
      );
      setMode('VERIFY_OTP');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur d’inscription');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (otpCode.trim().length < 4) {
      setError('Entrez le code OTP reçu.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await mobileApiRequest('/auth/verify-phone', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim(), otp: otpCode.trim() }),
      });
      setNotice('Numéro vérifié avec succès. Vous pouvez maintenant vous connecter.');
      setMode('LOGIN');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code OTP invalide');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot() {
    if (!identifier.trim()) {
      setError('Entrez votre e-mail ou téléphone.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await mobileApiRequest<{ message: string; simulatedResetCodePreview?: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      setNotice(
        res.simulatedResetCodePreview
          ? `Code de réinitialisation : ${res.simulatedResetCodePreview}`
          : res.message
      );
      setMode('RESET');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (resetCode.trim().length < 4 || newPassword.length < 8) {
      setError('Code valide et nouveau mot de passe (8+ caractères) requis.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await mobileApiRequest('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          identifier: identifier.trim(),
          resetCode: resetCode.trim(),
          newPassword,
        }),
      });
      setNotice('Mot de passe mis à jour. Connectez-vous avec votre nouveau mot de passe.');
      setPassword(newPassword);
      setMode('LOGIN');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de réinitialisation');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.brand}>V-Micro Crédit</Text>
      <Text style={styles.slogan}>Épargner. Préparer. Avancer.</Text>
      <Text style={styles.notice}>HTTPS Strict · Stockage chiffré Android</Text>

      {error && <Text style={styles.errorBox}>{error}</Text>}
      {notice && <Text style={styles.infoBox}>{notice}</Text>}

      <View style={styles.card}>
        <Text style={styles.title}>
          {mode === 'LOGIN' && 'Connexion sécurisée'}
          {mode === 'REGISTER' && 'Ouvrir un compte'}
          {mode === 'VERIFY_OTP' && 'Validation téléphone OTP'}
          {mode === 'FORGOT' && 'Mot de passe oublié'}
          {mode === 'RESET' && 'Nouveau mot de passe'}
        </Text>

        {mode === 'REGISTER' && (
          <>
            <TextInput style={styles.input} placeholder="Prénom" value={firstName} onChangeText={setFirstName} />
            <TextInput style={styles.input} placeholder="Nom" value={lastName} onChangeText={setLastName} />
            <TextInput style={styles.input} placeholder="Téléphone (+243...)" value={phone} onChangeText={setPhone} />
            <TextInput style={styles.input} placeholder="Ville (ex. Kinshasa)" value={city} onChangeText={setCity} />
            <TextInput style={styles.input} placeholder="Date naissance (AAAA-MM-JJ)" value={dob} onChangeText={setDob} />
          </>
        )}

        {(mode === 'LOGIN' || mode === 'REGISTER' || mode === 'FORGOT' || mode === 'RESET') && (
          <TextInput
            style={styles.input}
            placeholder={mode === 'REGISTER' ? 'E-mail' : 'E-mail ou téléphone'}
            autoCapitalize="none"
            value={identifier}
            onChangeText={setIdentifier}
          />
        )}

        {(mode === 'LOGIN' || mode === 'REGISTER') && (
          <TextInput
            style={styles.input}
            placeholder="Mot de passe"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        )}

        {mode === 'VERIFY_OTP' && (
          <>
            <TextInput style={styles.input} placeholder="Téléphone (+243...)" value={phone} onChangeText={setPhone} />
            <TextInput style={styles.input} placeholder="Code OTP à 6 chiffres" keyboardType="numeric" value={otpCode} onChangeText={setOtpCode} />
          </>
        )}

        {mode === 'RESET' && (
          <>
            <TextInput style={styles.input} placeholder="Code reçu à 6 chiffres" keyboardType="numeric" value={resetCode} onChangeText={setResetCode} />
            <TextInput style={styles.input} placeholder="Nouveau mot de passe (8+ car.)" secureTextEntry value={newPassword} onChangeText={setNewPassword} />
          </>
        )}

        <TouchableOpacity
          style={styles.primaryBtn}
          disabled={loading}
          onPress={() => {
            if (mode === 'LOGIN') handleLogin();
            else if (mode === 'REGISTER') handleRegister();
            else if (mode === 'VERIFY_OTP') handleVerifyOtp();
            else if (mode === 'FORGOT') handleForgot();
            else handleReset();
          }}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryBtnText}>
              {mode === 'LOGIN' && 'Se connecter'}
              {mode === 'REGISTER' && 'Créer mon compte'}
              {mode === 'VERIFY_OTP' && 'Valider mon numéro'}
              {mode === 'FORGOT' && 'Recevoir un code'}
              {mode === 'RESET' && 'Réinitialiser le mot de passe'}
            </Text>
          )}
        </TouchableOpacity>

        {mode === 'LOGIN' && (
          <>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleBiometricUnlock}>
              <Text style={styles.secondaryBtnText}>Déverrouiller par empreinte Android</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setError(null); setMode('FORGOT'); }} style={styles.linkBtn}>
              <Text style={styles.linkText}>Mot de passe oublié ?</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity
          onPress={() => {
            setError(null);
            setMode(mode === 'LOGIN' ? 'REGISTER' : 'LOGIN');
          }}
          style={styles.linkBtn}
        >
          <Text style={styles.linkText}>
            {mode === 'LOGIN' ? 'Pas encore de compte ? S’inscrire' : 'Retour à la connexion'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: VMicroTheme.colors.background },
  content: { padding: 20, paddingTop: 40 },
  brand: { fontSize: 26, fontWeight: '700', color: VMicroTheme.colors.primary },
  slogan: { fontSize: 14, color: VMicroTheme.colors.muted, marginBottom: 12 },
  notice: {
    fontSize: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: VMicroTheme.colors.secondary,
    borderRadius: 10,
    color: VMicroTheme.colors.text,
    marginBottom: 16,
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
  linkBtn: { marginTop: 14, alignItems: 'center' },
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
