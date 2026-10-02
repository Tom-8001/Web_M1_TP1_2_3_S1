/**
 * Petites fonctions de présentation partagées.
 * Elles n'ont aucun état : elles transforment une valeur technique en texte
 * lisible par l'utilisateur (taille, date, format audio).
 */

/** Convertit une taille en octets en texte lisible (« 1.2 Mo »). */
export function formatBytes(sizeInBytes: number): string {
  if (!Number.isFinite(sizeInBytes) || sizeInBytes <= 0) {
    return '0 o';
  }

  const units = ['o', 'Ko', 'Mo', 'Go'];
  let value = sizeInBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

/** Convertit une date ISO renvoyée par l'API en date française lisible. */
export function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return 'date inconnue';
  }

  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/** Traduit un type MIME audio en nom de format court (« MP3 »). */
export function audioFormatLabel(mimeType: string): string {
  const labels: Record<string, string> = {
    'audio/mpeg': 'MP3',
    'audio/mp3': 'MP3',
    'audio/wav': 'WAV',
    'audio/x-wav': 'WAV',
    'audio/wave': 'WAV',
    'audio/ogg': 'OGG',
    'audio/mp4': 'M4A',
    'audio/x-m4a': 'M4A',
    'audio/m4a': 'M4A',
  };

  return labels[mimeType?.toLowerCase()] ?? (mimeType || 'audio');
}

/** Affiche une durée en secondes sous la forme « 1 min 05 s ». */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '0 s';
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return minutes > 0
    ? `${minutes} min ${String(seconds).padStart(2, '0')} s`
    : `${seconds} s`;
}
