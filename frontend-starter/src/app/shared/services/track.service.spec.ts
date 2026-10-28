import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { HttpEvent, HttpEventType, provideHttpClient } from '@angular/common/http';
import { TrackService } from './track.service';
import { Track } from '../models/track.model';

/**
 * Tests unitaires de l'accès aux pistes : URL, méthode, paramètres, type de
 * réponse. Aucun serveur n'est nécessaire.
 */
describe('TrackService', () => {
  let service: TrackService;
  let httpMock: HttpTestingController;

  const track: Track = {
    id: '65f000000000000000000002',
    title: 'Blues en La',
    originalName: 'blues.mp3',
    mimeType: 'audio/mpeg',
    size: 4096,
    createdAt: '2026-01-02T10:00:00.000Z',
    hasCover: false,
    coverMimeType: null,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(TrackService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('list() transmet réellement page et limit', () => {
    service.list(3, 10).subscribe();

    const request = httpMock.expectOne((r) => r.url === '/api/tracks');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('page')).toBe('3');
    expect(request.request.params.get('limit')).toBe('10');

    request.flush({ items: [track], page: 3, limit: 10, total: 21, pages: 3 });
  });

  it('list() utilise les valeurs par défaut page=1 et limit=5', () => {
    service.list().subscribe();

    const request = httpMock.expectOne((r) => r.url === '/api/tracks');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('limit')).toBe('5');

    request.flush({ items: [], page: 1, limit: 5, total: 0, pages: 1 });
  });

  it('upload() construit un FormData avec exactement audio et title', () => {
    const file = new File(['contenu-audio'], 'morceau.mp3', {
      type: 'audio/mpeg',
    });

    service.upload(file, 'Morceau').subscribe();

    const request = httpMock.expectOne('/api/tracks');
    expect(request.request.method).toBe('POST');

    const body = request.request.body as FormData;
    expect(body instanceof FormData).toBe(true);
    expect(body.get('audio')).toBe(file);
    expect(body.get('title')).toBe('Morceau');
    // Aucun en-tête Content-Type manuel : le navigateur doit poser lui-même
    // le boundary du multipart/form-data.
    expect(request.request.headers.has('Content-Type')).toBe(false);

    request.flush(track);
  });

  it('upload() demande les événements de progression', () => {
    const file = new File(['contenu-audio'], 'morceau.mp3', {
      type: 'audio/mpeg',
    });
    const events: number[] = [];

    service.upload(file, 'Morceau').subscribe((event: HttpEvent<Track>) => {
      events.push(event.type);
    });

    const request = httpMock.expectOne('/api/tracks');
    expect(request.request.reportProgress).toBe(true);

    request.event({
      type: HttpEventType.UploadProgress,
      loaded: 50,
      total: 100,
    });
    request.flush(track);

    expect(events).toContain(HttpEventType.UploadProgress);
    expect(events).toContain(HttpEventType.Response);
  });

  it('list() transmet le filtre q quand il est renseigné', () => {
    service.list(1, 5, '  blues  ').subscribe();

    const request = httpMock.expectOne((r) => r.url === '/api/tracks');
    // Les espaces autour du terme sont retirés avant l'envoi.
    expect(request.request.params.get('q')).toBe('blues');

    request.flush({ items: [], page: 1, limit: 5, total: 0, pages: 1 });
  });

  it('list() omet q quand la recherche est vide', () => {
    service.list(1, 5, '   ').subscribe();

    const request = httpMock.expectOne((r) => r.url === '/api/tracks');
    expect(request.request.params.has('q')).toBe(false);

    request.flush({ items: [], page: 1, limit: 5, total: 0, pages: 1 });
  });

  it('upload() ajoute le champ cover quand une image est fournie', () => {
    const file = new File(['contenu-audio'], 'morceau.mp3', {
      type: 'audio/mpeg',
    });
    const cover = new File(['image'], 'pochette.png', { type: 'image/png' });

    service.upload(file, 'Morceau', cover).subscribe();

    const request = httpMock.expectOne('/api/tracks');
    const body = request.request.body as FormData;
    expect(body.get('audio')).toBe(file);
    expect(body.get('cover')).toBe(cover);

    request.flush(track);
  });

  it('upload() n’ajoute pas de champ cover quand il n’y en a pas', () => {
    const file = new File(['contenu-audio'], 'morceau.mp3', {
      type: 'audio/mpeg',
    });

    service.upload(file, 'Morceau').subscribe();

    const request = httpMock.expectOne('/api/tracks');
    const body = request.request.body as FormData;
    expect(body.get('cover')).toBeNull();

    request.flush(track);
  });

  it('cover() demande un Blob sur /api/tracks/:id/cover', () => {
    service.cover(track.id).subscribe();

    const request = httpMock.expectOne(`/api/tracks/${track.id}/cover`);
    expect(request.request.method).toBe('GET');
    // L'image est protégée par le JWT : elle doit passer par HttpClient.
    expect(request.request.responseType).toBe('blob');

    request.flush(new Blob(['image'], { type: 'image/png' }));
  });

  it('audio() demande un Blob, pas du JSON', () => {
    service.audio(track.id).subscribe();

    const request = httpMock.expectOne(`/api/tracks/${track.id}/audio`);
    expect(request.request.method).toBe('GET');
    expect(request.request.responseType).toBe('blob');

    request.flush(new Blob(['audio']));
  });

  it('remove() appelle DELETE /api/tracks/:id', () => {
    let completed = false;
    service.remove(track.id).subscribe({ complete: () => (completed = true) });

    const request = httpMock.expectOne(`/api/tracks/${track.id}`);
    expect(request.request.method).toBe('DELETE');

    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(completed).toBe(true);
  });
});
