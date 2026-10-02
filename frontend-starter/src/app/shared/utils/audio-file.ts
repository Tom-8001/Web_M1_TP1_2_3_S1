import { formatBytes } from './format';

/**
 * Règles de validation d'un fichier audio, volontairement identiques à celles
 * appliquées par le backend (Multer : `limits.fileSize` et `fileFilter`).
 *
 * Le frontend les duplique pour donner un retour immédiat à l'utilisateur,
 * sans consommer de bande passante. Le backend reste la seule autorité :
 * un client peut être contourné, pas le serveur.
 */
export const MAX_AUDIO_SIZE = 25 * 1024 * 1024;

/** Libellé lisible de la limite, utilisé dans les messages et les aides. */
export const MAX_AUDIO_SIZE_LABEL = '25 Mo';

export const ALLOWED_AUDIO_MIME_TYPES: readonly string[] = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
];

export const ALLOWED_AUDIO_EXTENSIONS: readonly string[] = [
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
];

/**
 * Valide un fichier avant l'appel HTTP.
 * Renvoie `null` si le fichier est acceptable, sinon le message à afficher.
 */
export function validateAudioFile(file: File): string | null {
  const lastDot = file.name.lastIndexOf('.');
  const extension =
    lastDot === -1 ? '' : file.name.slice(lastDot).toLowerCase();

  const extensionAllowed = ALLOWED_AUDIO_EXTENSIONS.includes(extension);
  const mimeAllowed = ALLOWED_AUDIO_MIME_TYPES.includes(
    file.type.toLowerCase(),
  );

  // Certains systèmes ne renseignent pas le type MIME : l'extension sert alors
  // de second critère. Il faut que l'un des deux corresponde.
  if (!extensionAllowed && !mimeAllowed) {
    const detected = file.type || extension || 'type inconnu';
    return `Format non accepté (${detected}). Formats autorisés : MP3, WAV, OGG, M4A.`;
  }

  if (file.size === 0) {
    return 'Le fichier sélectionné est vide.';
  }

  if (file.size > MAX_AUDIO_SIZE) {
    return `Fichier trop volumineux : ${formatBytes(file.size)}. La limite est de ${MAX_AUDIO_SIZE_LABEL}.`;
  }

  return null;
}
