import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';

/**
 * Test d'intercepteur : on vérifie ce que le client HTTP reçoit réellement
 * comme en-têtes, sans backend.
 */
describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('ajoute Authorization: Bearer quand un jeton existe', () => {
    auth.token.set('jeton-de-test');

    http.get('/api/tracks').subscribe();

    const request = httpMock.expectOne('/api/tracks');
    expect(request.request.headers.get('Authorization')).toBe(
      'Bearer jeton-de-test',
    );

    request.flush({});
  });

  it('n’ajoute aucun en-tête Authorization sans jeton', () => {
    auth.token.set(null);

    http.post('/api/auth/login', { email: 'a@b.c' }).subscribe();

    const request = httpMock.expectOne('/api/auth/login');
    expect(request.request.headers.has('Authorization')).toBe(false);

    request.flush({});
  });

  it('ajoute l’en-tête aux requêtes non JSON (audio en Blob)', () => {
    auth.token.set('jeton-de-test');

    http.get('/api/tracks/abc/audio', { responseType: 'blob' }).subscribe();

    const request = httpMock.expectOne('/api/tracks/abc/audio');
    expect(request.request.headers.get('Authorization')).toBe(
      'Bearer jeton-de-test',
    );

    request.flush(new Blob(['audio']));
  });
});
