export interface LoanEstimateInput {
  requestedAmount: number;
  durationMonths: number;
  annualInterestRate?: number;
}

export interface LoanEstimateResult {
  requestedAmount: number;
  annualInterestRate: number;
  durationMonths: number;
  monthlyInstallment: number;
  totalInterest: number;
  totalRepayable: number;
  schedulePreview: Array<{
    installmentNumber: number;
    principalDue: number;
    interestDue: number;
    totalDue: number;
  }>;
}

export interface SolvencyEvaluationInput {
  ageYears: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  existingCommitments: number;
  requestedAmount: number;
  durationMonths: number;
  businessYears: number;
  totalSavings: number;
  kycVerified: boolean;
}

export interface SolvencyFactor {
  label: string;
  impact: string;
  status: 'FAVORABLE' | 'ATTENTION' | 'DEFAVORABLE';
}

export interface SolvencyEvaluationResult {
  score: number;
  riskBand: 'LOW' | 'MEDIUM' | 'HIGH' | 'INELIGIBLE';
  eligible: boolean;
  debtToIncomeRatio: number;
  disposableIncome: number;
  monthlyInstallment: number;
  factors: SolvencyFactor[];
  disclaimer: string;
}

const DEFAULT_ANNUAL_RATE = 22; // 22% annuel configurable par l'institution

export function calculateLoanEstimate(input: LoanEstimateInput): LoanEstimateResult {
  const rate = input.annualInterestRate ?? DEFAULT_ANNUAL_RATE;
  const principal = Math.max(0, Number(input.requestedAmount));
  const months = Math.max(1, Math.min(36, Math.round(input.durationMonths)));

  const totalInterest = Number(((principal * (rate / 100) * months) / 12).toFixed(2));
  const totalRepayable = Number((principal + totalInterest).toFixed(2));
  const monthlyInstallment = Number((totalRepayable / months).toFixed(2));

  const schedulePreview = Array.from({ length: months }, (_, idx) => {
    const isLast = idx === months - 1;
    const principalBase = Number((principal / months).toFixed(2));
    const interestBase = Number((totalInterest / months).toFixed(2));
    const principalDue = isLast
      ? Number((principal - principalBase * (months - 1)).toFixed(2))
      : principalBase;
    const interestDue = isLast
      ? Number((totalInterest - interestBase * (months - 1)).toFixed(2))
      : interestBase;

    return {
      installmentNumber: idx + 1,
      principalDue,
      interestDue,
      totalDue: Number((principalDue + interestDue).toFixed(2)),
    };
  });

  return {
    requestedAmount: principal,
    annualInterestRate: rate,
    durationMonths: months,
    monthlyInstallment,
    totalInterest,
    totalRepayable,
    schedulePreview,
  };
}

