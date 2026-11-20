import React, { useEffect, useState } from 'react';
import { HelpCircle, LogOut, MonitorSmartphone, Trash2 } from 'lucide-react';
import { apiRequest } from '../api/client';
import type { AuthUser, Language } from '../types/vmicro';

interface ProfileViewProps {
  user: AuthUser;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => void;
}

interface SessionRow {
  id: string;
  device_label: string;
  ip_address: string;
  revoked: number;
  created_at: string;
  last_used_at: string;
}

export function ProfileView({ user, language, onChangeLanguage, onUserUpdated, onLogout }: ProfileViewProps) {
  const [form, setForm] = useState({
    firstName: user.profile?.first_name || '',
    lastName: user.profile?.last_name || '',
    city: user.profile?.city || 'Kinshasa',
    commune: user.profile?.commune || '',
    profession: user.profile?.profession || '',
    monthlyIncomeUsd: String(user.profile?.monthly_income_usd || 0),
  });
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [deleteReason, setDeleteReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadSessions() {
    const res = await apiRequest<{ currentSessionId: string; sessions: SessionRow[] }>('/auth/sessions');
    setCurrentSessionId(res.currentSessionId);
    setSessions(res.sessions);
  }

  useEffect(() => {
    loadSessions();
  }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const res = await apiRequest<{ profile: AuthUser['profile'] }>('/me/profile', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          monthlyIncomeUsd: Number(form.monthlyIncomeUsd) || 0,
          language,
        }),
      });
      onUserUpdated({ ...user, profile: res.profile });
      setMessage('Profil mis à jour.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur mise à jour');
    }
  }

  async function handleLanguageSelect(lang: Language) {
    onChangeLanguage(lang);
    await apiRequest('/me/preferences', {
      method: 'PUT',
      body: JSON.stringify({ language: lang }),
    });
    setMessage(`Langue définie sur ${lang.toUpperCase()}.`);
  }

  async function handleRevokeSession(id: string) {
    await apiRequest(`/auth/sessions/${id}`, { method: 'DELETE' });
    await loadSessions();
  }

  async function handleRequestDeletion(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiRequest<{ message: string }>('/me/deletion-request', {
        method: 'POST',
        body: JSON.stringify({ reason: deleteReason }),
      });
      setMessage(res.message);
      setDeleteReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur demande de suppression');
    }
  }

  return (
    <div className="space-y-6">
      {error && <div className="p-3 rounded-lg border border-[#4F0000] bg-[#4F0000]/10 text-xs text-[#4F0000]">{error}</div>}
      {message && <div className="p-3 rounded-lg border border-[#87CEEB] bg-[#87CEEB]/20 text-xs text-[#111111]">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Identité & Profil */}
        <div className="lg:col-span-7 border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-5">
          <div className="flex items-center gap-4">
            <img
              src={user.profile?.avatar_url || '/src/assets/images/avatar_client_congo_1795184076161.jpg'}
              alt={`${form.firstName} ${form.lastName}`}
              referrerPolicy="no-referrer"
              className="w-14 h-14 rounded-full object-cover border border-[#E5E7EB]"
            />
            <div>
              <h2 className="font-display text-lg font-bold text-[#111111]">
                {form.firstName} {form.lastName}
              </h2>
              <p className="text-xs text-[#52525B]">
                {user.email} · {user.phone} · Rôle : {user.role}
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Prénom</label>
              <input
                type="text"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                className="w-full min-h-[42px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Nom</label>
              <input
                type="text"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                className="w-full min-h-[42px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Ville</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full min-h-[42px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Commune</label>
              <input
                type="text"
                value={form.commune}
                onChange={(e) => setForm({ ...form, commune: e.target.value })}
                className="w-full min-h-[42px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium mb-1">Activité / Profession</label>
              <input
                type="text"
                value={form.profession}
                onChange={(e) => setForm({ ...form, profession: e.target.value })}
                className="w-full min-h-[42px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button type="submit" className="min-h-[42px] px-5 bg-[#4F0000] text-white text-xs font-medium rounded-lg cursor-pointer">
                Enregistrer les modifications
              </button>
            </div>
          </form>
        </div>

        {/* Langue, Aide et Déconnexion */}
        <div className="lg:col-span-5 space-y-6">
          <div className="border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-3">
            <h3 className="font-display text-base font-semibold text-[#111111]">Langue de l’application</h3>
            <p className="text-xs text-[#52525B]">Français par défaut · Prise en charge Kiswahili et Anglais</p>
            <div className="grid grid-cols-3 gap-2 pt-1">
              {(
                [
                  ['fr', 'Français'],
                  ['sw', 'Kiswahili'],
                  ['en', 'English'],
                ] as Array<[Language, string]>
              ).map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => handleLanguageSelect(code)}
                  className={`min-h-[40px] px-3 text-xs font-medium rounded-lg border cursor-pointer ${
                    language === code
                      ? 'bg-[#4F0000] text-white border-[#4F0000]'
                      : 'bg-white text-[#111111] border-[#E5E7EB]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-3">
            <div className="flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-[#4F0000]" />
              <h3 className="font-display text-base font-semibold">Centre d’aide & Confidentialité</h3>
            </div>
            <p className="text-xs text-[#52525B] leading-relaxed">
              Support client RDC : support@vmicro.cd · Kinshasa, Avenue de la Gombe. Les données biométriques brutes ne sont jamais conservées sur nos serveurs.
            </p>
            <button
              type="button"
              onClick={onLogout}
              className="w-full min-h-[42px] border border-[#4F0000] text-[#4F0000] text-xs font-medium rounded-lg inline-flex items-center justify-center gap-2 hover:bg-[#4F0000]/5 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Se déconnecter de cette session
            </button>
          </div>
        </div>
      </div>

      {/* Sessions actives */}
      <div className="border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4">
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="w-4 h-4 text-[#4F0000]" />
          <h3 className="font-display text-base font-semibold text-[#111111]">Sécurité & Sessions actives</h3>
        </div>
        <div className="divide-y divide-[#E5E7EB] text-xs">
          {sessions.map((s) => (
            <div key={s.id} className="py-3 flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-[#111111]">
                  {s.device_label} {s.id === currentSessionId ? '(Session actuelle)' : ''}
                </p>
                <p className="text-[#52525B] font-mono-tabular">
                  IP : {s.ip_address} · Créée le {s.created_at.slice(0, 16).replace('T', ' ')} ·{' '}
                  {s.revoked === 1 ? 'Révoquée' : 'Active'}
                </p>
              </div>
              {s.revoked === 0 && s.id !== currentSessionId && (
                <button
                  type="button"
                  onClick={() => handleRevokeSession(s.id)}
                  className="px-3 py-1.5 border border-[#4F0000] text-[#4F0000] rounded text-xs cursor-pointer"
                >
                  Révoquer
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Suppression de compte */}
      <form onSubmit={handleRequestDeletion} className="border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-3">
        <div className="flex items-center gap-2 text-[#4F0000]">
          <Trash2 className="w-4 h-4" />
          <h3 className="font-display text-base font-semibold">Demande de suppression de compte</h3>
        </div>
        <p className="text-xs text-[#52525B]">
          Conformément aux règles applicables aux services financiers, les dossiers avec crédits actifs doivent être soldés avant clôture définitive.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            required
            minLength={5}
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            placeholder="Motif de la demande..."
            className="flex-1 min-h-[42px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
          />
          <button
            type="submit"
            className="min-h-[42px] px-4 border border-[#4F0000] text-[#4F0000] text-xs font-medium rounded-lg cursor-pointer whitespace-nowrap"
          >
            Soumettre la demande
          </button>
        </div>
      </form>
    </div>
  );
}
