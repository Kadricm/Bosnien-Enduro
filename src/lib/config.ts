const env = (k: string) => process.env[k] ?? import.meta.env[k] ?? '';

export const siteUrl = () => (env('PUBLIC_SITE_URL') || 'http://localhost:4321').replace(/\/$/, '');

/**
 * Kartenzahlung: 'monri' (Vertrag + Keys vorhanden), 'mock' (nur Demo, muss explizit gesetzt sein),
 * sonst 'off' → nur Banküberweisung. Nie stillschweigend auf mock zurückfallen!
 */
export const cardProvider = (): 'mock' | 'monri' | 'off' => {
  const p = env('PAYMENT_PROVIDER');
  if (p === 'monri') return env('MONRI_KEY') && env('MONRI_AUTHENTICITY_TOKEN') ? 'monri' : 'off';
  if (p === 'mock') return 'mock';
  return 'off';
};

export const bankDetails = () => ({
  name: env('BANK_NAME') || '— (Bank folgt)',
  iban: env('BANK_IBAN') || 'BA39 0000 0000 0000 0000', // Platzhalter für die Demo
  swift: env('BANK_SWIFT') || '—',
  holder: env('BANK_HOLDER') || 'bosnien-endurotours',
});

export const whatsapp = () => env('WHATSAPP_NUMBER') || '436601877869';