export function evaluateSolvency(input: SolvencyEvaluationInput): SolvencyEvaluationResult {
  const minAge = Number(process.env.MIN_ELIGIBLE_AGE || 18);
  const estimate = calculateLoanEstimate({
    requestedAmount: input.requestedAmount,
    durationMonths: input.durationMonths,
  });

  const disposableIncome = Number(
    (input.monthlyIncome - input.monthlyExpenses - input.existingCommitments).toFixed(2)
  );
  const totalMonthlyDebt = input.existingCommitments + estimate.monthlyInstallment;
  const dti = input.monthlyIncome > 0 ? Number((totalMonthlyDebt / input.monthlyIncome).toFixed(2)) : 1;

  const factors: SolvencyFactor[] = [];
  let score = 35;

  if (input.ageYears < minAge) {
    factors.push({
      label: `Âge inférieur au minimum réglementaire (${minAge} ans)`,
      impact: 'Inéligible',
      status: 'DEFAVORABLE',
    });
    return {
      score: 0,
      riskBand: 'INELIGIBLE',
      eligible: false,
      debtToIncomeRatio: dti,
      disposableIncome,
      monthlyInstallment: estimate.monthlyInstallment,
      factors,
      disclaimer:
        'Score indicatif uniquement — ne constitue pas une garantie d’octroi. Condition d’âge réglementaire non remplie.',
    };
  }

  // 1. Capacité nette disponible
  if (disposableIncome >= estimate.monthlyInstallment * 2) {
    score += 22;
    factors.push({
      label: `Revenu disponible net confortable (${disposableIncome.toFixed(0)} USD/mois)`,
      impact: '+22 pts',
      status: 'FAVORABLE',
    });
  } else if (disposableIncome >= estimate.monthlyInstallment * 1.2) {
    score += 12;
    factors.push({
      label: `Revenu disponible net modéré (${disposableIncome.toFixed(0)} USD/mois)`,
      impact: '+12 pts',
      status: 'ATTENTION',
    });
  } else {
    score -= 18;
    factors.push({
      label: `Marge nette insuffisante face à la mensualité (${disposableIncome.toFixed(0)} USD)`,
      impact: '-18 pts',
      status: 'DEFAVORABLE',
    });
  }

  // 2. Ratio d'endettement
  if (dti <= 0.3) {
    score += 18;
    factors.push({
      label: `Ratio d’endettement maîtrisé (${Math.round(dti * 100)}%)`,
      impact: '+18 pts',
      status: 'FAVORABLE',
    });
  } else if (dti <= 0.45) {
    score += 8;
    factors.push({
      label: `Ratio d’endettement modéré (${Math.round(dti * 100)}%)`,
      impact: '+8 pts',
      status: 'ATTENTION',
    });
  } else {
    score -= 15;
    factors.push({
      label: `Ratio d’endettement élevé (${Math.round(dti * 100)}%)`,
      impact: '-15 pts',
      status: 'DEFAVORABLE',
    });
  }

  // 3. Épargne constituée
  if (input.totalSavings >= input.requestedAmount * 0.25) {
    score += 15;
    factors.push({
      label: `Épargne préalable solide (${input.totalSavings.toFixed(0)} USD)`,
      impact: '+15 pts',
      status: 'FAVORABLE',
    });
  } else if (input.totalSavings > 0) {
    score += 7;
    factors.push({
      label: `Épargne préalable partielle (${input.totalSavings.toFixed(0)} USD)`,
      impact: '+7 pts',
      status: 'ATTENTION',
    });
  } else {
    factors.push({
      label: 'Aucune épargne préalable constituée',
      impact: '0 pt',
      status: 'ATTENTION',
    });
  }

  // 4. Vérification d'identité
  if (input.kycVerified) {
    score += 10;
    factors.push({
      label: 'Identité vérifiée (KYC)',
      impact: '+10 pts',
      status: 'FAVORABLE',
    });
  } else {
    score -= 5;
    factors.push({
      label: 'Vérification d’identité en attente',
      impact: '-5 pts',
      status: 'ATTENTION',
    });
  }

  // 5. Ancienneté activité
  if (input.businessYears >= 2) {
    score += 10;
    factors.push({
      label: `Ancienneté d’activité (${input.businessYears} ans)`,
      impact: '+10 pts',
      status: 'FAVORABLE',
    });
  } else {
    score += 4;
    factors.push({
      label: `Activité récente (${input.businessYears} an)`,
      impact: '+4 pts',
      status: 'ATTENTION',
    });
  }

  const clampedScore = Math.max(5, Math.min(99, score));
  let riskBand: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
  if (clampedScore >= 72) riskBand = 'LOW';
  else if (clampedScore < 50) riskBand = 'HIGH';

  return {
    score: clampedScore,
    riskBand,
    eligible: disposableIncome > 0 && dti <= 0.65,
    debtToIncomeRatio: dti,
    disposableIncome,
    monthlyInstallment: estimate.monthlyInstallment,
    factors,
    disclaimer:
      'Score indicatif uniquement — ne constitue pas une garantie d’octroi. Décision finale examinée et validée par un agent autorisé.',
  };
}

export function calculateAgeFromDob(dob: string): number {
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}
