import { formatBytes } from './format';

/**
 * Règles de validation d'une image de couverture (bonus TP2), volontairement
 * identiques à celles du backend : `fileFilter` accepte ces quatre types MIME
 * et la route refuse au-delà de 2 Mo.
 *
 * Comme pour l'audio, le frontend les duplique pour donner un retour immédiat
 * sans consommer de bande passante. Le backend reste la seule autorité.
 */
export const MAX_COVER_SIZE = 2 * 1024 * 1024;

/** Libellé lisible de la limite, utilisé dans les messages et les aides. */
export const MAX_COVER_SIZE_LABEL = '2 Mo';

export const ALLOWED_COVER_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

export const ALLOWED_COVER_EXTENSIONS: readonly string[] = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
];

/**
 * Valide une image avant l'appel HTTP.
 * Renvoie `null` si l'image est acceptable, sinon le message à afficher.
 */
export function validateCoverFile(file: File): string | null {
  const lastDot = file.name.lastIndexOf('.');
  const extension =
    lastDot === -1 ? '' : file.name.slice(lastDot).toLowerCase();

  const extensionAllowed = ALLOWED_COVER_EXTENSIONS.includes(extension);
  const mimeAllowed = ALLOWED_COVER_MIME_TYPES.includes(
    file.type.toLowerCase(),
  );

  // Certains systèmes ne renseignent pas le type MIME : l'extension sert alors
  // de second critère. Il faut que l'un des deux corresponde.
  if (!extensionAllowed && !mimeAllowed) {
    const detected = file.type || extension || 'type inconnu';
    return `Format d’image non accepté (${detected}). Formats autorisés : JPG, PNG, WEBP, GIF.`;
  }

  if (file.size === 0) {
    return 'L’image sélectionnée est vide.';
  }

  if (file.size > MAX_COVER_SIZE) {
    return `Image trop volumineuse : ${formatBytes(file.size)}. La limite est de ${MAX_COVER_SIZE_LABEL}.`;
  }

  return null;
}