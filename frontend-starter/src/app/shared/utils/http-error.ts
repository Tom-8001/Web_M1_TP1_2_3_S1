import { HttpErrorResponse } from '@angular/common/http';

/**
 * Transforme une erreur HTTP en message compréhensible pour l'utilisateur.
 *
 * Le message du serveur est utilisé quand il existe : c'est lui qui connaît la
 * vraie cause (format refusé, piste inconnue, fichier trop volumineux…).
 * Sinon on retombe sur un texte générique et sur le code de statut.
 */
export function describeHttpError(
  error: HttpErrorResponse,
  fallback: string,
): string {
  const serverMessage = readServerMessage(error.error);

  if (error.status === 0) {
    return `${fallback} : le serveur est injoignable (backend arrêté ou hors ligne).`;
  }

  if (error.status === 401) {
    return 'Votre session a expiré, veuillez vous reconnecter.';
  }

  if (error.status === 404) {
    return serverMessage ?? 'Cette ressource n’existe plus.';
  }

  if (error.status === 400) {
    return serverMessage ?? 'Les données envoyées sont invalides.';
  }

  if (error.status === 413) {
    return serverMessage ?? 'Le fichier envoyé est trop volumineux.';
  }

  if (serverMessage) {
    return `${fallback} : ${serverMessage}`;
  }

  if (error.status >= 500) {
    return `${fallback} : erreur du serveur (code ${error.status}).`;
  }

  return `${fallback} (code ${error.status}).`;
}

/**
 * Lit `{ message: "…" }` dans un corps d'erreur JSON.
 * Un corps non JSON (Blob, texte vide) est simplement ignoré.
 */
export function readServerMessage(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }

  return null;
}
