import * as LocalAuthentication from 'expo-local-authentication';

export interface BiometricResult {
  success: boolean;
  hardwareAvailable: boolean;
  enrolled: boolean;
  error?: string;
}

// Utilise exclusivement le BiometricPrompt natif Android / FaceID iOS.
// Ne collecte JAMAIS d'image d'empreinte digitale.
export async function authenticateWithDeviceBiometrics(promptMessage = 'Confirmez votre identité V-Micro Crédit'): Promise<BiometricResult> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) {
    return {
      success: false,
      hardwareAvailable: false,
      enrolled: false,
      error: 'Aucun capteur biométrique détecté sur cet appareil. Utilisez le code PIN ou le parcours alternatif.',
    };
  }

  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  if (!isEnrolled) {
    return {
      success: false,
      hardwareAvailable: true,
      enrolled: false,
      error: 'Aucune empreinte ou biométrie configurée dans les paramètres Android.',
    };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Annuler',
    fallbackLabel: 'Utiliser le code appareil',
    disableDeviceFallback: false,
  });

  return {
    success: result.success,
    hardwareAvailable: true,
    enrolled: true,
    error: result.success ? undefined : 'Authentification biométrique annulée ou échouée.',
  };
}
