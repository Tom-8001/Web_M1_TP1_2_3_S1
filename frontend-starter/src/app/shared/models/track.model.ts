/** Audio track metadata returned by the API. */
export interface Track {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  /**
   * Bonus « image de couverture » : vrai si une pochette accompagne la piste.
   * Le serveur n'expose jamais le nom du fichier image, seulement sa présence
   * et son type MIME. L'image se récupère via `GET /api/tracks/:id/cover`,
   * route protégée par le JWT.
   */
  hasCover: boolean;
  coverMimeType: string | null;
}
