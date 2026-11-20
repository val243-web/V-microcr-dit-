export type Language = 'fr' | 'sw' | 'en';

export type UserRole =
  | 'CLIENT'
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'VERIFICATION_AGENT'
  | 'CREDIT_AGENT'
  | 'CLIENT_SUPPORT'
  | 'AUDITOR';

export interface UserProfile {
  user_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  city: string;
  commune: string;
  country: string;
  profession: string;
  monthly_income_usd: number;
  language: Language;
  avatar_url: string;
}

export interface AuthUser {
  id: string;
  email: string;
  phone: string;
  role: UserRole;
  permissions: string[];
  phoneVerified: boolean;
  profile: UserProfile;
}

export interface SavingsGoal {
  id: string;
  title: string;
  category: string;
  target_amount: number;
  current_amount: number;
  target_date: string;
  status: string;
}

export interface TransactionItem {
  id: string;
  goal_id?: string | null;
  loan_id?: string | null;
  payment_reference?: string | null;
  type: string;
  amount: number;
  currency: string;
  provider: string;
  status: string;
  description: string;
  is_simulated: number;
  created_at: string;
}

export interface SolvencyFactor {
  label: string;
  impact: string;
  status: 'FAVORABLE' | 'ATTENTION' | 'DEFAVORABLE';
}

export interface LoanApplication {
  id: string;
  user_id: string;
  business_activity: string;
  business_years: number;
  monthly_income: number;
  monthly_expenses: number;
  existing_commitments: number;
  requested_amount: number;
  duration_months: number;
  purpose: string;
  estimated_monthly_payment: number;
  status: string;
  decision_note?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  score?: number;
  risk_band?: string;
  debt_to_income_ratio?: number;
  disposable_income?: number;
  factors_json?: string;
  disclaimer?: string;
  first_name?: string;
  last_name?: string;
  city?: string;
  phone?: string;
}

export interface RepaymentInstallment {
  id: string;
  contract_id: string;
  installment_number: number;
  due_date: string;
  principal_due: number;
  interest_due: number;
  total_due: number;
  paid_amount: number;
  status: 'PENDING' | 'PAID';
  paid_at?: string | null;
}

export interface NotificationItem {
  id: string;
  category: string;
  title: string;
  message: string;
  read: number;
  created_at: string;
}

export interface DashboardData {
  simulationNotice: string;
  account: {
    available_balance: number;
    locked_goals_balance: number;
    total_savings: number;
    currency: string;
    is_simulated: number;
  };
  goals: SavingsGoal[];
  loans: LoanApplication[];
  activeContracts: Array<{
    id: string;
    loan_application_id: string;
    principal_amount: number;
    remaining_balance: number;
    monthly_installment: number;
    total_repayable: number;
    status: string;
  }>;
  nextInstallments: RepaymentInstallment[];
  recentTransactions: TransactionItem[];
  recentNotifications: NotificationItem[];
  kyc: {
    status: string;
    method?: string;
    provider_reference?: string;
  };
}
