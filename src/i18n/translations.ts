import type { Language } from '../types/vmicro';

export const TRANSLATIONS: Record<
  Language,
  {
    slogan: string;
    simBadge: string;
    navDashboard: string;
    navSavings: string;
    navCredit: string;
    navKyc: string;
    navAssistant: string;
    navNotifications: string;
    navProfile: string;
    navAdmin: string;
    availableBalance: string;
    totalSavings: string;
    activeGoals: string;
    nextRepayment: string;
    recentTransactions: string;
    quickActions: string;
    depositBtn: string;
    withdrawBtn: string;
    newGoalBtn: string;
    applyLoanBtn: string;
    logout: string;
  }
> = {
  fr: {
    slogan: 'Épargner. Préparer. Avancer.',
    simBadge: 'Environnement de simulation — Aucune opération financière réelle',
    navDashboard: 'Accueil',
    navSavings: 'Épargne',
    navCredit: 'Crédit',
    navKyc: 'Identité',
    navAssistant: 'Assistant',
    navNotifications: 'Alertes',
    navProfile: 'Profil',
    navAdmin: 'Administration',
    availableBalance: 'Épargne libre disponible',
    totalSavings: 'Épargne totale cumulée',
    activeGoals: 'Objectifs d’épargne',
    nextRepayment: 'Prochaine échéance',
    recentTransactions: 'Dernières opérations',
    quickActions: 'Actions rapides',
    depositBtn: 'Déposer',
    withdrawBtn: 'Retirer',
    newGoalBtn: 'Nouvel objectif',
    applyLoanBtn: 'Demander un crédit',
    logout: 'Déconnexion',
  },
  sw: {
    slogan: 'Weka akiba. Jiandae. Songa mbele.',
    simBadge: 'Hali ya majaribio — Hakuna miamala halisi ya kifedha',
    navDashboard: 'Nyumbani',
    navSavings: 'Akiba',
    navCredit: 'Mkopo',
    navKyc: 'Utambulisho',
    navAssistant: 'Msaidizi',
    navNotifications: 'Arifa',
    navProfile: 'Wasifu',
    navAdmin: 'Utawala',
    availableBalance: 'Salio la akiba huru',
    totalSavings: 'Jumla ya akiba',
    activeGoals: 'Malengo ya akiba',
    nextRepayment: 'Malipo yajayo',
    recentTransactions: 'Miamala ya hivi karibuni',
    quickActions: 'Hatua za haraka',
    depositBtn: 'Weka pesa',
    withdrawBtn: 'Toa pesa',
    newGoalBtn: 'Lengo jipya',
    applyLoanBtn: 'Omba mkopo',
    logout: 'Toka',
  },
  en: {
    slogan: 'Save. Prepare. Move Forward.',
    simBadge: 'Simulation Environment — No real financial transactions',
    navDashboard: 'Home',
    navSavings: 'Savings',
    navCredit: 'Credit',
    navKyc: 'Identity',
    navAssistant: 'Assistant',
    navNotifications: 'Alerts',
    navProfile: 'Profile',
    navAdmin: 'Admin Console',
    availableBalance: 'Available Free Savings',
    totalSavings: 'Total Cumulative Savings',
    activeGoals: 'Savings Goals',
    nextRepayment: 'Next Installment',
    recentTransactions: 'Recent Transactions',
    quickActions: 'Quick Actions',
    depositBtn: 'Deposit',
    withdrawBtn: 'Withdraw',
    newGoalBtn: 'New Goal',
    applyLoanBtn: 'Apply for Credit',
    logout: 'Sign out',
  },
};
