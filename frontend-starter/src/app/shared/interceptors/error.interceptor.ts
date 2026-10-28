import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Gère le statut 401 renvoyé par les routes protégées.
 * Un 401 signifie que le token est absent, invalide ou expiré : on nettoie
 * l'état local et on renvoie l'utilisateur vers /login.
 *
 * Les routes /api/auth/… sont exclues : un 401 sur /api/auth/login correspond
 * simplement à de mauvais identifiants, pas à une session expirée. On laisse
 * alors la page de connexion afficher son message d'erreur.
 */
export const errorInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      const isAuthEndpoint = request.url.includes('/api/auth/');

      if (error.status === 401 && !isAuthEndpoint) {
        console.warn('[errorInterceptor] 401 : token invalide ou expiré, retour à /login');
        auth.logout();
        if (router.url !== '/login') {
          void router.navigateByUrl('/login');
        }
      }

      // On relance l'erreur pour que le composant appelant puisse la traiter.
      return throwError(() => error);
    }),
  );
};
