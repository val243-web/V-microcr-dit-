import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'vmicro_access_token';
const REFRESH_KEY = 'vmicro_refresh_token';
const BIO_ENABLED_KEY = 'vmicro_biometric_unlock_enabled';

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function saveAuthTokens(accessToken: string, refreshToken: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, accessToken, SECURE_OPTIONS);
  await SecureStore.setItemAsync(REFRESH_KEY, refreshToken, SECURE_OPTIONS);
}

export async function getAuthTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY, SECURE_OPTIONS),
    SecureStore.getItemAsync(REFRESH_KEY, SECURE_OPTIONS),
  ]);
  return { accessToken, refreshToken };
}

export async function clearAuthTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY, SECURE_OPTIONS),
    SecureStore.deleteItemAsync(REFRESH_KEY, SECURE_OPTIONS),
  ]);
}

export async function setBiometricUnlockEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIO_ENABLED_KEY, enabled ? '1' : '0', SECURE_OPTIONS);
}

export async function isBiometricUnlockEnabled(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(BIO_ENABLED_KEY, SECURE_OPTIONS);
  return v === '1';
}
