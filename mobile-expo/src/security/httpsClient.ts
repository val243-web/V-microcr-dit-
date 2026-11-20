import { clearAuthTokens, getAuthTokens, saveAuthTokens } from './secureStorage';

const DEFAULT_PROD_API =
  'https://ais-dev-ypt2be35uniibdgvlmkj3f-646904106584.us-west2.run.app';

type SessionExpiredListener = () => void;
let sessionExpiredListener: SessionExpiredListener | null = null;

export function setOnSessionExpired(listener: SessionExpiredListener | null) {
  sessionExpiredListener = listener;
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function resolveSecureApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL || DEFAULT_PROD_API;
  const isDevLocal =
    configured.startsWith('http://10.0.2.2') || configured.startsWith('http://localhost');

  if (!configured.startsWith('https://') && !isDevLocal) {
    throw new Error('Sécurité transport : toute URL de production doit obligatoirement utiliser HTTPS.');
  }
  return configured.replace(/\/$/, '');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 25000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Délai réseau dépassé (25 s). Vérifiez votre connexion Internet.');
    }
    throw new Error('Connexion au serveur impossible. Vérifiez votre connexion Internet ou l’URL HTTPS configurée.');
  } finally {
    clearTimeout(timer);
  }
}

export async function mobileApiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = resolveSecureApiBaseUrl();
  const { accessToken, refreshToken } = await getAuthTokens();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Platform': 'android-expo',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response = await fetchWithTimeout(`${baseUrl}/api/v1${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && refreshToken && !path.startsWith('/auth/')) {
    const refreshRes = await fetchWithTimeout(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (refreshRes.ok) {
      const tokens = (await refreshRes.json()) as { accessToken: string; refreshToken: string };
      await saveAuthTokens(tokens.accessToken, tokens.refreshToken);
      headers['Authorization'] = `Bearer ${tokens.accessToken}`;
      response = await fetchWithTimeout(`${baseUrl}/api/v1${path}`, { ...options, headers });
    } else {
      await clearAuthTokens();
      if (sessionExpiredListener) {
        sessionExpiredListener();
      }
      throw new Error('Votre session a expiré. Veuillez vous reconnecter.');
    }
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || `Erreur serveur HTTP ${response.status}`);
  }
  return data as T;
}
