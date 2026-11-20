import React, { useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  FileCheck2,
  ScrollText,
  Settings,
  Shield,
  Users,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import type { AuthUser, LoanApplication, SolvencyFactor, UserRole } from '../types/vmicro';

type AdminTab = 'overview' | 'loans' | 'users' | 'transactions' | 'notifications' | 'providers' | 'audit';

interface AdminOverview {
  kpis: {
    totalUsers: number;
    verifiedUsers: number;
    totalLoanApps: number;
    pendingLoans: number;
    approvedLoans: number;
    totalSavings: number;
    totalDisbursed: number;
    totalRepaid: number;
    simulatedTxCount: number;
    realTxCount: number;
  };
}

interface AdminUserRow {
  id: string;
  email: string;
  phone: string;
  role: UserRole;
  status: string;
  first_name: string;
  last_name: string;
  city: string;
  kyc_status: string;
}

interface AuditLogRow {
  id: string;
  actor_email: string | null;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata_json: string;
  created_at: string;
}

interface ProviderRow {
  id: string;
  name: string;
  category: string;
  mode: string;
  enabled: number;
}

interface IntegrationErrorRow {
  id: string;
  provider: string;
  endpoint: string;
  error_code: string;
  message: string;
  resolved: number;
  created_at: string;
}

export function AdminConsoleView({ currentUser }: { currentUser: AuthUser }) {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loans, setLoans] = useState<LoanApplication[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [transactions, setTransactions] = useState<Array<Record<string, unknown>>>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [integrationErrors, setIntegrationErrors] = useState<IntegrationErrorRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Loan human review state
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  // Broadcast state
  const [broadcast, setBroadcast] = useState({ title: '', message: '', category: 'FINANCIAL_TIP' });

  const perms = new Set(currentUser.permissions);

  async function loadTab(activeTab: AdminTab) {
    setError(null);
    try {
      if (activeTab === 'overview') {
        const res = await apiRequest<AdminOverview>('/admin/overview');
        setOverview(res);
      } else if (activeTab === 'loans' && perms.has('ADMIN_REVIEW_LOANS')) {
        const res = await apiRequest<{ loans: LoanApplication[] }>('/admin/loans');
        setLoans(res.loans);
      } else if (activeTab === 'users' && perms.has('ADMIN_MANAGE_USERS')) {
        const res = await apiRequest<{ users: AdminUserRow[] }>('/admin/users');
        setUsers(res.users);
      } else if (activeTab === 'transactions') {
        const res = await apiRequest<{ transactions: Array<Record<string, unknown>> }>('/admin/transactions');
        setTransactions(res.transactions);
      } else if (activeTab === 'audit' && perms.has('ADMIN_VIEW_AUDIT')) {
        const res = await apiRequest<{ logs: AuditLogRow[] }>('/admin/audit-logs');
        setAuditLogs(res.logs);
      } else if (activeTab === 'providers') {
        const res = await apiRequest<{ providers: ProviderRow[]; errors: IntegrationErrorRow[] }>('/admin/providers');
        setProviders(res.providers);
        setIntegrationErrors(res.errors);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accès non autorisé ou erreur serveur');
    }
  }

  useEffect(() => {
    loadTab(tab);
  }, [tab]);

  async function handleLoanDecision(loanId: string, decision: 'APPROVED' | 'REJECTED' | 'COMPLEMENT_REQUIRED') {
    setError(null);
    setFeedback(null);
    const note = reviewNotes[loanId] || '';
    try {
      await apiRequest(`/admin/loans/${loanId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, note }),
      });
      setFeedback(`Décision ${decision} enregistrée et journalisée pour ${loanId}.`);
      await loadTab('loans');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur décision crédit');
    }
  }

  async function handleKycVerify(userId: string, status: 'VERIFIED' | 'FAILED') {
    setError(null);
    setFeedback(null);
    try {
      await apiRequest(`/admin/users/${userId}/kyc`, {
        method: 'PUT',
        body: JSON.stringify({
          status,
          note: status === 'VERIFIED' ? 'Identité validée par agent habilité' : 'Document illisible, reprise requise',
        }),
      });
      setFeedback(`Statut KYC mis à jour (${status}).`);
      await loadTab('users');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur validation KYC');
    }
  }

  async function handleRoleChange(userId: string, role: UserRole) {
    setError(null);
    setFeedback(null);
    try {
      await apiRequest(`/admin/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      setFeedback(`Rôle mis à jour vers ${role}.`);
      await loadTab('users');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur modification rôle');
    }
  }

  async function handleToggleProvider(p: ProviderRow) {
    setError(null);
    try {
      await apiRequest(`/admin/providers/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: p.enabled !== 1 }),
      });
      await loadTab('providers');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur configuration fournisseur');
    }
  }

  async function handleSendBroadcast(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    try {
      const res = await apiRequest<{ sentCount: number }>('/admin/notifications/broadcast', {
        method: 'POST',
        body: JSON.stringify(broadcast),
      });
      setFeedback(`Notification diffusée à ${res.sentCount} clients actifs.`);
      setBroadcast({ title: '', message: '', category: 'FINANCIAL_TIP' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur diffusion');
    }
  }

  const navItems: Array<{ id: AdminTab; label: string; icon: React.ReactNode; visible: boolean }> = [
    { id: 'overview', label: 'Vue globale', icon: <Activity className="w-4 h-4" />, visible: perms.has('ADMIN_VIEW_OVERVIEW') },
    { id: 'loans', label: 'Dossiers crédit', icon: <FileCheck2 className="w-4 h-4" />, visible: perms.has('ADMIN_REVIEW_LOANS') },
    { id: 'users', label: 'Utilisateurs & Rôles', icon: <Users className="w-4 h-4" />, visible: perms.has('ADMIN_MANAGE_USERS') },
    { id: 'transactions', label: 'Transactions', icon: <Shield className="w-4 h-4" />, visible: perms.has('ADMIN_VIEW_OVERVIEW') },
    { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" />, visible: perms.has('ADMIN_SEND_NOTIFICATIONS') },
    { id: 'providers', label: 'Fournisseurs', icon: <Settings className="w-4 h-4" />, visible: perms.has('ADMIN_VIEW_OVERVIEW') },
    { id: 'audit', label: 'Journaux d’audit', icon: <ScrollText className="w-4 h-4" />, visible: perms.has('ADMIN_VIEW_AUDIT') },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Sidebar 240px sur desktop */}
      <aside className="lg:col-span-3 border border-[#E5E7EB] rounded-xl p-3 bg-white h-fit">
        <div className="px-3 py-2 border-b border-[#E5E7EB] mb-2">
          <p className="text-xs font-semibold text-[#4F0000]">Console d’administration</p>
          <p className="text-[11px] text-[#52525B] mt-0.5">Rôle : {currentUser.role}</p>
        </div>
        <nav className="space-y-1">
          {navItems
            .filter((item) => item.visible)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`w-full min-h-[40px] px-3 rounded-lg text-xs font-medium flex items-center gap-2.5 cursor-pointer transition-colors ${
                  tab === item.id ? 'bg-[#4F0000] text-white' : 'text-[#111111] hover:bg-[#F8F8F9]'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="lg:col-span-9 space-y-5">
        {error && <div className="p-3 rounded-lg border border-[#4F0000] bg-[#4F0000]/10 text-xs text-[#4F0000]">{error}</div>}
        {feedback && <div className="p-3 rounded-lg border border-[#87CEEB] bg-[#87CEEB]/20 text-xs text-[#111111]">{feedback}</div>}

        {tab === 'overview' && overview && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                ['Clients inscrits', overview.kpis.totalUsers],
                ['Clients vérifiés KYC', overview.kpis.verifiedUsers],
                ['Demandes en attente', overview.kpis.pendingLoans],
                ['Crédits accordés', overview.kpis.approvedLoans],
              ].map(([label, val]) => (
                <div key={String(label)} className="p-4 border border-[#E5E7EB] rounded-xl bg-white">
                  <p className="text-xs text-[#52525B]">{label}</p>
                  <p className="mt-1 text-2xl font-bold font-mono-tabular text-[#111111]">{val}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-5 border border-[#E5E7EB] rounded-xl bg-white">
                <p className="text-xs text-[#52525B]">Épargne totale gérée (Sim.)</p>
                <p className="mt-1 text-2xl font-bold font-mono-tabular text-[#4F0000]">
                  {overview.kpis.totalSavings.toFixed(2)} USD
                </p>
              </div>
              <div className="p-5 border border-[#E5E7EB] rounded-xl bg-white">
                <p className="text-xs text-[#52525B]">Volume crédit octroyé (Sim.)</p>
                <p className="mt-1 text-2xl font-bold font-mono-tabular text-[#111111]">
                  {overview.kpis.totalDisbursed.toFixed(2)} USD
                </p>
              </div>
              <div className="p-5 border border-[#E5E7EB] rounded-xl bg-white">
                <p className="text-xs text-[#52525B]">Transactions simulées / réelles</p>
                <p className="mt-1 text-2xl font-bold font-mono-tabular text-[#111111]">
                  {overview.kpis.simulatedTxCount} / {overview.kpis.realTxCount}
                </p>
              </div>
            </div>
          </div>
        )}

        {tab === 'loans' && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold">Examen humain des demandes de crédit</h2>
            {loans.map((l) => {
              const factors: SolvencyFactor[] = l.factors_json ? JSON.parse(l.factors_json) : [];
              return (
                <div key={l.id} className="border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm text-[#111111]">
                        {l.first_name} {l.last_name} ({l.city}) —{' '}
                        <span className="font-mono-tabular">{l.requested_amount.toFixed(2)} USD</span> / {l.duration_months} mois
                      </p>
                      <p className="text-xs text-[#52525B] mt-0.5">
                        {l.business_activity} · Revenu {l.monthly_income} USD · Charges {l.monthly_expenses + l.existing_commitments} USD
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-[#4F0000]">{l.status}</span>
                  </div>

                  <div className="p-3 bg-[#F8F8F9] border border-[#E5E7EB] rounded-lg space-y-1.5">
                    <p className="text-xs font-medium text-[#111111]">
                      Score indicatif : <span className="font-mono-tabular">{l.score}/100</span> · Risque : {l.risk_band} · Capacité nette :{' '}
                      <span className="font-mono-tabular">{l.disposable_income?.toFixed(2)} USD</span>
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#52525B]">
                      {factors.map((f, idx) => (
                        <span key={idx}>
                          {f.label} ({f.impact})
                        </span>
                      ))}
                    </div>
                  </div>

                  {l.status === 'PENDING_REVIEW' || l.status === 'COMPLEMENT_REQUIRED' ? (
                    <div className="flex flex-col sm:flex-row gap-3 pt-1">
                      <input
                        type="text"
                        placeholder="Note de décision obligatoire (min. 5 caractères)..."
                        value={reviewNotes[l.id] || ''}
                        onChange={(e) => setReviewNotes({ ...reviewNotes, [l.id]: e.target.value })}
                        className="flex-1 min-h-[40px] px-3 text-xs border border-[#E5E7EB] rounded-lg"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleLoanDecision(l.id, 'APPROVED')}
                          className="min-h-[40px] px-3.5 bg-[#4F0000] text-white text-xs font-medium rounded-lg cursor-pointer"
                        >
                          Approuver
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLoanDecision(l.id, 'COMPLEMENT_REQUIRED')}
                          className="min-h-[40px] px-3 border border-[#E5E7EB] text-xs rounded-lg cursor-pointer"
                        >
                          Complément
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLoanDecision(l.id, 'REJECTED')}
                          className="min-h-[40px] px-3 border border-[#4F0000] text-[#4F0000] text-xs rounded-lg cursor-pointer"
                        >
                          Rejeter
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-[#52525B]">Note : {l.decision_note}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'users' && (
          <div className="border border-[#E5E7EB] rounded-xl p-5 bg-white overflow-x-auto">
            <h2 className="font-display text-lg font-bold mb-4">Gestion des utilisateurs, KYC & Rôles RBAC</h2>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-[#52525B]">
                  <th className="py-2 pr-3">Nom / E-mail</th>
                  <th className="py-2 pr-3">Ville</th>
                  <th className="py-2 pr-3">Rôle</th>
                  <th className="py-2 pr-3">KYC</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-3 pr-3">
                      <div className="font-medium text-[#111111]">
                        {u.first_name} {u.last_name}
                      </div>
                      <div className="text-[#52525B]">{u.email}</div>
                    </td>
                    <td className="py-3 pr-3">{u.city}</td>
                    <td className="py-3 pr-3">
                      {perms.has('ADMIN_MANAGE_ROLES') && u.id !== currentUser.id ? (
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                          className="px-2 py-1 border border-[#E5E7EB] rounded bg-white text-xs"
                        >
                          {['CLIENT', 'SUPER_ADMIN', 'ADMIN', 'VERIFICATION_AGENT', 'CREDIT_AGENT', 'CLIENT_SUPPORT', 'AUDITOR'].map(
                            (r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            )
                          )}
                        </select>
                      ) : (
                        <span className="font-mono-tabular">{u.role}</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 font-medium">{u.kyc_status}</td>
                    <td className="py-3 text-right space-x-2 whitespace-nowrap">
                      {perms.has('ADMIN_VERIFY_KYC') && u.kyc_status === 'PENDING_REVIEW' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleKycVerify(u.id, 'VERIFIED')}
                            className="px-2.5 py-1 bg-[#4F0000] text-white rounded text-xs cursor-pointer"
                          >
                            Valider KYC
                          </button>
                          <button
                            type="button"
                            onClick={() => handleKycVerify(u.id, 'FAILED')}
                            className="px-2.5 py-1 border border-[#4F0000] text-[#4F0000] rounded text-xs cursor-pointer"
                          >
                            Refuser
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'transactions' && (
          <div className="border border-[#E5E7EB] rounded-xl p-5 bg-white overflow-x-auto">
            <h2 className="font-display text-lg font-bold mb-4">Transactions & Réconciliation</h2>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-[#52525B]">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Référence</th>
                  <th className="py-2 pr-3">Fournisseur</th>
                  <th className="py-2 pr-3">Mode</th>
                  <th className="py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {transactions.map((tx, i) => (
                  <tr key={String(tx.id ?? i)}>
                    <td className="py-2.5 pr-3 font-mono-tabular">{String(tx.created_at).slice(0, 10)}</td>
                    <td className="py-2.5 pr-3">
                      {String(tx.first_name || '')} {String(tx.last_name || '')}
                    </td>
                    <td className="py-2.5 pr-3 font-mono-tabular">{String(tx.payment_reference || tx.id)}</td>
                    <td className="py-2.5 pr-3">{String(tx.provider)}</td>
                    <td className="py-2.5 pr-3">{tx.is_simulated === 1 ? 'Simulation' : 'Réel'}</td>
                    <td className="py-2.5 text-right font-mono-tabular font-semibold">
                      {Number(tx.amount).toFixed(2)} {String(tx.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'notifications' && (
          <form onSubmit={handleSendBroadcast} className="border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4">
            <h2 className="font-display text-lg font-bold">Diffuser une notification aux clients</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <input
                type="text"
                required
                placeholder="Titre du message"
                value={broadcast.title}
                onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })}
                className="min-h-[42px] px-3 text-sm border border-[#E5E7EB] rounded-lg"
              />
              <select
                value={broadcast.category}
                onChange={(e) => setBroadcast({ ...broadcast, category: e.target.value })}
                className="min-h-[42px] px-3 text-sm border border-[#E5E7EB] rounded-lg bg-white"
              >
                <option value="FINANCIAL_TIP">Conseil financier</option>
                <option value="SECURITY_ALERT">Alerte sécurité</option>
                <option value="GENERAL">Information générale</option>
              </select>
            </div>
            <textarea
              required
              rows={3}
              placeholder="Contenu de la notification..."
              value={broadcast.message}
              onChange={(e) => setBroadcast({ ...broadcast, message: e.target.value })}
              className="w-full p-3 text-sm border border-[#E5E7EB] rounded-lg"
            />
            <button type="submit" className="min-h-[42px] px-5 bg-[#4F0000] text-white text-xs font-medium rounded-lg cursor-pointer">
              Envoyer aux clients actifs
            </button>
          </form>
        )}

        {tab === 'providers' && (
          <div className="space-y-6">
            <div className="border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-3">
              <h2 className="font-display text-lg font-bold">Configuration des fournisseurs</h2>
              <div className="divide-y divide-[#E5E7EB] text-xs">
                {providers.map((p) => (
                  <div key={p.id} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold text-[#111111]">{p.name}</p>
                      <p className="text-[#52525B]">
                        {p.category} · Mode : <span className="font-mono-tabular">{p.mode}</span>
                      </p>
                    </div>
                    {perms.has('ADMIN_MANAGE_PROVIDERS') ? (
                      <button
                        type="button"
                        onClick={() => handleToggleProvider(p)}
                        className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer ${
                          p.enabled === 1
                            ? 'bg-[#4F0000] text-white'
                            : 'border border-[#E5E7EB] text-[#52525B]'
                        }`}
                      >
                        {p.enabled === 1 ? 'Activé' : 'Désactivé'}
                      </button>
                    ) : (
                      <span>{p.enabled === 1 ? 'Activé' : 'Désactivé'}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-3">
              <h3 className="font-display text-base font-semibold">Erreurs d’intégration récentes</h3>
              <div className="divide-y divide-[#E5E7EB] text-xs">
                {integrationErrors.map((errRow) => (
                  <div key={errRow.id} className="py-2.5">
                    <p className="font-medium text-[#4F0000]">
                      {errRow.provider} · {errRow.error_code}
                    </p>
                    <p className="text-[#52525B] mt-0.5">{errRow.message}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'audit' && (
          <div className="border border-[#E5E7EB] rounded-xl p-5 bg-white overflow-x-auto">
            <h2 className="font-display text-lg font-bold mb-4">Journaux d’audit immuables</h2>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-[#52525B]">
                  <th className="py-2 pr-3">Horodatage</th>
                  <th className="py-2 pr-3">Acteur</th>
                  <th className="py-2 pr-3">Action</th>
                  <th className="py-2 pr-3">Cible</th>
                  <th className="py-2">Détails</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 pr-3 font-mono-tabular whitespace-nowrap">
                      {log.created_at.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="py-2.5 pr-3">
                      {log.actor_email || 'Système'} ({log.actor_role})
                    </td>
                    <td className="py-2.5 pr-3 font-mono-tabular font-medium text-[#4F0000]">{log.action}</td>
                    <td className="py-2.5 pr-3 font-mono-tabular">
                      {log.target_type} {log.target_id || ''}
                    </td>
                    <td className="py-2.5 text-[#52525B] font-mono-tabular truncate max-w-[240px]">
                      {log.metadata_json}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
