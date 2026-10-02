import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpEventType } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TracksPageComponent } from './tracks-page';
import { authInterceptor } from '../../shared/interceptors/auth.interceptor';
import { Track } from '../../shared/models/track.model';

/**
 * Tests du composant bibliothèque : affichage, pagination, suppression,
 * progression d'upload et lecture.
 *
 * Toutes les réponses HTTP sont simulées : ni backend, ni MongoDB, ni réseau.
 */
describe('TracksPageComponent', () => {
  let fixture: ComponentFixture<TracksPageComponent>;
  let component: TracksPageComponent;
  let httpMock: HttpTestingController;

  /** SnackBar simulée : on teste le message, pas le rendu de l'overlay. */
  const snackBar = { open: vi.fn() };

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

  /**
   * Construit une réponse conforme au contrat enrichi du TP2 : les champs du
   * plugin `aggregate-paginate-v2` accompagnent ceux du contrat d'origine.
   */
  const pageOf = (items: Track[], page = 1, total = items.length, limit = 5) => {
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      items,
      page,
      limit,
      total,
      pages: totalPages,
      totalDocs: total,
      totalPages,
      pagingCounter: (page - 1) * limit + 1,
      hasPrevPage: page > 1,
      hasNextPage: page < totalPages,
      prevPage: page > 1 ? page - 1 : null,
      nextPage: page < totalPages ? page + 1 : null,
    };
  };

  beforeEach(() => {
    localStorage.clear();
    snackBar.open.mockClear();

    TestBed.configureTestingModule({
      imports: [TracksPageComponent],
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: snackBar },
      ],
    });

    fixture = TestBed.createComponent(TracksPageComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    // Le constructeur déclenche le premier chargement : on le solde tout de suite.
    // 12 pistes au total => 3 pages, de quoi tester la pagination.
    fixture.detectChanges();
    httpMock
      .expectOne((r) => r.url === '/api/tracks')
      .flush(pageOf([track], 1, 12));
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  /** Crée un événement `change` de champ fichier avec le fichier fourni. */
  const fileEvent = (file: File): Event => {
    const input = document.createElement('input');
    input.type = 'file';
    Object.defineProperty(input, 'files', { value: [file] });
    return { target: input } as unknown as Event;
  };

  it('affiche les pistes renvoyées par l’API', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Blues en La');
    expect(text).toContain('blues.mp3');
    expect(component.tracks().length).toBe(1);
  });

  it('affiche une erreur quand le chargement échoue', () => {
    component.load();
    httpMock
      .expectOne((r) => r.url === '/api/tracks')
      .flush({ message: 'Panne' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    // Le message du serveur est préféré au texte générique.
    expect(component.error()).toBe(
      'Impossible de charger la bibliothèque : Panne',
    );
    const banner = fixture.nativeElement.querySelector('[role="alert"]');
    expect(banner?.textContent).toContain('Panne');
  });

  it('affiche un message générique pour une erreur 500 sans corps', () => {
    component.load();
    httpMock
      .expectOne((r) => r.url === '/api/tracks')
      .flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.error()).toContain('erreur du serveur');
    expect(component.tracks().length).toBe(0);
  });

  it('change de page en renvoyant page=2 à l’API', () => {
    component.go(2);
    const request = httpMock.expectOne((r) => r.url === '/api/tracks');
    expect(request.request.params.get('page')).toBe('2');
    request.flush(pageOf([{ ...track, id: 'autre', title: 'Autre' }], 2, 12));
    fixture.detectChanges();

    expect(component.page()).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Autre');
  });

  it('supprime une piste via DELETE puis recharge la liste', () => {
    component.askDelete(track);
    expect(component.pendingDeleteId()).toBe(track.id);

    component.confirmDelete(track);

    const deleteRequest = httpMock.expectOne(`/api/tracks/${track.id}`);
    expect(deleteRequest.request.method).toBe('DELETE');
    deleteRequest.flush(null, { status: 204, statusText: 'No Content' });

    // La liste est rechargée après la suppression.
    httpMock.expectOne((r) => r.url === '/api/tracks').flush(pageOf([]));
    fixture.detectChanges();

    expect(component.tracks().length).toBe(0);
    expect(snackBar.open).toHaveBeenCalled();
  });

  it('gère une piste déjà supprimée (404) en actualisant la liste', () => {
    component.confirmDelete(track);

    httpMock
      .expectOne(`/api/tracks/${track.id}`)
      .flush({ message: 'Piste inconnue' }, { status: 404, statusText: 'Not Found' });

    httpMock.expectOne((r) => r.url === '/api/tracks').flush(pageOf([]));
    fixture.detectChanges();

    expect(component.deletingId()).toBeNull();
    expect(snackBar.open).toHaveBeenCalledWith(
      expect.stringContaining('n’existe plus'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('refuse un fichier invalide sans appeler l’API', () => {
    const document_txt = new File(['texte'], 'notes.txt', { type: 'text/plain' });

    component.choose(fileEvent(document_txt));
    fixture.detectChanges();

    expect(component.selectedFile()).toBeNull();
    expect(component.fileError()).toContain('Format non accepté');
    httpMock.expectNone('/api/tracks');
  });

  it('met à jour la progression puis affiche l’erreur d’upload', () => {
    const file = new File(['audio'], 'morceau.mp3', { type: 'audio/mpeg' });
    component.choose(fileEvent(file));
    expect(component.selectedFile()).toBe(file);

    component.upload();
    expect(component.uploadPhase()).toBe('uploading');

    const request = httpMock.expectOne('/api/tracks');
    expect(request.request.method).toBe('POST');

    request.event({
      type: HttpEventType.UploadProgress,
      loaded: 50,
      total: 100,
    });
    fixture.detectChanges();
    expect(component.uploadPercent()).toBe(50);
    expect(fixture.nativeElement.textContent).toContain('50 %');

    request.flush(
      { message: 'Fichier audio requis' },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();

    expect(component.uploadPhase()).toBe('error');
    expect(component.uploadError()).toContain('Fichier audio requis');
  });

  it('vide le formulaire et revient à la page 1 après un upload réussi', () => {
    const file = new File(['audio'], 'morceau.mp3', { type: 'audio/mpeg' });
    component.choose(fileEvent(file));
    component.title.setValue('Nouveau morceau');

    component.page.set(2);
    component.upload();

    const request = httpMock.expectOne('/api/tracks');
    request.flush(track);

    expect(component.uploadPhase()).toBe('success');
    expect(component.selectedFile()).toBeNull();
    expect(component.title.value).toBe('');
    expect(component.page()).toBe(1);

    httpMock.expectOne((r) => r.url === '/api/tracks').flush(pageOf([track]));
    fixture.detectChanges();

    expect(snackBar.open).toHaveBeenCalled();
  });

  it('envoie le filtre au serveur et repart de la page 1', async () => {
    component.page.set(2);

    component.search.setValue('blues');
    // debounceTime(300) : on laisse passer le délai avant d'observer la requête.
    await new Promise((resolve) => setTimeout(resolve, 350));

    const request = httpMock.expectOne((r) => r.url === '/api/tracks');
    expect(request.request.params.get('q')).toBe('blues');
    // Une recherche change le résultat : la page courante n'a plus de sens.
    expect(request.request.params.get('page')).toBe('1');

    request.flush(pageOf([track], 1, 1));
    fixture.detectChanges();

    expect(component.query()).toBe('blues');
    expect(fixture.nativeElement.textContent).toContain('Filtre actif');
  });

  it('utilise les bornes de pagination calculées par le serveur', () => {
    component.go(3);
    const request = httpMock.expectOne((r) => r.url === '/api/tracks');
    request.flush(pageOf([track], 3, 12));
    fixture.detectChanges();

    // Dernière page : « Suivant » est désactivé, « Précédent » ne l'est plus.
    expect(component.hasPrevPage()).toBe(true);
    expect(component.hasNextPage()).toBe(false);

    const buttons = fixture.nativeElement.querySelectorAll('.pager button');
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
  });

  it('refuse une image de couverture invalide sans appeler l’API', () => {
    const pdf = new File(['document'], 'scan.pdf', { type: 'application/pdf' });

    component.chooseCover(fileEvent(pdf));
    fixture.detectChanges();

    expect(component.selectedCover()).toBeNull();
    expect(component.coverError()).toContain('Format d’image non accepté');
    httpMock.expectNone('/api/tracks');
  });

  it('joint la couverture au FormData quand elle est fournie', () => {
    const file = new File(['audio'], 'morceau.mp3', { type: 'audio/mpeg' });
    const cover = new File(['image'], 'pochette.png', { type: 'image/png' });

    component.choose(fileEvent(file));
    component.chooseCover(fileEvent(cover));
    expect(component.selectedCover()).toBe(cover);

    component.upload();

    const request = httpMock.expectOne('/api/tracks');
    const body = request.request.body as FormData;
    expect(body.get('cover')).toBe(cover);

    request.flush(track);
    httpMock.expectOne((r) => r.url === '/api/tracks').flush(pageOf([track]));
    fixture.detectChanges();

    // Le formulaire est vidé, couverture comprise.
    expect(component.selectedCover()).toBeNull();
  });

  it('charge la vignette via un Blob et libère son URL à la destruction', () => {
    const createObjectURL = vi.fn(() => 'blob:cover-url');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const withCover: Track = {
      ...track,
      hasCover: true,
      coverMimeType: 'image/png',
    };

    component.load();
    httpMock.expectOne((r) => r.url === '/api/tracks').flush(pageOf([withCover], 1, 1));
    fixture.detectChanges();

    const coverRequest = httpMock.expectOne(`/api/tracks/${track.id}/cover`);
    expect(coverRequest.request.responseType).toBe('blob');
    coverRequest.flush(new Blob(['image'], { type: 'image/png' }));
    fixture.detectChanges();

    expect(component.covers()[track.id]).toBe('blob:cover-url');
    expect(fixture.nativeElement.querySelector('img.cover')).toBeTruthy();

    fixture.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cover-url');
  });

  it('lit une piste en Blob et libère l’URL d’objet précédente', () => {
    const createObjectURL = vi.fn(() => 'blob:test-url');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    component.play(track);
    httpMock
      .expectOne(`/api/tracks/${track.id}/audio`)
      .flush(new Blob(['audio']));
    fixture.detectChanges();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(component.audioUrl()).toBe('blob:test-url');
    expect(component.playingId()).toBe(track.id);

    // Deuxième lecture : l'ancienne URL doit être révoquée avant la nouvelle.
    component.play(track);
    httpMock
      .expectOne(`/api/tracks/${track.id}/audio`)
      .flush(new Blob(['audio']));
    fixture.detectChanges();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    expect(createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('libère l’URL d’objet à la destruction du composant', () => {
    const createObjectURL = vi.fn(() => 'blob:test-url');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    component.play(track);
    httpMock
      .expectOne(`/api/tracks/${track.id}/audio`)
      .flush(new Blob(['audio']));

    fixture.destroy();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });
});
