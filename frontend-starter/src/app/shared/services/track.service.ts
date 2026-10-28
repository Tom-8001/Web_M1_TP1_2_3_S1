import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Page } from '../models/page.model';
import { Track } from '../models/track.model';

/**
 * Point d'entrée unique du frontend vers `/api/tracks`.
 *
 * Aucun composant ne touche `HttpClient` : ils passent tous par ce service,
 * ce qui garde les URL, les paramètres et les en-têtes à un seul endroit.
 */
@Injectable({ providedIn: 'root' })
export class TrackService {
  private readonly http = inject(HttpClient);

  /**
   * Une page de la bibliothèque de l'utilisateur connecté.
   *
   * `page` et `limit` sont réellement transmis en paramètres de requête :
   * la pagination est faite par le serveur (agrégation paginée côté Mongoose),
   * jamais en découpant un tableau complet dans le navigateur.
   *
   * Bonus « filtre par titre » : `q` est transmis au serveur, qui filtre
   * l'ensemble de la bibliothèque avant de paginer. Filtrer localement ne
   * porterait que sur la page affichée, ce qui donnerait un résultat faux.
   */
  list(page = 1, limit = 5, q = ''): Observable<Page<Track>> {
    let params = new HttpParams().set('page', page).set('limit', limit);

    const search = q.trim();
    if (search) {
      params = params.set('q', search);
    }

    return this.http.get<Page<Track>>('/api/tracks', { params });
  }

  /**
   * Envoie un fichier audio en multipart/form-data.
   *
   * `observe: 'events'` fait remonter toute la vie de la requête
   * (`Sent`, `UploadProgress`, `Response`) et non seulement la réponse finale :
   * c'est ce qui permet d'afficher un pourcentage d'avancement.
   * `reportProgress: true` est obligatoire pour recevoir ces événements.
   */
  upload(
    file: File,
    title: string,
    cover: File | null = null,
  ): Observable<HttpEvent<Track>> {
    const body = new FormData();
    body.append('audio', file);
    body.append('title', title);

    // Bonus « image de couverture » : le champ n'est ajouté que s'il est
    // renseigné. Le serveur accepte les deux fichiers dans la même requête.
    if (cover) {
      body.append('cover', cover);
    }

    return this.http.post<Track>('/api/tracks', body, {
      observe: 'events',
      reportProgress: true,
    });
  }

  /**
   * Récupère les octets d'une piste sous forme de `Blob`.
   *
   * `responseType: 'blob'` est indispensable : la réponse est un flux audio,
   * pas du JSON. Le JWT est ajouté par `authInterceptor`, ce qui n'est possible
   * que parce que la requête passe par `HttpClient`.
   */
  audio(id: string): Observable<Blob> {
    return this.http.get(`/api/tracks/${id}/audio`, {
      responseType: 'blob',
    });
  }

  /**
   * Récupère l'image de couverture sous forme de `Blob` (bonus TP2).
   *
   * Même raison que pour l'audio : la route est protégée par le JWT, donc
   * l'image passe par `HttpClient` en `responseType: 'blob'`. Une balise
   * `<img src="/api/tracks/:id/cover">` ne saurait pas transmettre l'en-tête
   * `Authorization` et recevrait systématiquement un 401.
   */
  cover(id: string): Observable<Blob> {
    return this.http.get(`/api/tracks/${id}/cover`, {
      responseType: 'blob',
    });
  }

  /** Supprime la métadonnée et le fichier correspondant (réponse `204`). */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`/api/tracks/${id}`);
  }
}
