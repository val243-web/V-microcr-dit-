import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Info } from 'lucide-react';
import { apiRequest } from '../api/client';
import type { LoanApplication, RepaymentInstallment, SolvencyFactor } from '../types/vmicro';

interface CreditViewProps {
  kycStatus: string;
  onRefreshDashboard: () => void;
  onGoToKyc: () => void;
}

export function CreditView({ kycStatus, onRefreshDashboard, onGoToKyc }: CreditViewProps) {
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [loanDetail, setLoanDetail] = useState<{
    application: LoanApplication;
    contract: { id: string; remaining_balance: number; total_repayable: number; monthly_installment: number; status: string } | null;
    schedule: RepaymentInstallment[];
  } | null>(null);

  const [step, setStep] = useState<number>(0); // 0 = list/overview, 1..4 = guided wizard
  const [form, setForm] = useState({
    businessActivity: 'Commerce de proximité / Alimentation',
    businessYears: '3',
    monthlyIncome: '650',
    monthlyExpenses: '300',
    existingCommitments: '40',
    requestedAmount: '400',
    durationMonths: '6',
    purpose: 'Approvisionnement stock marchandise',
  });
  const [estimate, setEstimate] = useState<{
    monthlyInstallment: number;
    totalInterest: number;
    totalRepayable: number;
    annualInterestRate: number;
  } | null>(null);

  const [submitResult, setSubmitResult] = useState<{
    loanId: string;
    solvency: {
      score: number;
      riskBand: string;
      disposableIncome: number;
      debtToIncomeRatio: number;
      factors: SolvencyFactor[];
      disclaimer: string;
    };
  } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [repayProvider, setRepayProvider] = useState<'AIRTEL_MONEY' | 'ORANGE_MONEY' | 'VODACOM_MPESA'>('AIRTEL_MONEY');

  async function loadLoans() {
    try {
      const res = await apiRequest<{ applications: LoanApplication[] }>('/loans');
      setApplications(res.applications);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur chargement crédits');
    }
  }

  async function loadLoanDetail(id: string) {
    try {
      const res = await apiRequest<typeof loanDetail>(`/loans/${id}`);
      setLoanDetail(res);
      setSelectedLoanId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur détail crédit');
    }
  }

  async function refreshEstimate() {
    try {
      const res = await apiRequest<{
        monthlyInstallment: number;
        totalInterest: number;
        totalRepayable: number;
        annualInterestRate: number;
      }>('/loans/estimate', {
        method: 'POST',
        body: JSON.stringify({
          requestedAmount: Number(form.requestedAmount) || 100,
          durationMonths: Number(form.durationMonths) || 6,
        }),
      });
      setEstimate(res);
    } catch {
      // Ignore transient typing
    }
  }

  useEffect(() => {
    loadLoans();
  }, []);

  useEffect(() => {
    if (step === 3) refreshEstimate();
  }, [step, form.requestedAmount, form.durationMonths]);

  async function handleSubmitApplication() {
    setError(null);
    setSuccess(null);
    try {
      const res = await apiRequest<{
        loanId: string;
        solvency: NonNullable<typeof submitResult>['solvency'];
      }>('/loans/apply', {
        method: 'POST',
        body: JSON.stringify({
          businessActivity: form.businessActivity,
          businessYears: Number(form.businessYears),
          monthlyIncome: Number(form.monthlyIncome),
          monthlyExpenses: Number(form.monthlyExpenses),
          existingCommitments: Number(form.existingCommitments),
          requestedAmount: Number(form.requestedAmount),
          durationMonths: Number(form.durationMonths),
          purpose: form.purpose,
        }),
      });
      setSubmitResult(res);
      setStep(5);
      await loadLoans();
      onRefreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur soumission demande');
    }
  }

  async function handleRepayInstallment(scheduleId: string) {
    if (!selectedLoanId) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await apiRequest<{ reference: string; amountPaid: number }>(`/loans/${selectedLoanId}/repay`, {
        method: 'POST',
        body: JSON.stringify({
          scheduleId,
          provider: repayProvider,
          idempotencyKey: `rep_${scheduleId}_${Date.now()}`,
        }),
      });
      setSuccess(`Remboursement simulé confirmé : ${res.amountPaid.toFixed(2)} USD (Réf: ${res.reference}).`);
      await loadLoanDetail(selectedLoanId);
      onRefreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur remboursement');
    }
  }

  if (selectedLoanId && loanDetail) {
    const factors: SolvencyFactor[] = loanDetail.application.factors_json
      ? JSON.parse(loanDetail.application.factors_json)
      : [];

    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => {
            setSelectedLoanId(null);
            setLoanDetail(null);
          }}
          className="inline-flex items-center gap-2 text-sm font-medium text-[#4F0000] hover:underline cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour aux demandes de crédit
        </button>

        {error && <div className="p-3 rounded-lg border border-[#4F0000] bg-[#4F0000]/10 text-xs text-[#4F0000]">{error}</div>}
        {success && <div className="p-3 rounded-lg border border-[#87CEEB] bg-[#87CEEB]/20 text-xs text-[#111111]">{success}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-[#111111]">
                Dossier {loanDetail.application.requested_amount.toFixed(2)} USD
              </h2>
              <span className="text-xs font-medium text-[#4F0000]">{loanDetail.application.status}</span>
            </div>
            <p className="text-xs text-[#52525B]">
              {loanDetail.application.business_activity} · {loanDetail.application.duration_months} mois · {loanDetail.application.purpose}
            </p>

            {loanDetail.application.decision_note && (
              <div className="p-3 border border-[#E5E7EB] bg-[#F8F8F9] rounded-lg text-xs text-[#111111]">
                <strong>Décision institutionnelle :</strong> {loanDetail.application.decision_note}
              </div>
            )}

            <div className="pt-3 border-t border-[#E5E7EB] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#52525B]">Score indicatif de solvabilité</span>
                <span className="font-mono-tabular font-semibold text-[#111111]">
                  {loanDetail.application.score ?? '—'}/100 ({loanDetail.application.risk_band})
                </span>
              </div>
              {factors.map((f, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-[#E5E7EB] last:border-b-0">
                  <span className="text-[#111111]">{f.label}</span>
                  <span className="font-mono-tabular text-[#52525B]">{f.impact}</span>
                </div>
              ))}
              <p className="text-[11px] text-[#52525B] pt-2 leading-relaxed">
                {loanDetail.application.disclaimer}
              </p>
            </div>
          </div>

          <div className="lg:col-span-7 border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-semibold text-[#111111]">Échéancier de remboursement</h3>
                {loanDetail.contract && (
                  <p className="text-xs text-[#52525B] mt-0.5">
                    Reste à rembourser :{' '}
                    <strong className="font-mono-tabular text-[#111111]">
                      {loanDetail.contract.remaining_balance.toFixed(2)} USD
                    </strong>
                  </p>
                )}
              </div>
              {loanDetail.contract && (
                <select
                  value={repayProvider}
                  onChange={(e) => setRepayProvider(e.target.value as typeof repayProvider)}
                  className="min-h-[38px] px-3 text-xs border border-[#E5E7EB] rounded-lg bg-white"
                >
                  <option value="AIRTEL_MONEY">Payer via Airtel Money (Sim.)</option>
                  <option value="ORANGE_MONEY">Payer via Orange Money (Sim.)</option>
                  <option value="VODACOM_MPESA">Payer via M-Pesa (Sim.)</option>
                </select>
              )}
            </div>

            {loanDetail.schedule.length === 0 ? (
              <p className="text-sm text-[#52525B] py-6">
                L’échéancier détaillé sera généré après validation humaine du dossier par un agent de crédit autorisé.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E5E7EB] text-[#52525B]">
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Échéance</th>
                      <th className="py-2 pr-3 text-right">Capital</th>
                      <th className="py-2 pr-3 text-right">Intérêt</th>
                      <th className="py-2 pr-3 text-right">Total dû</th>
                      <th className="py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {loanDetail.schedule.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2.5 pr-3 font-mono-tabular">{s.installment_number}</td>
                        <td className="py-2.5 pr-3 font-mono-tabular">{s.due_date}</td>
                        <td className="py-2.5 pr-3 text-right font-mono-tabular">{s.principal_due.toFixed(2)}</td>
                        <td className="py-2.5 pr-3 text-right font-mono-tabular">{s.interest_due.toFixed(2)}</td>
                        <td className="py-2.5 pr-3 text-right font-mono-tabular font-semibold">{s.total_due.toFixed(2)} USD</td>
                        <td className="py-2.5 text-right">
                          {s.status === 'PAID' ? (
                            <span className="text-xs font-medium text-[#111111]">Réglée</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRepayInstallment(s.id)}
                              className="px-3 py-1.5 bg-[#4F0000] text-white rounded text-xs font-medium hover:bg-[#3B0000] cursor-pointer"
                            >
                              Payer
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-[#111111]">Module Microcrédit</h2>
          <p className="text-sm text-[#52525B]">
            Demandes guidées, évaluation explicable de solvabilité et suivi des échéanciers (Mode Simulation).
          </p>
        </div>
        {step === 0 ? (
          <button
            type="button"
            onClick={() => {
              setSubmitResult(null);
              setStep(1);
            }}
            className="min-h-[44px] px-5 bg-[#4F0000] text-white text-sm font-medium rounded-lg hover:bg-[#3B0000] cursor-pointer"
          >
            Nouvelle demande de crédit
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStep(0)}
            className="min-h-[40px] px-4 border border-[#E5E7EB] text-xs font-medium rounded-lg cursor-pointer"
          >
            Fermer l’assistant de demande
          </button>
        )}
      </div>

      {error && <div className="p-3 rounded-lg border border-[#4F0000] bg-[#4F0000]/10 text-xs text-[#4F0000]">{error}</div>}

      {/* Parcours guidé en étapes */}
      {step > 0 && step <= 4 && (
        <div className="border border-[#E5E7EB] rounded-2xl p-6 bg-white space-y-6">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3 text-xs text-[#52525B]">
            <span className="font-medium text-[#4F0000]">Étape {step} sur 4</span>
            <span>
              {step === 1 && 'Activité économique'}
              {step === 2 && 'Revenus, dépenses et charges'}
              {step === 3 && 'Montant, durée et estimation'}
              {step === 4 && 'Vérification complémentaire & Soumission'}
            </span>
          </div>

          {step === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Activité économique ou profession</label>
                <input
                  type="text"
                  value={form.businessActivity}
                  onChange={(e) => setForm({ ...form, businessActivity: e.target.value })}
                  className="w-full min-h-[44px] px-3.5 text-sm border border-[#E5E7EB] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Ancienneté de l’activité (années)</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={form.businessYears}
                  onChange={(e) => setForm({ ...form, businessYears: e.target.value })}
                  className="w-full min-h-[44px] px-3.5 text-sm border border-[#E5E7EB] rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Objet du financement</label>
                <input
                  type="text"
                  value={form.purpose}
                  onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                  className="w-full min-h-[44px] px-3.5 text-sm border border-[#E5E7EB] rounded-lg"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Revenus mensuels (USD)</label>
                <input
                  type="number"
                  min="1"
                  value={form.monthlyIncome}
                  onChange={(e) => setForm({ ...form, monthlyIncome: e.target.value })}
                  className="w-full min-h-[44px] px-3.5 text-sm border border-[#E5E7EB] rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Dépenses mensuelles (USD)</label>
                <input
                  type="number"
                  min="0"
                  value={form.monthlyExpenses}
                  onChange={(e) => setForm({ ...form, monthlyExpenses: e.target.value })}
                  className="w-full min-h-[44px] px-3.5 text-sm border border-[#E5E7EB] rounded-lg font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Autres engagements / dettes (USD)</label>
                <input
                  type="number"
                  min="0"
                  value={form.existingCommitments}
                  onChange={(e) => setForm({ ...form, existingCommitments: e.target.value })}
                  className="w-full min-h-[44px] px-3.5 text-sm border border-[#E5E7EB] rounded-lg font-mono-tabular"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Montant souhaité (20 à 10 000 USD)</label>
                  <input
                    type="number"
                    min="20"
                    max="10000"
                    value={form.requestedAmount}
                    onChange={(e) => setForm({ ...form, requestedAmount: e.target.value })}
                    className="w-full min-h-[44px] px-3.5 text-sm border border-[#E5E7EB] rounded-lg font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Durée souhaitée (mois)</label>
                  <select
                    value={form.durationMonths}
                    onChange={(e) => setForm({ ...form, durationMonths: e.target.value })}
                    className="w-full min-h-[44px] px-3.5 text-sm border border-[#E5E7EB] rounded-lg bg-white"
                  >
                    {[3, 6, 9, 12, 18, 24].map((m) => (
                      <option key={m} value={m}>
                        {m} mois
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {estimate && (
                <div className="p-4 border border-[#87CEEB] bg-[#87CEEB]/15 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-[#52525B]">Mensualité estimée</p>
                    <p className="text-lg font-bold font-mono-tabular text-[#111111]">
                      {estimate.monthlyInstallment.toFixed(2)} USD
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#52525B]">Taux annuel indicatif</p>
                    <p className="text-lg font-bold font-mono-tabular text-[#111111]">{estimate.annualInterestRate}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#52525B]">Coût total intérêts</p>
                    <p className="text-lg font-bold font-mono-tabular text-[#111111]">{estimate.totalInterest.toFixed(2)} USD</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#52525B]">Total à rembourser</p>
                    <p className="text-lg font-bold font-mono-tabular text-[#4F0000]">{estimate.totalRepayable.toFixed(2)} USD</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="p-4 border border-[#E5E7EB] rounded-xl flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#111111]">Statut de vérification d’identité : {kycStatus}</p>
                  <p className="text-xs text-[#52525B] mt-1">
                    Un dossier KYC vérifié améliore la fiabilité de l’examen humain par l’agent de crédit.
                  </p>
                </div>
                {kycStatus !== 'VERIFIED' && (
                  <button
                    type="button"
                    onClick={onGoToKyc}
                    className="px-3 py-2 text-xs font-medium border border-[#4F0000] text-[#4F0000] rounded-lg whitespace-nowrap cursor-pointer"
                  >
                    Vérifier maintenant
                  </button>
                )}
              </div>

              <div className="p-4 border border-[#87CEEB] bg-[#87CEEB]/15 rounded-xl flex items-start gap-3 text-xs text-[#111111]">
                <Info className="w-4 h-4 text-[#4F0000] shrink-0 mt-0.5" />
                <p>
                  Le score de solvabilité calculé lors de la soumission est purement indicatif et explicable. Il ne constitue jamais une garantie d’octroi : la décision finale est examinée par un agent autorisé.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(Math.max(0, step - 1))}
              className="min-h-[40px] px-4 border border-[#E5E7EB] text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Précédent
            </button>
            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                className="min-h-[40px] px-5 bg-[#4F0000] text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                Continuer
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmitApplication}
                className="min-h-[44px] px-6 bg-[#4F0000] text-white text-sm font-medium rounded-lg cursor-pointer"
              >
                Soumettre pour évaluation
              </button>
            )}
          </div>
        </div>
      )}

      {step === 5 && submitResult && (
        <div className="border border-[#E5E7EB] rounded-2xl p-6 bg-white space-y-4">
          <div className="flex items-center gap-2 text-[#4F0000]">
            <CheckCircle2 className="w-6 h-6" />
            <h3 className="font-display text-lg font-bold">Demande enregistrée ({submitResult.loanId})</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 border border-[#E5E7EB] rounded-xl bg-[#F8F8F9]">
            <div>
              <p className="text-xs text-[#52525B]">Score indicatif</p>
              <p className="text-2xl font-bold font-mono-tabular">{submitResult.solvency.score}/100</p>
            </div>
            <div>
              <p className="text-xs text-[#52525B]">Profil de risque</p>
              <p className="text-lg font-semibold">{submitResult.solvency.riskBand}</p>
            </div>
            <div>
              <p className="text-xs text-[#52525B]">Capacité nette mensuelle</p>
              <p className="text-lg font-semibold font-mono-tabular">{submitResult.solvency.disposableIncome.toFixed(2)} USD</p>
            </div>
          </div>
          <div className="space-y-2">
            {submitResult.solvency.factors.map((f, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-[#E5E7EB]">
                <span>{f.label}</span>
                <span className="font-mono-tabular font-medium">{f.impact}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-[#52525B]">{submitResult.solvency.disclaimer}</p>
          <button
            type="button"
            onClick={() => setStep(0)}
            className="min-h-[40px] px-4 bg-[#4F0000] text-white text-xs font-medium rounded-lg cursor-pointer"
          >
            Voir mes demandes
          </button>
        </div>
      )}

      {/* Liste des demandes de crédit */}
      <div className="border border-[#E5E7EB] rounded-xl bg-white divide-y divide-[#E5E7EB]">
        {applications.length === 0 ? (
          <p className="p-6 text-sm text-[#52525B]">Aucune demande de crédit soumise.</p>
        ) : (
          applications.map((loan) => (
            <div key={loan.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <span className="font-mono-tabular text-base font-bold text-[#111111]">
                    {loan.requested_amount.toFixed(2)} USD
                  </span>
                  <span className="text-xs font-medium text-[#4F0000]">{loan.status}</span>
                </div>
                <p className="text-xs text-[#52525B] mt-1">
                  {loan.business_activity} · {loan.duration_months} mois · Mensualité est.{' '}
                  <span className="font-mono-tabular">{loan.estimated_monthly_payment.toFixed(2)} USD</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => loadLoanDetail(loan.id)}
                className="min-h-[40px] px-4 border border-[#E5E7EB] hover:border-[#4F0000] text-xs font-medium rounded-lg cursor-pointer whitespace-nowrap"
              >
                Détails & Échéancier
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
