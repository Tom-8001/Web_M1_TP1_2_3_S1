/**
 * Generic paginated response used by the tracks endpoint.
 *
 * Les cinq premiers champs sont ceux du contrat du TP2. Les suivants sont
 * fournis en plus par le plugin `aggregate-paginate-v2` (bonus TP2) : le
 * serveur calcule lui-même ces métadonnées, le frontend n'a pas à les déduire
 * de `total` et `limit`.
 */
export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  /** Nombre total de documents (nom natif du plugin). */
  totalDocs: number;
  /** Nombre total de pages (nom natif du plugin). */
  totalPages: number;
  /** Rang du premier document de la page dans la collection complète. */
  pagingCounter: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
  prevPage: number | null;
  nextPage: number | null;
}
