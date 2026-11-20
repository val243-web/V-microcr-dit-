import React from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CreditCard,
  MessageSquare,
  Plus,
  ShieldCheck,
  Target,
} from 'lucide-react';
import type { DashboardData, Language } from '../types/vmicro';
import { TRANSLATIONS } from '../i18n/translations';

interface DashboardViewProps {
  data: DashboardData | null;
  loading: boolean;
  language: Language;
  onNavigate: (tab: 'savings' | 'credit' | 'kyc' | 'assistant' | 'notifications') => void;
}

export function DashboardView({ data, loading, language, onNavigate }: DashboardViewProps) {
  const t = TRANSLATIONS[language];

  if (loading || !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-32 bg-[#F8F8F9] rounded-xl border border-[#E5E7EB]" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-28 bg-[#F8F8F9] rounded-xl border border-[#E5E7EB]" />
          <div className="h-28 bg-[#F8F8F9] rounded-xl border border-[#E5E7EB]" />
          <div className="h-28 bg-[#F8F8F9] rounded-xl border border-[#E5E7EB]" />
        </div>
      </div>
    );
  }

  const nextInstallment = data.nextInstallments[0];
  const activeContract = data.activeContracts[0];

  return (
    <div className="space-y-6">
      {/* Statut KYC discret en haut si non vérifié */}
      {data.kyc.status !== 'VERIFIED' && (
        <div className="p-4 border border-[#87CEEB] bg-[#87CEEB]/15 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[#111111]">
              Vérification d’identité : {data.kyc.status === 'PENDING_REVIEW' ? 'En cours d’examen' : 'À compléter'}
            </p>
            <p className="text-xs text-[#52525B] mt-0.5">
              Complétez votre vérification (Halisi simulation ou parcours alternatif) pour renforcer votre dossier crédit.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('kyc')}
            className="min-h-[40px] px-4 py-2 text-xs font-medium bg-[#4F0000] text-white rounded-lg hover:bg-[#3B0000] whitespace-nowrap shrink-0 cursor-pointer"
          >
            Vérifier mon identité
          </button>
        </div>
      )}

      {/* Cartes KPI principales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 border border-[#E5E7EB] rounded-xl bg-white">
          <p className="text-xs text-[#52525B]">{t.availableBalance}</p>
          <p className="mt-2 text-3xl font-bold font-mono-tabular text-[#111111]">
            {data.account.available_balance.toFixed(2)} <span className="text-base font-normal text-[#52525B]">USD</span>
          </p>
          <p className="mt-2 text-xs text-[#52525B]">
            Mode Simulation · Solde disponible
          </p>
        </div>

        <div className="p-5 border border-[#E5E7EB] rounded-xl bg-white">
          <p className="text-xs text-[#52525B]">{t.totalSavings}</p>
          <p className="mt-2 text-3xl font-bold font-mono-tabular text-[#4F0000]">
            {data.account.total_savings.toFixed(2)} <span className="text-base font-normal text-[#52525B]">USD</span>
          </p>
          <p className="mt-2 text-xs text-[#52525B]">
            Dont <span className="font-mono-tabular font-medium text-[#111111]">{data.account.locked_goals_balance.toFixed(2)} USD</span> en objectifs
          </p>
        </div>

        <div className="p-5 border border-[#E5E7EB] rounded-xl bg-white">
          <p className="text-xs text-[#52525B]">{t.nextRepayment}</p>
          {nextInstallment ? (
            <>
              <p className="mt-2 text-3xl font-bold font-mono-tabular text-[#111111]">
                {nextInstallment.total_due.toFixed(2)} <span className="text-base font-normal text-[#52525B]">USD</span>
              </p>
              <p className="mt-2 text-xs text-[#52525B]">
                Échéance #{nextInstallment.installment_number} · {nextInstallment.due_date}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-2xl font-semibold text-[#111111]">Aucune échéance</p>
              <p className="mt-2 text-xs text-[#52525B]">
                {activeContract ? 'Contrat soldé' : 'Aucun crédit actif en cours'}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Accès rapide aux fonctionnalités */}
      <section aria-label={t.quickActions}>
        <h2 className="font-display text-sm font-semibold text-[#111111] mb-3">{t.quickActions}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <button
            type="button"
            onClick={() => onNavigate('savings')}
            className="min-h-[44px] p-3.5 border border-[#E5E7EB] rounded-xl bg-white hover:border-[#4F0000] text-left transition-colors cursor-pointer"
          >
            <ArrowDownLeft className="w-4 h-4 text-[#4F0000] mb-2" />
            <div className="text-xs font-medium text-[#111111]">{t.depositBtn}</div>
            <div className="text-[11px] text-[#52525B]">Mobile Money</div>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('savings')}
            className="min-h-[44px] p-3.5 border border-[#E5E7EB] rounded-xl bg-white hover:border-[#4F0000] text-left transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#4F0000] mb-2" />
            <div className="text-xs font-medium text-[#111111]">{t.newGoalBtn}</div>
            <div className="text-[11px] text-[#52525B]">Épargne dédiée</div>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('credit')}
            className="min-h-[44px] p-3.5 border border-[#E5E7EB] rounded-xl bg-white hover:border-[#4F0000] text-left transition-colors cursor-pointer"
          >
            <CreditCard className="w-4 h-4 text-[#4F0000] mb-2" />
            <div className="text-xs font-medium text-[#111111]">{t.applyLoanBtn}</div>
            <div className="text-[11px] text-[#52525B]">Microcrédit RDC</div>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('kyc')}
            className="min-h-[44px] p-3.5 border border-[#E5E7EB] rounded-xl bg-white hover:border-[#4F0000] text-left transition-colors cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-[#4F0000] mb-2" />
            <div className="text-xs font-medium text-[#111111]">Identité KYC</div>
            <div className="text-[11px] text-[#52525B]">{data.kyc.status}</div>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('assistant')}
            className="min-h-[44px] p-3.5 border border-[#E5E7EB] rounded-xl bg-white hover:border-[#4F0000] text-left transition-colors cursor-pointer col-span-2 sm:col-span-1"
          >
            <MessageSquare className="w-4 h-4 text-[#4F0000] mb-2" />
            <div className="text-xs font-medium text-[#111111]">Assistant V-Micro</div>
            <div className="text-[11px] text-[#52525B]">Conseils & FAQ</div>
          </button>
        </div>
      </section>

      {/* Grille Objectifs & Demandes de crédit */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 border border-[#E5E7EB] rounded-xl p-5 bg-white">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-[#111111]">{t.activeGoals}</h2>
            <button
              type="button"
              onClick={() => onNavigate('savings')}
              className="text-xs font-medium text-[#4F0000] hover:underline cursor-pointer"
            >
              Gérer l’épargne
            </button>
          </div>
          {data.goals.length === 0 ? (
            <p className="text-sm text-[#52525B] py-6">Aucun objectif d’épargne actif pour le moment.</p>
          ) : (
            <div className="space-y-4">
              {data.goals.map((g) => {
                const pct = Math.min(100, Math.round((g.current_amount / g.target_amount) * 100));
                return (
                  <div key={g.id} className="pb-4 border-b border-[#E5E7EB] last:border-b-0 last:pb-0">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Target className="w-4 h-4 text-[#4F0000]" />
                        <span className="font-medium text-[#111111]">{g.title}</span>
                      </div>
                      <span className="font-mono-tabular text-xs font-medium text-[#111111]">
                        {g.current_amount.toFixed(0)} / {g.target_amount.toFixed(0)} USD ({pct}%)
                      </span>
                    </div>
                    <div className="mt-2 w-full h-2 bg-[#F8F8F9] border border-[#E5E7EB] rounded-full overflow-hidden">
                      <div className="h-full bg-[#4F0000]" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-xs text-[#52525B]">
                      <span>{g.category}</span>
                      <span>Échéance : {g.target_date}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 border border-[#E5E7EB] rounded-xl p-5 bg-white">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-[#111111]">Demandes & Crédits</h2>
            <button
              type="button"
              onClick={() => onNavigate('credit')}
              className="text-xs font-medium text-[#4F0000] hover:underline cursor-pointer"
            >
              Voir tout
            </button>
          </div>
          {data.loans.length === 0 ? (
            <div className="py-6 text-sm text-[#52525B]">
              Aucune demande enregistrée.
              <button
                type="button"
                onClick={() => onNavigate('credit')}
                className="block mt-3 px-4 py-2 text-xs font-medium bg-[#4F0000] text-white rounded-lg cursor-pointer"
              >
                Simuler un microcrédit
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {data.loans.slice(0, 3).map((loan) => (
                <div key={loan.id} className="p-3.5 border border-[#E5E7EB] rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="font-mono-tabular text-sm font-semibold text-[#111111]">
                      {loan.requested_amount.toFixed(2)} USD
                    </span>
                    <span className="text-xs font-medium text-[#4F0000]">{loan.status}</span>
                  </div>
                  <p className="text-xs text-[#52525B] mt-1">
                    {loan.duration_months} mois · {loan.purpose}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Dernières transactions et notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 border border-[#E5E7EB] rounded-xl p-5 bg-white">
          <h2 className="font-display text-base font-semibold text-[#111111] mb-4">{t.recentTransactions}</h2>
          {data.recentTransactions.length === 0 ? (
            <p className="text-sm text-[#52525B] py-4">Aucune opération enregistrée.</p>
          ) : (
            <div className="divide-y divide-[#E5E7EB]">
              {data.recentTransactions.map((tx) => {
                const isDebit = tx.type === 'WITHDRAWAL' || tx.type === 'LOAN_REPAYMENT';
                return (
                  <div key={tx.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg border border-[#E5E7EB] flex items-center justify-center shrink-0">
                        {isDebit ? (
                          <ArrowUpRight className="w-4 h-4 text-[#4F0000]" />
                        ) : (
                          <ArrowDownLeft className="w-4 h-4 text-[#111111]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#111111] truncate">{tx.description}</p>
                        <p className="text-xs text-[#52525B]">
                          {tx.provider} · {tx.payment_reference || tx.id} · {tx.created_at.slice(0, 10)}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`font-mono-tabular text-sm font-semibold whitespace-nowrap ${
                        isDebit ? 'text-[#4F0000]' : 'text-[#111111]'
                      }`}
                    >
                      {isDebit ? '-' : '+'}
                      {tx.amount.toFixed(2)} {tx.currency}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 border border-[#E5E7EB] rounded-xl p-5 bg-white">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-[#111111]">Notifications récentes</h2>
            <button
              type="button"
              onClick={() => onNavigate('notifications')}
              className="text-xs font-medium text-[#4F0000] hover:underline cursor-pointer"
            >
              Centre d’alertes
            </button>
          </div>
          <div className="space-y-3">
            {data.recentNotifications.map((n) => (
              <div key={n.id} className="pb-3 border-b border-[#E5E7EB] last:border-b-0 last:pb-0">
                <div className="flex items-center gap-2 text-xs font-medium text-[#111111]">
                  <Bell className="w-3.5 h-3.5 text-[#4F0000] shrink-0" />
                  <span className="truncate">{n.title}</span>
                </div>
                <p className="text-xs text-[#52525B] mt-1 leading-relaxed">{n.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
