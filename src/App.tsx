import React, { useEffect, useState } from 'react';
import {
  Bell,
  CreditCard,
  Home,
  MessageSquare,
  PiggyBank,
  ShieldCheck,
  User,
} from 'lucide-react';
import { apiRequest, clearStoredTokens, getStoredTokens } from './api/client';
import { TRANSLATIONS } from './i18n/translations';
import type { AuthUser, DashboardData, Language } from './types/vmicro';
import { AuthViews } from './components/AuthViews';
import { DashboardView } from './components/DashboardView';
import { SavingsView } from './components/SavingsView';
import { CreditView } from './components/CreditView';
import { KycView } from './components/KycView';
import { AssistantView } from './components/AssistantView';
import { NotificationsView } from './components/NotificationsView';
import { ProfileView } from './components/ProfileView';
import { AdminConsoleView } from './components/AdminConsoleView';

type ClientTab = 'dashboard' | 'savings' | 'credit' | 'kyc' | 'assistant' | 'notifications' | 'profile' | 'admin';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [activeTab, setActiveTab] = useState<ClientTab>('dashboard');
  const [language, setLanguage] = useState<Language>('fr');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loadingDash, setLoadingDash] = useState(false);

  const isStaff = user ? user.role !== 'CLIENT' : false;

  async function loadDashboard() {
    setLoadingDash(true);
    try {
      const data = await apiRequest<DashboardData>('/dashboard');
      setDashboard(data);
    } catch {
      // Ignored for non-client or transient errors
    } finally {
      setLoadingDash(false);
    }
  }

  useEffect(() => {
    const { accessToken } = getStoredTokens();
    if (!accessToken) {
      setBootstrapping(false);
      return;
    }

    apiRequest<{ user: AuthUser; profile: AuthUser['profile'] }>('/me')
      .then((res) => {
        const merged: AuthUser = { ...res.user, profile: res.profile };
        setUser(merged);
        if (res.profile?.language) setLanguage(res.profile.language);
        if (merged.role !== 'CLIENT') {
          setActiveTab('admin');
        }
      })
      .catch(() => {
        clearStoredTokens();
      })
      .finally(() => {
        setBootstrapping(false);
      });
  }, []);

  useEffect(() => {
    if (user && activeTab !== 'admin') {
      loadDashboard();
    }
  }, [user, activeTab]);

  async function handleLogout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // Best effort
    }
    clearStoredTokens();
    setUser(null);
    setDashboard(null);
    setActiveTab('dashboard');
  }

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-sm text-[#52525B]">
        Chargement de V-Micro Crédit...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthViews
        language={language}
        onChangeLanguage={setLanguage}
        onAuthenticated={(authUser) => {
          setUser(authUser);
          if (authUser.profile?.language) setLanguage(authUser.profile.language);
          setActiveTab(authUser.role !== 'CLIENT' ? 'admin' : 'dashboard');
        }}
      />
    );
  }

  const t = TRANSLATIONS[language];
  const unreadCount = dashboard?.recentNotifications?.filter((n) => n.read === 0).length ?? 0;

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#111111] flex flex-col pb-20 md:pb-0">
      {/* Top Bar Contract : 3 zones épurées */}
      <header className="sticky top-0 z-30 bg-white border-b border-[#E5E7EB]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setActiveTab(isStaff ? 'admin' : 'dashboard')}
            className="font-display text-lg font-bold tracking-tight text-[#4F0000] whitespace-nowrap shrink-0 cursor-pointer"
          >
            V-Micro Crédit
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#52525B]">
            {!isStaff && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('dashboard')}
                  className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    activeTab === 'dashboard' ? 'text-[#4F0000] font-semibold' : 'hover:text-[#111111]'
                  }`}
                >
                  {t.navDashboard}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('savings')}
                  className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    activeTab === 'savings' ? 'text-[#4F0000] font-semibold' : 'hover:text-[#111111]'
                  }`}
                >
                  {t.navSavings}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('credit')}
                  className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    activeTab === 'credit' ? 'text-[#4F0000] font-semibold' : 'hover:text-[#111111]'
                  }`}
                >
                  {t.navCredit}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('kyc')}
                  className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    activeTab === 'kyc' ? 'text-[#4F0000] font-semibold' : 'hover:text-[#111111]'
                  }`}
                >
                  {t.navKyc}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('assistant')}
                  className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    activeTab === 'assistant' ? 'text-[#4F0000] font-semibold' : 'hover:text-[#111111]'
                  }`}
                >
                  {t.navAssistant}
                </button>
              </>
            )}

            {isStaff && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab('admin')}
                  className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    activeTab === 'admin' ? 'text-[#4F0000] font-semibold' : 'hover:text-[#111111]'
                  }`}
                >
                  {t.navAdmin}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('assistant')}
                  className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    activeTab === 'assistant' ? 'text-[#4F0000] font-semibold' : 'hover:text-[#111111]'
                  }`}
                >
                  {t.navAssistant}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('profile')}
                  className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    activeTab === 'profile' ? 'text-[#4F0000] font-semibold' : 'hover:text-[#111111]'
                  }`}
                >
                  {t.navProfile}
                </button>
              </>
            )}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('notifications')}
              aria-label={t.navNotifications}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center border border-[#E5E7EB] rounded-lg hover:border-[#4F0000] relative cursor-pointer"
            >
              <Bell className="w-4 h-4 text-[#111111]" />
              {unreadCount > 0 && (
                <span className="ml-1 text-[11px] font-mono-tabular font-semibold text-[#4F0000]">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              className="min-h-[40px] px-3.5 bg-[#4F0000] text-white text-xs font-medium rounded-lg hover:bg-[#3B0000] whitespace-nowrap shrink-0 cursor-pointer"
            >
              {user.profile?.first_name || user.email}
            </button>
          </div>
        </div>
      </header>

      {/* Bandeau Simulation explicite */}
      <div className="bg-[#F8F8F9] border-b border-[#E5E7EB] px-4 py-1.5 text-center text-xs text-[#52525B]">
        {t.simBadge}
      </div>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {activeTab === 'dashboard' && (
          <DashboardView
            data={dashboard}
            loading={loadingDash}
            language={language}
            onNavigate={(tab) => setActiveTab(tab)}
          />
        )}
        {activeTab === 'savings' && <SavingsView dashboard={dashboard} onRefresh={loadDashboard} />}
        {activeTab === 'credit' && (
          <CreditView
            kycStatus={dashboard?.kyc?.status || 'NOT_STARTED'}
            onRefreshDashboard={loadDashboard}
            onGoToKyc={() => setActiveTab('kyc')}
          />
        )}
        {activeTab === 'kyc' && <KycView onStatusChanged={loadDashboard} />}
        {activeTab === 'assistant' && <AssistantView />}
        {activeTab === 'notifications' && <NotificationsView onRefreshDashboard={loadDashboard} />}
        {activeTab === 'profile' && (
          <ProfileView
            user={user}
            language={language}
            onChangeLanguage={setLanguage}
            onUserUpdated={setUser}
            onLogout={handleLogout}
          />
        )}
        {activeTab === 'admin' && isStaff && <AdminConsoleView currentUser={user} />}
      </main>

      {/* Mobile Bottom Tab Bar (ergonomie pouce < 15% hauteur viewport) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#E5E7EB] grid grid-cols-5 h-16">
        {(isStaff
          ? [
              { id: 'admin' as ClientTab, label: t.navAdmin, icon: ShieldCheck },
              { id: 'assistant' as ClientTab, label: t.navAssistant, icon: MessageSquare },
              { id: 'notifications' as ClientTab, label: t.navNotifications, icon: Bell },
              { id: 'profile' as ClientTab, label: t.navProfile, icon: User },
            ]
          : [
              { id: 'dashboard' as ClientTab, label: t.navDashboard, icon: Home },
              { id: 'savings' as ClientTab, label: t.navSavings, icon: PiggyBank },
              { id: 'credit' as ClientTab, label: t.navCredit, icon: CreditCard },
              { id: 'assistant' as ClientTab, label: t.navAssistant, icon: MessageSquare },
              { id: 'profile' as ClientTab, label: t.navProfile, icon: User },
            ]
        ).map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center gap-1 cursor-pointer ${
                active ? 'text-[#4F0000]' : 'text-[#52525B]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
