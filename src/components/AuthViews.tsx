import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Lock, ShieldCheck, Smartphone, UserCheck } from 'lucide-react';
import { apiRequest, setStoredTokens } from '../api/client';
import type { AuthUser, Language } from '../types/vmicro';

interface AuthViewsProps {
  onAuthenticated: (user: AuthUser) => void;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
}

type AuthScreen = 'ONBOARDING' | 'LOGIN' | 'REGISTER' | 'VERIFY_PHONE' | 'FORGOT' | 'RESET';

export function AuthViews({ onAuthenticated, language, onChangeLanguage }: AuthViewsProps) {
  const [screen, setScreen] = useState<AuthScreen>('ONBOARDING');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Login state
  const [identifier, setIdentifier] = useState('grace.kabongo@vmicro.cd');
  const [password, setPassword] = useState('Password123!');

  // Register state
  const [regForm, setRegForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '+243',
    dateOfBirth: '1995-01-15',
    city: 'Kinshasa',
    commune: 'Gombe',
    profession: '',
    monthlyIncomeUsd: '350',
    password: '',
    acceptDataConsent: false,
  });

  // Phone verification state
  const [verifyPhone, setVerifyPhone] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpPreview, setOtpPreview] = useState<string | null>(null);

  // Forgot/Reset state
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPass, setResetNewPass] = useState('');
  const [resetPreview, setResetPreview] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent, overrideId?: string, overridePw?: string) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        accessToken: string;
        refreshToken: string;
        user: AuthUser;
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: overrideId ?? identifier,
          password: overridePw ?? password,
          deviceLabel: navigator.userAgent.includes('Mobile') ? 'Mobile Web RDC' : 'Navigateur Bureau',
        }),
      });
      setStoredTokens(res.accessToken, res.refreshToken);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        phone: string;
        simulatedOtpPreview: string;
        message: string;
      }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          ...regForm,
          monthlyIncomeUsd: Number(regForm.monthlyIncomeUsd) || 0,
          language,
        }),
      });
      setVerifyPhone(res.phone);
      setOtpPreview(res.simulatedOtpPreview);
      setOtpInput(res.simulatedOtpPreview);
      setNotice(res.message);
      setScreen('VERIFY_PHONE');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l’inscription');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string }>('/auth/verify-phone', {
        method: 'POST',
        body: JSON.stringify({ phone: verifyPhone, otp: otpInput }),
      });
      setNotice(res.message + ' Vous pouvez maintenant vous connecter.');
      setIdentifier(verifyPhone);
      setPassword(regForm.password);
      setScreen('LOGIN');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code OTP invalide');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string; simulatedResetCodePreview?: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: resetEmail }),
      });
      setNotice(res.message);
      if (res.simulatedResetCodePreview) {
        setResetPreview(res.simulatedResetCodePreview);
        setResetCode(res.simulatedResetCodePreview);
      }
      setScreen('RESET');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: resetEmail, code: resetCode, newPassword: resetNewPass }),
      });
      setNotice(res.message);
      setScreen('LOGIN');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de réinitialisation');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-[#111111] flex flex-col">
      {/* Top Bar Contract: 3 clean zones */}
      <header className="border-b border-[#E5E7EB] bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setScreen('ONBOARDING')}
            className="font-display text-lg font-bold tracking-tight text-[#4F0000] whitespace-nowrap shrink-0 cursor-pointer"
          >
            V-Micro Crédit
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm text-[#52525B]">
            <button
              type="button"
              onClick={() => setScreen('ONBOARDING')}
              className="hover:text-[#111111] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Services
            </button>
            <button
              type="button"
              onClick={() => setScreen('REGISTER')}
              className="hover:text-[#111111] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Ouvrir un compte
            </button>
            <div className="flex items-center gap-2 border-l border-[#E5E7EB] pl-4">
              {(['fr', 'sw', 'en'] as Language[]).map((lng) => (
                <button
                  key={lng}
                  type="button"
                  onClick={() => onChangeLanguage(lng)}
                  className={`px-2 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap shrink-0 ${
                    language === lng ? 'bg-[#4F0000] text-white' : 'text-[#52525B] hover:text-[#111111]'
                  }`}
                >
                  {lng.toUpperCase()}
                </button>
              ))}
            </div>
          </nav>

          <button
            type="button"
            onClick={() => setScreen('LOGIN')}
            className="px-4 py-2 text-sm font-medium bg-[#4F0000] text-white rounded-lg hover:bg-[#3B0000] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Se connecter
          </button>
        </div>
      </header>

      {/* Notice Simulation */}
      <div className="bg-[#F8F8F9] border-b border-[#E5E7EB] px-4 py-2 text-center text-xs text-[#52525B]">
        Prototype logiciel — Mode Simulation actif · RDC (Kinshasa / Lubumbashi / Goma) · Aucune opération financière réelle
      </div>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {screen === 'ONBOARDING' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-7 flex flex-col justify-between space-y-8">
              <div className="space-y-5">
                <p className="text-xs font-medium tracking-wide text-[#4F0000]">
                  Inclusion financière · République démocratique du Congo
                </p>
                <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-[#111111] leading-[1.12] [text-wrap:balance]">
                  Épargner. Préparer. Avancer.
                </h1>
                <p className="text-base sm:text-lg text-[#52525B] max-w-2xl leading-relaxed">
                  V-Micro Crédit réunit épargne par objectifs, microcrédit responsable avec évaluation explicable, paiements Mobile Money (en simulation) et accompagnement par l’Assistant V-Micro.
                </p>
              </div>

              {/* 3 Services clés sans surcharge ni dégradé */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 border border-[#E5E7EB] rounded-xl bg-white">
                  <Smartphone className="w-5 h-5 text-[#4F0000] mb-3" />
                  <h3 className="font-display font-semibold text-sm text-[#111111]">Épargne & Objectifs</h3>
                  <p className="text-xs text-[#52525B] mt-1 leading-relaxed">
                    Épargne libre et cagnottes dédiées avec suivi visuel et dépôts Mobile Money simulés.
                  </p>
                </div>
                <div className="p-4 border border-[#E5E7EB] rounded-xl bg-white">
                  <ShieldCheck className="w-5 h-5 text-[#4F0000] mb-3" />
                  <h3 className="font-display font-semibold text-sm text-[#111111]">Crédit Explicable</h3>
                  <p className="text-xs text-[#52525B] mt-1 leading-relaxed">
                    Simulation d’échéancier claire, score transparent et validation humaine autorisée.
                  </p>
                </div>
                <div className="p-4 border border-[#E5E7EB] rounded-xl bg-white">
                  <UserCheck className="w-5 h-5 text-[#4F0000] mb-3" />
                  <h3 className="font-display font-semibold text-sm text-[#111111]">Identité Protégée</h3>
                  <p className="text-xs text-[#52525B] mt-1 leading-relaxed">
                    Consentement révocable, adaptateur Halisi et parcours alternatif sans discrimination matérielle.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setScreen('LOGIN')}
                  className="min-h-[44px] px-6 py-3 bg-[#4F0000] text-white text-sm font-medium rounded-lg hover:bg-[#3B0000] transition-colors inline-flex items-center gap-2 cursor-pointer"
                >
                  Accéder à l’application
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setScreen('REGISTER')}
                  className="min-h-[44px] px-6 py-3 bg-white text-[#111111] border border-[#E5E7EB] text-sm font-medium rounded-lg hover:bg-[#F8F8F9] transition-colors cursor-pointer"
                >
                  Créer un compte client
                </button>
              </div>
            </div>

            <div className="lg:col-span-5 flex flex-col">
              <div className="border border-[#E5E7EB] rounded-2xl overflow-hidden bg-[#F8F8F9] flex-1 flex flex-col">
                <img
                  src="/src/assets/images/onboarding_microfinance_editorial_1795184075892.jpg"
                  alt="Illustration éditoriale du commerce urbain et de la microfinance à Kinshasa"
                  referrerPolicy="no-referrer"
                  className="w-full h-64 lg:h-full object-cover"
                />
                <div className="p-4 bg-white border-t border-[#E5E7EB] flex items-center justify-between text-xs text-[#52525B]">
                  <span>Kinshasa · Lubumbashi · Goma</span>
                  <span className="text-[#4F0000] font-medium">USD / Mobile Money RDC</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {screen === 'LOGIN' && (
          <div className="max-w-lg mx-auto border border-[#E5E7EB] rounded-2xl p-6 sm:p-8 bg-white">
            <h2 className="font-display text-2xl font-bold text-[#111111]">Connexion sécurisée</h2>
            <p className="text-sm text-[#52525B] mt-1">Accédez à votre espace client ou à la console d’administration.</p>

            {notice && (
              <div className="mt-4 p-3 rounded-lg bg-[#87CEEB]/20 border border-[#87CEEB] text-xs text-[#111111]">
                {notice}
              </div>
            )}
            {error && (
              <div className="mt-4 p-3 rounded-lg bg-[#4F0000]/10 border border-[#4F0000] text-xs text-[#4F0000]">
                {error}
              </div>
            )}

            <form onSubmit={(e) => handleLogin(e)} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#111111] mb-1.5">E-mail ou numéro de téléphone</label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#4F0000]"
                  placeholder="grace.kabongo@vmicro.cd"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#111111] mb-1.5">Mot de passe</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#4F0000]"
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => setScreen('FORGOT')}
                  className="text-[#4F0000] hover:underline cursor-pointer"
                >
                  Mot de passe oublié ?
                </button>
                <button
                  type="button"
                  onClick={() => setScreen('REGISTER')}
                  className="text-[#52525B] hover:text-[#111111] cursor-pointer"
                >
                  Créer un compte
                </button>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] bg-[#4F0000] text-white text-sm font-medium rounded-lg hover:bg-[#3B0000] transition-colors disabled:opacity-60 cursor-pointer"
              >
                {loading ? 'Connexion en cours...' : 'Se connecter'}
              </button>
            </form>

            {/* Accès rapide de démonstration pour tester tous les rôles */}
            <div className="mt-6 pt-5 border-t border-[#E5E7EB]">
              <p className="text-xs font-medium text-[#52525B] mb-3">Comptes de démonstration (données fictives)</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Client (Grâce)', email: 'grace.kabongo@vmicro.cd', pw: 'Password123!' },
                  { label: 'Super Admin', email: 'admin@vmicro.cd', pw: 'Admin123!' },
                  { label: 'Agent Crédit', email: 'credit.agent@vmicro.cd', pw: 'Agent123!' },
                  { label: 'Auditeur', email: 'auditor@vmicro.cd', pw: 'Audit123!' },
                ].map((demo) => (
                  <button
                    key={demo.email}
                    type="button"
                    onClick={(e) => {
                      setIdentifier(demo.email);
                      setPassword(demo.pw);
                      handleLogin(e, demo.email, demo.pw);
                    }}
                    className="px-3 py-2 text-xs text-left border border-[#E5E7EB] rounded-lg hover:border-[#4F0000] hover:bg-[#F8F8F9] transition-colors cursor-pointer"
                  >
                    <div className="font-medium text-[#111111]">{demo.label}</div>
                    <div className="text-[11px] text-[#52525B] truncate">{demo.email}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {screen === 'REGISTER' && (
          <div className="max-w-2xl mx-auto border border-[#E5E7EB] rounded-2xl p-6 sm:p-8 bg-white">
            <h2 className="font-display text-2xl font-bold text-[#111111]">Création de compte client</h2>
            <p className="text-sm text-[#52525B] mt-1">
              Renseignez vos informations personnelles. Âge minimum réglementaire : 18 ans.
            </p>

            {error && (
              <div className="mt-4 p-3 rounded-lg bg-[#4F0000]/10 border border-[#4F0000] text-xs text-[#4F0000]">
                {error}
              </div>
            )}

            <form onSubmit={handleRegister} className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Prénom</label>
                <input
                  type="text"
                  required
                  value={regForm.firstName}
                  onChange={(e) => setRegForm({ ...regForm, firstName: e.target.value })}
                  className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Nom</label>
                <input
                  type="text"
                  required
                  value={regForm.lastName}
                  onChange={(e) => setRegForm({ ...regForm, lastName: e.target.value })}
                  className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Adresse e-mail</label>
                <input
                  type="email"
                  required
                  value={regForm.email}
                  onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                  className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Téléphone RDC (+243...)</label>
                <input
                  type="tel"
                  required
                  value={regForm.phone}
                  onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })}
                  className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Date de naissance</label>
                <input
                  type="date"
                  required
                  value={regForm.dateOfBirth}
                  onChange={(e) => setRegForm({ ...regForm, dateOfBirth: e.target.value })}
                  className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Ville</label>
                <select
                  value={regForm.city}
                  onChange={(e) => setRegForm({ ...regForm, city: e.target.value })}
                  className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg bg-white"
                >
                  <option value="Kinshasa">Kinshasa</option>
                  <option value="Lubumbashi">Lubumbashi</option>
                  <option value="Goma">Goma</option>
                  <option value="Matadi">Matadi</option>
                  <option value="Kisangani">Kisangani</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Commune / Quartier</label>
                <input
                  type="text"
                  value={regForm.commune}
                  onChange={(e) => setRegForm({ ...regForm, commune: e.target.value })}
                  className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Activité professionnelle</label>
                <input
                  type="text"
                  value={regForm.profession}
                  onChange={(e) => setRegForm({ ...regForm, profession: e.target.value })}
                  className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Mot de passe (8 caractères min.)</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={regForm.password}
                  onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                  className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-start gap-3 p-3 border border-[#E5E7EB] rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={regForm.acceptDataConsent}
                    onChange={(e) => setRegForm({ ...regForm, acceptDataConsent: e.target.checked })}
                    className="mt-1 accent-[#4F0000]"
                  />
                  <span className="text-xs text-[#52525B] leading-relaxed">
                    J’accepte le traitement sécurisé de mes données personnelles dans cet environnement de démonstration V-Micro Crédit et je comprends que les services financiers présentés sont simulés.
                  </span>
                </label>
              </div>
              <div className="sm:col-span-2 flex items-center justify-between gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => setScreen('LOGIN')}
                  className="text-sm text-[#52525B] hover:text-[#111111] cursor-pointer"
                >
                  Déjà inscrit ? Se connecter
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="min-h-[44px] px-6 bg-[#4F0000] text-white text-sm font-medium rounded-lg hover:bg-[#3B0000] cursor-pointer"
                >
                  {loading ? 'Création...' : 'Créer mon compte'}
                </button>
              </div>
            </form>
          </div>
        )}

        {screen === 'VERIFY_PHONE' && (
          <div className="max-w-md mx-auto border border-[#E5E7EB] rounded-2xl p-6 sm:p-8 bg-white">
            <CheckCircle2 className="w-8 h-8 text-[#4F0000] mb-3" />
            <h2 className="font-display text-xl font-bold">Vérification du numéro</h2>
            <p className="text-sm text-[#52525B] mt-1">
              Saisissez le code à 6 chiffres envoyé au <span className="font-mono-tabular font-medium text-[#111111]">{verifyPhone}</span>.
            </p>
            {otpPreview && (
              <div className="mt-4 p-3 rounded-lg bg-[#87CEEB]/20 border border-[#87CEEB] text-xs text-[#111111]">
                Mode Simulation SMS — Code généré : <strong className="font-mono-tabular">{otpPreview}</strong>
              </div>
            )}
            {error && <div className="mt-4 p-3 rounded-lg bg-[#4F0000]/10 text-xs text-[#4F0000]">{error}</div>}
            <form onSubmit={handleVerifyOtp} className="mt-5 space-y-4">
              <input
                type="text"
                maxLength={6}
                required
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value)}
                className="w-full min-h-[44px] px-4 text-center text-lg tracking-widest font-mono-tabular border border-[#E5E7EB] rounded-lg"
                placeholder="000000"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] bg-[#4F0000] text-white text-sm font-medium rounded-lg cursor-pointer"
              >
                Valider le numéro
              </button>
            </form>
          </div>
        )}

        {screen === 'FORGOT' && (
          <div className="max-w-md mx-auto border border-[#E5E7EB] rounded-2xl p-6 sm:p-8 bg-white">
            <Lock className="w-7 h-7 text-[#4F0000] mb-3" />
            <h2 className="font-display text-xl font-bold">Mot de passe oublié</h2>
            <p className="text-sm text-[#52525B] mt-1">Recevez un code de réinitialisation sécurisé.</p>
            {error && <div className="mt-4 p-3 rounded-lg bg-[#4F0000]/10 text-xs text-[#4F0000]">{error}</div>}
            <form onSubmit={handleForgot} className="mt-5 space-y-4">
              <input
                type="email"
                required
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="Votre adresse e-mail"
                className="w-full min-h-[44px] px-3.5 text-sm border border-[#E5E7EB] rounded-lg"
              />
              <button type="submit" className="w-full min-h-[44px] bg-[#4F0000] text-white text-sm font-medium rounded-lg cursor-pointer">
                Envoyer le code
              </button>
              <button type="button" onClick={() => setScreen('LOGIN')} className="w-full text-xs text-[#52525B] hover:underline cursor-pointer">
                Retour à la connexion
              </button>
            </form>
          </div>
        )}

        {screen === 'RESET' && (
          <div className="max-w-md mx-auto border border-[#E5E7EB] rounded-2xl p-6 sm:p-8 bg-white">
            <h2 className="font-display text-xl font-bold">Réinitialisation</h2>
            {resetPreview && (
              <div className="mt-3 p-3 rounded-lg bg-[#87CEEB]/20 border border-[#87CEEB] text-xs">
                Code de réinitialisation simulé : <strong className="font-mono-tabular">{resetPreview}</strong>
              </div>
            )}
            {error && <div className="mt-4 p-3 rounded-lg bg-[#4F0000]/10 text-xs text-[#4F0000]">{error}</div>}
            <form onSubmit={handleReset} className="mt-5 space-y-4">
              <input
                type="text"
                required
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                placeholder="Code reçu"
                className="w-full min-h-[44px] px-3.5 text-sm border border-[#E5E7EB] rounded-lg font-mono-tabular"
              />
              <input
                type="password"
                required
                minLength={8}
                value={resetNewPass}
                onChange={(e) => setResetNewPass(e.target.value)}
                placeholder="Nouveau mot de passe (min. 8 car.)"
                className="w-full min-h-[44px] px-3.5 text-sm border border-[#E5E7EB] rounded-lg"
              />
              <button type="submit" className="w-full min-h-[44px] bg-[#4F0000] text-white text-sm font-medium rounded-lg cursor-pointer">
                Confirmer le nouveau mot de passe
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
