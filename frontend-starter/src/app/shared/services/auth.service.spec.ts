import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { AuthResponse } from '../models/auth-response.model';

/**
 * Test unitaire du service d'authentification.
 * Le backend et MongoDB ne sont jamais sollicités : `HttpTestingController`
 * intercepte la requête et rejoue une réponse simulée.
 */
describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  const response: AuthResponse = {
    token: 'jeton-de-test',
    user: {
      id: '65f000000000000000000001',
      name: 'Demo',
      email: 'demo@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('login() envoie POST /api/auth/login avec le corps attendu', () => {
    let received: AuthResponse | undefined;
    service.login('demo@example.com', 'Demo1234!').subscribe((result) => {
      received = result;
    });

    const request = httpMock.expectOne('/api/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      email: 'demo@example.com',
      password: 'Demo1234!',
    });

    request.flush(response);

    expect(received?.token).toBe('jeton-de-test');
  });

  it('login() mémorise le jeton et l’utilisateur courant', () => {
    service.login('demo@example.com', 'Demo1234!').subscribe();
    httpMock.expectOne('/api/auth/login').flush(response);

    expect(service.token()).toBe('jeton-de-test');
    expect(service.currentUser()?.name).toBe('Demo');
    // Persistance : le jeton survit à un rechargement de page.
    expect(localStorage.getItem('gpc_token')).toBe('jeton-de-test');
  });

  it('login() ne modifie rien en cas d’échec (401)', () => {
    let status = 0;
    service.login('demo@example.com', 'mauvais').subscribe({
      error: (error: { status: number }) => {
        status = error.status;
      },
    });

    httpMock
      .expectOne('/api/auth/login')
      .flush({ message: 'Identifiants incorrects' }, { status: 401, statusText: 'Unauthorized' });

    expect(status).toBe(401);
    expect(service.token()).toBeNull();
    expect(localStorage.getItem('gpc_token')).toBeNull();
  });

  it('logout() efface le jeton du stockage et de l’état', () => {
    service.token.set('jeton-de-test');
    localStorage.setItem('gpc_token', 'jeton-de-test');

    service.logout();

    expect(service.token()).toBeNull();
    expect(service.currentUser()).toBeNull();
    expect(localStorage.getItem('gpc_token')).toBeNull();
  });
});
