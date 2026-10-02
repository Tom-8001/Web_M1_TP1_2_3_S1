import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

/**
 * Test de garde : on vérifie la décision (laisser passer ou rediriger),
 * sans naviguer réellement.
 */
describe('authGuard', () => {
  let auth: AuthService;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });

    auth = TestBed.inject(AuthService);
  });

  afterEach(() => localStorage.clear());

  /** Exécute la garde dans le contexte d'injection de TestBed. */
  const runGuard = () =>
    TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/tracks' } as never),
    );

  it('redirige vers /login quand aucun jeton n’est présent', () => {
    auth.token.set(null);

    const result = runGuard();

    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe('/login');
  });

  it('laisse passer quand un jeton est présent', () => {
    auth.token.set('jeton-de-test');

    expect(runGuard()).toBe(true);
  });

  it('redirige à nouveau après une déconnexion', () => {
    auth.token.set('jeton-de-test');
    expect(runGuard()).toBe(true);

    auth.logout();

    expect(String(runGuard())).toBe('/login');
    // Le Router reste l'autorité : la garde ne fait que produire une UrlTree.
    expect(TestBed.inject(Router)).toBeTruthy();
  });
});
