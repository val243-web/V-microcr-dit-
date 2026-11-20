import React, { useEffect, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { apiRequest } from '../api/client';
import type { NotificationItem } from '../types/vmicro';

interface NotifPrefs {
  push_enabled: number;
  savings_alerts: number;
  loan_updates: number;
  repayment_reminders: number;
  security_alerts: number;
  financial_tips: number;
}

export function NotificationsView({ onRefreshDashboard }: { onRefreshDashboard: () => void }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadNotifications() {
    setLoading(true);
    try {
      const res = await apiRequest<{ notifications: NotificationItem[]; preferences: NotifPrefs }>('/notifications');
      setNotifications(res.notifications);
      setPrefs(res.preferences);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNotifications();
  }, []);

  async function markRead(id: string) {
    await apiRequest(`/notifications/${id}/read`, { method: 'PUT' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
    onRefreshDashboard();
  }

  async function togglePref(key: keyof NotifPrefs) {
    if (!prefs) return;
    const nextVal = prefs[key] === 1 ? false : true;
    const res = await apiRequest<{ preferences: NotifPrefs }>('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify({ [key]: nextVal }),
    });
    setPrefs(res.preferences);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8 border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4">
        <h2 className="font-display text-lg font-bold text-[#111111]">Centre de notifications</h2>
        {loading ? (
          <p className="text-sm text-[#52525B]">Chargement...</p>
        ) : notifications.length === 0 ? (
          <p className="text-sm text-[#52525B]">Aucune notification.</p>
        ) : (
          <div className="divide-y divide-[#E5E7EB]">
            {notifications.map((n) => (
              <div key={n.id} className="py-3.5 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Bell className={`w-4 h-4 mt-1 shrink-0 ${n.read === 0 ? 'text-[#4F0000]' : 'text-[#52525B]'}`} />
                  <div>
                    <p className={`text-sm ${n.read === 0 ? 'font-semibold text-[#111111]' : 'font-medium text-[#52525B]'}`}>
                      {n.title}
                    </p>
                    <p className="text-xs text-[#52525B] mt-1 leading-relaxed">{n.message}</p>
                    <p className="text-[11px] text-[#52525B] mt-1 font-mono-tabular">
                      {n.category} · {n.created_at.slice(0, 16).replace('T', ' ')}
                    </p>
                  </div>
                </div>
                {n.read === 0 && (
                  <button
                    type="button"
                    onClick={() => markRead(n.id)}
                    className="px-2.5 py-1.5 border border-[#E5E7EB] hover:border-[#4F0000] rounded text-xs inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Lu
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="lg:col-span-4 border border-[#E5E7EB] rounded-xl p-5 bg-white space-y-4 h-fit">
        <h3 className="font-display text-base font-semibold text-[#111111]">Préférences d’alertes</h3>
        {prefs && (
          <div className="space-y-3 text-sm">
            {(
              [
                ['push_enabled', 'Notifications Push'],
                ['savings_alerts', 'Alertes d’épargne & dépôts'],
                ['loan_updates', 'Suivi des demandes de crédit'],
                ['repayment_reminders', 'Rappels d’échéances'],
                ['security_alerts', 'Alertes de sécurité'],
                ['financial_tips', 'Conseils d’éducation financière'],
              ] as Array<[keyof NotifPrefs, string]>
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between py-1.5 border-b border-[#E5E7EB] last:border-b-0 cursor-pointer">
                <span className="text-xs text-[#111111]">{label}</span>
                <input
                  type="checkbox"
                  checked={prefs[key] === 1}
                  onChange={() => togglePref(key)}
                  className="accent-[#4F0000] w-4 h-4"
                />
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
