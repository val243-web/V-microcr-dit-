import React, { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Unlock } from 'lucide-react';
import { apiRequest } from '../api/client';
import type { DashboardData, SavingsGoal, TransactionItem } from '../types/vmicro';

interface SavingsViewProps {
  dashboard: DashboardData | null;
  onRefresh: () => void;
}

export function SavingsView({ dashboard, onRefresh }: SavingsViewProps) {
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create / Edit Goal modal-like inline panel
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [goalForm, setGoalForm] = useState({
    title: '',
    category: 'Commerce',
    targetAmount: '300',
    targetDate: '2027-06-01',
  });

  // Payment Mobile Money Simulation state
  const [payForm, setPayForm] = useState({
    operationType: 'DEPOSIT' as 'DEPOSIT' | 'WITHDRAWAL' | 'GOAL_DEPOSIT',
    provider: 'AIRTEL_MONEY' as 'AIRTEL_MONEY' | 'ORANGE_MONEY' | 'VODACOM_MPESA' | 'FLEXPAY_AGGREGATOR' | 'CARD_INTL',
    amount: '50',
    phoneNumber: '+243812345678',
    goalId: '',
  });
  const [pendingPayment, setPendingPayment] = useState<{
    reference: string;
    externalRef: string;
    provider: string;
    amount: number;
    instructions: string;
  } | null>(null);

  async function loadSavings() {
    setLoading(true);
    try {
      const [gRes, txRes] = await Promise.all([
        apiRequest<{ goals: SavingsGoal[] }>('/savings/goals'),
        apiRequest<{ transactions: TransactionItem[] }>('/transactions'),
      ]);
      setGoals(gRes.goals);
      setTransactions(txRes.transactions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur chargement épargne');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSavings();
  }, []);

  async function handleSaveGoal(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      if (editingGoal) {
        await apiRequest(`/savings/goals/${editingGoal.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: goalForm.title,
            category: goalForm.category,
            targetAmount: Number(goalForm.targetAmount),
            targetDate: goalForm.targetDate,
          }),
        });
        setSuccess('Objectif mis à jour.');
      } else {
        await apiRequest('/savings/goals', {
          method: 'POST',
          body: JSON.stringify({
            title: goalForm.title,
            category: goalForm.category,
            targetAmount: Number(goalForm.targetAmount),
            targetDate: goalForm.targetDate,
          }),
        });
        setSuccess('Nouvel objectif créé.');
      }
      setShowGoalForm(false);
      setEditingGoal(null);
      setGoalForm({ title: '', category: 'Commerce', targetAmount: '300', targetDate: '2027-06-01' });
      await loadSavings();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur objectif');
    }
  }

  async function handleDeleteGoal(goal: SavingsGoal) {
    setError(null);
    setSuccess(null);
    try {
      await apiRequest(`/savings/goals/${goal.id}`, { method: 'DELETE' });
      setSuccess(`Objectif « ${goal.title} » supprimé.`);
      await loadSavings();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression impossible');
    }
  }

  async function handleReleaseGoal(goal: SavingsGoal) {
    setError(null);
    setSuccess(null);
    try {
      const res = await apiRequest<{ message: string }>(`/savings/goals/${goal.id}/release`, { method: 'POST' });
      setSuccess(res.message);
      await loadSavings();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur libération');
    }
  }

  async function handleInitPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const idempotencyKey = `idem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const res = await apiRequest<{
        payment: {
          reference: string;
          externalRef: string;
          provider: string;
          amount: number;
          instructions: string;
        };
      }>('/payments/initialize', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey,
          provider: payForm.provider,
          operationType: payForm.operationType,
          amount: Number(payForm.amount),
          currency: 'USD',
          phoneNumber: payForm.phoneNumber,
          goalId: payForm.operationType === 'GOAL_DEPOSIT' ? payForm.goalId : undefined,
        }),
      });
      setPendingPayment(res.payment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Initialisation échouée');
    }
  }

  async function handleConfirmPayment(simulateFailure = false) {
    if (!pendingPayment) return;
    setError(null);
    try {
      await apiRequest('/payments/confirm', {
        method: 'POST',
        body: JSON.stringify({ reference: pendingPayment.reference, simulateFailure }),
      });
      setSuccess(`Opération ${pendingPayment.reference} confirmée (Mode Simulation).`);
      setPendingPayment(null);
      await loadSavings();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec du paiement');
      setPendingPayment(null);
    }
  }

  async function handleCancelPayment() {
    if (!pendingPayment) return;
    try {
      await apiRequest(`/payments/cancel/${pendingPayment.reference}`, { method: 'POST' });
      setSuccess(`Paiement ${pendingPayment.reference} annulé.`);
      setPendingPayment(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Annulation impossible');
    }
  }

  return (
    <div className="space-y-6">
      {/* Résumé soldes */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 border border-[#E5E7EB] rounded-xl bg-white">
          <p className="text-xs text-[#52525B]">Épargne libre</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-[#111111]">
            {(dashboard?.account.available_balance ?? 0).toFixed(2)} USD
          </p>
        </div>
        <div className="p-4 border border-[#E5E7EB] rounded-xl bg-white">
          <p className="text-xs text-[#52525B]">Épargne en objectifs</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-[#4F0000]">
            {(dashboard?.account.locked_goals_balance ?? 0).toFixed(2)} USD
          </p>
        </div>
        <div className="p-4 border border-[#87CEEB] rounded-xl bg-[#87CEEB]/15">
          <p className="text-xs font-medium text-[#111111]">Règle V-Micro v1</p>
          <p className="mt-1 text-xs text-[#52525B]">
            Épargne libre et objectifs actifs. L’épargne programmée automatique n’est pas activée dans cette version.
          </p>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg border border-[#4F0000] bg-[#4F0000]/10 text-xs text-[#4F0000]">{error}</div>}
      {success && <div className="p-3 rounded-lg border border-[#87CEEB] bg-[#87CEEB]/20 text-xs text-[#111111]">{success}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Opération Mobile Money (Simulation) */}
        <div className="lg:col-span-5 border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4">
          <div>
            <h2 className="font-display text-base font-semibold text-[#111111]">Dépôt / Retrait Mobile Money</h2>
            <p className="text-xs text-[#52525B] mt-0.5">
              Connecteurs RDC en MODE SIMULATION · Aucune transaction réelle
            </p>
          </div>

          {!pendingPayment ? (
            <form onSubmit={handleInitPayment} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium mb-1">Type d’opération</label>
                <select
                  value={payForm.operationType}
                  onChange={(e) =>
                    setPayForm({
                      ...payForm,
                      operationType: e.target.value as 'DEPOSIT' | 'WITHDRAWAL' | 'GOAL_DEPOSIT',
                    })
                  }
                  className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg bg-white"
                >
                  <option value="DEPOSIT">Dépôt vers épargne libre</option>
                  <option value="GOAL_DEPOSIT">Dépôt vers un objectif</option>
                  <option value="WITHDRAWAL">Retrait depuis épargne libre</option>
                </select>
              </div>

              {payForm.operationType === 'GOAL_DEPOSIT' && (
                <div>
                  <label className="block text-xs font-medium mb-1">Objectif cible</label>
                  <select
                    required
                    value={payForm.goalId}
                    onChange={(e) => setPayForm({ ...payForm, goalId: e.target.value })}
                    className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg bg-white"
                  >
                    <option value="">Choisir un objectif...</option>
                    {goals.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title} ({g.current_amount.toFixed(0)} / {g.target_amount.toFixed(0)} USD)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium mb-1">Opérateur RDC</label>
                <select
                  value={payForm.provider}
                  onChange={(e) =>
                    setPayForm({
                      ...payForm,
                      provider: e.target.value as typeof payForm.provider,
                    })
                  }
                  className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg bg-white"
                >
                  <option value="AIRTEL_MONEY">Airtel Money RDC (Simulation)</option>
                  <option value="ORANGE_MONEY">Orange Money RDC (Simulation)</option>
                  <option value="VODACOM_MPESA">Vodacom M-Pesa RDC (Simulation)</option>
                  <option value="FLEXPAY_AGGREGATOR">Agrégateur Multi-Opérateurs (Simulation)</option>
                  <option value="CARD_INTL">Cartes Bancaires (Désactivé — Contrat requis)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Montant (USD)</label>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    required
                    value={payForm.amount}
                    onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                    className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Numéro Mobile Money</label>
                  <input
                    type="tel"
                    required
                    value={payForm.phoneNumber}
                    onChange={(e) => setPayForm({ ...payForm, phoneNumber: e.target.value })}
                    className="w-full min-h-[44px] px-3 text-sm border border-[#E5E7EB] rounded-lg font-mono-tabular"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full min-h-[44px] bg-[#4F0000] text-white text-sm font-medium rounded-lg hover:bg-[#3B0000] cursor-pointer"
              >
                Initialiser l’opération (Simulation)
              </button>
            </form>
          ) : (
            <div className="p-4 border border-[#87CEEB] bg-[#87CEEB]/15 rounded-xl space-y-3">
              <div className="text-xs font-medium text-[#111111]">
                Référence : <span className="font-mono-tabular">{pendingPayment.reference}</span>
              </div>
              <p className="text-xs text-[#52525B] leading-relaxed">{pendingPayment.instructions}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleConfirmPayment(false)}
                  className="min-h-[40px] px-4 bg-[#4F0000] text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  Confirmer (Succès simulé)
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmPayment(true)}
                  className="min-h-[40px] px-3 border border-[#4F0000] text-[#4F0000] text-xs font-medium rounded-lg cursor-pointer"
                >
                  Simuler un échec
                </button>
                <button
                  type="button"
                  onClick={handleCancelPayment}
                  className="min-h-[40px] px-3 border border-[#E5E7EB] bg-white text-xs text-[#52525B] rounded-lg cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Liste et gestion des objectifs */}
        <div className="lg:col-span-7 border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-[#111111]">Objectifs d’épargne</h2>
            <button
              type="button"
              onClick={() => {
                setEditingGoal(null);
                setShowGoalForm(!showGoalForm);
              }}
              className="min-h-[40px] px-3.5 py-2 bg-[#4F0000] text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Nouvel objectif
            </button>
          </div>

          {showGoalForm && (
            <form onSubmit={handleSaveGoal} className="p-4 border border-[#E5E7EB] rounded-xl bg-[#F8F8F9] space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Nom de l’objectif (ex. Stock Boutique)"
                  value={goalForm.title}
                  onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })}
                  className="min-h-[40px] px-3 text-sm bg-white border border-[#E5E7EB] rounded-lg"
                />
                <select
                  value={goalForm.category}
                  onChange={(e) => setGoalForm({ ...goalForm, category: e.target.value })}
                  className="min-h-[40px] px-3 text-sm bg-white border border-[#E5E7EB] rounded-lg"
                >
                  <option value="Commerce">Commerce</option>
                  <option value="Éducation">Éducation</option>
                  <option value="Équipement">Équipement</option>
                  <option value="Urgence">Fonds d’urgence</option>
                </select>
                <input
                  type="number"
                  min="10"
                  required
                  placeholder="Montant cible (USD)"
                  value={goalForm.targetAmount}
                  onChange={(e) => setGoalForm({ ...goalForm, targetAmount: e.target.value })}
                  className="min-h-[40px] px-3 text-sm bg-white border border-[#E5E7EB] rounded-lg font-mono-tabular"
                />
                <input
                  type="date"
                  required
                  value={goalForm.targetDate}
                  onChange={(e) => setGoalForm({ ...goalForm, targetDate: e.target.value })}
                  className="min-h-[40px] px-3 text-sm bg-white border border-[#E5E7EB] rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowGoalForm(false)}
                  className="px-3 py-2 text-xs border border-[#E5E7EB] bg-white rounded-lg cursor-pointer"
                >
                  Annuler
                </button>
                <button type="submit" className="px-4 py-2 text-xs font-medium bg-[#4F0000] text-white rounded-lg cursor-pointer">
                  {editingGoal ? 'Enregistrer' : 'Créer l’objectif'}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="text-sm text-[#52525B]">Chargement des objectifs...</p>
          ) : goals.length === 0 ? (
            <p className="text-sm text-[#52525B] py-4">Aucun objectif actif.</p>
          ) : (
            <div className="space-y-4">
              {goals.map((g) => {
                const pct = Math.min(100, Math.round((g.current_amount / g.target_amount) * 100));
                return (
                  <div key={g.id} className="p-4 border border-[#E5E7EB] rounded-xl">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-[#111111]">{g.title}</h3>
                        <p className="text-xs text-[#52525B]">
                          {g.category} · Échéance {g.target_date}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="Modifier"
                          onClick={() => {
                            setEditingGoal(g);
                            setGoalForm({
                              title: g.title,
                              category: g.category,
                              targetAmount: String(g.target_amount),
                              targetDate: g.target_date,
                            });
                            setShowGoalForm(true);
                          }}
                          className="p-2 text-[#52525B] hover:text-[#111111] cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {g.current_amount > 0 && (
                          <button
                            type="button"
                            title="Libérer vers épargne libre"
                            onClick={() => handleReleaseGoal(g)}
                            className="p-2 text-[#52525B] hover:text-[#4F0000] cursor-pointer"
                          >
                            <Unlock className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Suppression contrôlée"
                          onClick={() => handleDeleteGoal(g)}
                          className="p-2 text-[#52525B] hover:text-[#4F0000] cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 w-full h-2 bg-[#F8F8F9] border border-[#E5E7EB] rounded-full overflow-hidden">
                      <div className="h-full bg-[#4F0000]" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs font-mono-tabular">
                      <span className="text-[#111111] font-medium">{g.current_amount.toFixed(2)} USD épargnés</span>
                      <span className="text-[#52525B]">Cible : {g.target_amount.toFixed(2)} USD ({pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Historique complet des transactions */}
      <div className="border border-[#E5E7EB] rounded-xl p-5 bg-white">
        <h2 className="font-display text-base font-semibold text-[#111111] mb-4">Historique des opérations</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E5E7EB] text-xs text-[#52525B]">
                <th className="py-2.5 pr-4 font-medium">Date</th>
                <th className="py-2.5 pr-4 font-medium">Référence</th>
                <th className="py-2.5 pr-4 font-medium">Description</th>
                <th className="py-2.5 pr-4 font-medium">Canal</th>
                <th className="py-2.5 text-right font-medium">Montant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB] text-sm">
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="py-3 pr-4 font-mono-tabular text-xs text-[#52525B] whitespace-nowrap">
                    {tx.created_at.slice(0, 10)}
                  </td>
                  <td className="py-3 pr-4 font-mono-tabular text-xs text-[#111111] whitespace-nowrap">
                    {tx.payment_reference || tx.id}
                  </td>
                  <td className="py-3 pr-4 text-[#111111]">{tx.description}</td>
                  <td className="py-3 pr-4 text-xs text-[#52525B] whitespace-nowrap">{tx.provider}</td>
                  <td className="py-3 text-right font-mono-tabular font-semibold whitespace-nowrap">
                    {tx.amount.toFixed(2)} {tx.currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
