import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChild,
  ElementRef,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Track } from '../../shared/models/track.model';
import { TrackService } from '../../shared/services/track.service';
import {
  audioFormatLabel,
  formatBytes,
  formatDate,
} from '../../shared/utils/format';
import {
  MAX_AUDIO_SIZE_LABEL,
  validateAudioFile,
} from '../../shared/utils/audio-file';
import {
  MAX_COVER_SIZE_LABEL,
  validateCoverFile,
} from '../../shared/utils/cover-file';
import { describeHttpError } from '../../shared/utils/http-error';

/**
 * Les quatre états possibles d'un envoi de fichier.
 * Ils sont explicites plutôt que déduits de plusieurs booléens : c'est ce qui
 * permet d'afficher « en cours / réussi / échoué » sans cas incohérent.
 */
export type UploadPhase = 'idle' | 'uploading' | 'success' | 'error';

@Component({
  imports: [ReactiveFormsModule, MatPaginatorModule, MatProgressBarModule],
  templateUrl: './tracks-page.html',
  styleUrl: './tracks-page.css',
})
export class TracksPageComponent {
  private readonly service = inject(TrackService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fileInput =
    viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  private readonly coverInput =
    viewChild.required<ElementRef<HTMLInputElement>>('coverInput');

  /* ------------------------------------------------------------------ */
  /* Mission 2 — bibliothèque paginée (état)                             */
  /* ------------------------------------------------------------------ */

  /** Pistes de la page courante, uniquement celles de l'utilisateur connecté. */
  readonly tracks = signal<Track[]>([]);
  /** Page affichée, en base 1 comme l'API (`?page=1`). */
  readonly page = signal(1);
  /** Nombre de pistes par page, transmis à l'API (`?limit=5`). */
  readonly limit = signal(5);
  /** Nombre total de pages calculé par le serveur. */
  readonly pages = signal(1);
  /** Nombre total de pistes de l'utilisateur, utilisé par le paginator. */
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly pageSizeOptions: number[] = [5, 10, 20];

  /* ------------------------------------------------------------------ */
  /* Bonus TP2 — filtre par titre                                        */
  /* ------------------------------------------------------------------ */

  /** Terme envoyé au serveur dans `?q=` : le filtrage reste côté serveur. */
  readonly query = signal('');
  readonly search = new FormControl('', { nonNullable: true });

  /* ------------------------------------------------------------------ */
  /* Bonus TP2 — métadonnées du plugin de pagination                     */
  /* ------------------------------------------------------------------ */

  /**
   * Ces deux booléens viennent du serveur (aggregate-paginate-v2) au lieu
   * d'être recalculés dans le composant à partir de `page` et `pages`.
   */
  readonly hasPrevPage = signal(false);
  readonly hasNextPage = signal(false);

  /* ------------------------------------------------------------------ */
  /* Bonus TP2 — image de couverture                                     */
  /* ------------------------------------------------------------------ */

  /** Vignettes téléchargées : identifiant de piste -> URL `blob:`. */
  readonly covers = signal<Record<string, string>>({});
  readonly selectedCover = signal<File | null>(null);
  readonly coverError = signal<string | null>(null);

  /* ------------------------------------------------------------------ */
  /* Mission 3 — upload (état)                                           */
  /* ------------------------------------------------------------------ */

  readonly title = new FormControl('', { nonNullable: true });
  readonly selectedFile = signal<File | null>(null);
  readonly fileError = signal<string | null>(null);
  readonly uploadPhase = signal<UploadPhase>('idle');
  readonly uploadPercent = signal(0);
  readonly uploadError = signal<string | null>(null);

  /** Si vrai, tous les contrôles d'envoi sont désactivés (anti double envoi). */
  readonly uploading = computed(() => this.uploadPhase() === 'uploading');

  /** Empêche un second clic pendant qu'une suppression est en cours. */
  readonly pendingDeleteId = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);

  /* ------------------------------------------------------------------ */
  /* Mission 3 — lecture audio (état)                                    */
  /* ------------------------------------------------------------------ */

  /** Identifiant de la piste dont le Blob est en cours de récupération. */
  readonly audioLoadingId = signal<string | null>(null);
  /** Identifiant du morceau chargé dans le lecteur. */
  readonly playingId = signal<string | null>(null);
  readonly playingTitle = signal('');
  /** URL d'objet local (`blob:`) donnée au lecteur `<audio>`. */
  readonly audioUrl = signal('');
  readonly audioError = signal<string | null>(null);

  /* Helpers exposés au template (fonctions pures, sans état). */
  readonly formatBytes = formatBytes;
  readonly formatDate = formatDate;
  readonly audioFormatLabel = audioFormatLabel;
  readonly maxSizeLabel = MAX_AUDIO_SIZE_LABEL;
  readonly maxCoverSizeLabel = MAX_COVER_SIZE_LABEL;

  constructor() {
    this.load();

    /*
     * Bonus « filtre par titre » : debounceTime évite une requête à chaque
     * frappe, distinctUntilChanged évite de relancer la même recherche. Toute
     * recherche repart de la page 1 : sinon la page courante peut ne plus
     * exister dans le résultat filtré.
     */
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe({
        next: (value) => {
          console.debug(`[TracksPage] Recherche : « ${value} »`);
          this.query.set(value.trim());
          this.page.set(1);
          this.load();
        },
        error: (error: unknown) =>
          console.error('[TracksPage] Recherche impossible', error),
      });

    /**
     * À la destruction du composant, l'URL d'objet doit être libérée :
     * le navigateur conserve sinon le Blob en mémoire tant que la page vit.
     */
    this.destroyRef.onDestroy(() => {
      this.releaseAudioUrl();
      // Les vignettes sont aussi des URL d'objet : elles doivent être libérées.
      this.releaseCovers();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Mission 2 — chargement et pagination                                */
  /* ------------------------------------------------------------------ */

  /** Charge la page courante depuis le serveur (une requête par changement). */
  load(): void {
    const page = this.page();
    const limit = this.limit();

    this.loading.set(true);
    this.error.set(null);

    this.service.list(page, limit, this.query()).subscribe({
      next: (response) => {
        console.debug(
          `[TracksPage] page ${response.page}/${response.totalPages} — ${response.items.length} piste(s) sur ${response.totalDocs}`,
        );
        this.tracks.set(response.items);
        this.total.set(response.total);
        this.pages.set(response.pages);
        // Métadonnées calculées par le plugin de pagination côté serveur.
        this.hasPrevPage.set(response.hasPrevPage);
        this.hasNextPage.set(response.hasNextPage);
        this.loading.set(false);
        this.loadCovers(response.items);
      },
      error: (error: HttpErrorResponse) => {
        console.error('[TracksPage] Chargement impossible', error.status);
        this.tracks.set([]);
        this.loading.set(false);
        this.error.set(
          describeHttpError(error, 'Impossible de charger la bibliothèque'),
        );
      },
    });
  }

  /** Bouton « Précédent » / « Suivant » : refuse les bornes. */
  go(page: number): void {
    if (page < 1 || page > this.pages() || page === this.page()) {
      return;
    }

    this.page.set(page);
    this.load();
  }

  /** Callback du paginator Material (numéro de page en base 0). */
  onPage(event: PageEvent): void {
    const limitChanged = event.pageSize !== this.limit();
    this.limit.set(event.pageSize);
    this.page.set(event.pageIndex + 1);

    // Après un changement de taille de page, la page calculée par Material
    // n'a plus le même sens : on repart de la première page.
    if (limitChanged) {
      this.page.set(1);
    }

    this.load();
  }

  /* ------------------------------------------------------------------ */
  /* Mission 3 — sélection et envoi du fichier                           */
  /* ------------------------------------------------------------------ */

  choose(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    this.fileError.set(null);
    this.uploadError.set(null);
    this.uploadPhase.set('idle');
    this.uploadPercent.set(0);

    if (!file) {
      this.selectedFile.set(null);
      return;
    }

    // Validation locale avant toute requête : inutile d'envoyer 25 Mo pour
    // se faire refuser par Multer.
    const problem = validateAudioFile(file);
    if (problem) {
      this.selectedFile.set(null);
      this.fileError.set(problem);
      input.value = '';
      return;
    }

    console.debug(
      `[TracksPage] Fichier sélectionné : ${file.name} (${formatBytes(file.size)}, ${file.type || 'type inconnu'})`,
    );
    this.selectedFile.set(file);
  }

  /**
   * Bonus « image de couverture » : sélection et validation locale de l'image.
   * Les règles reprennent celles du backend (4 types MIME, 2 Mo) pour éviter
   * d'envoyer une image qui serait refusée après transfert.
   */
  chooseCover(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    this.coverError.set(null);

    if (!file) {
      this.selectedCover.set(null);
      return;
    }

    const problem = validateCoverFile(file);
    if (problem) {
      this.selectedCover.set(null);
      this.coverError.set(problem);
      input.value = '';
      return;
    }

    console.debug(
      `[TracksPage] Couverture sélectionnée : ${file.name} (${formatBytes(file.size)}, ${file.type || 'type inconnu'})`,
    );
    this.selectedCover.set(file);
  }

  upload(): void {
    // Anti double soumission : un second clic pendant l'envoi ne fait rien.
    if (this.uploading()) {
      return;
    }

    const file = this.selectedFile();
    if (!file) {
      this.fileError.set('Choisissez un fichier audio avant de lancer l’envoi.');
      return;
    }

    const problem = validateAudioFile(file);
    if (problem) {
      this.fileError.set(problem);
      return;
    }

    const title = this.title.value.trim() || file.name;
    const cover = this.selectedCover();

    this.uploadPhase.set('uploading');
    this.uploadPercent.set(0);
    this.uploadError.set(null);

    this.service.upload(file, title, cover).subscribe({
      next: (event) => {
        switch (event.type) {
          case HttpEventType.UploadProgress: {
            // Le pourcentage vient du navigateur : XHR indique les octets
            // déjà transmis. `total` peut valoir 0 pour un multipart
            // (la taille n'est alors pas annoncée) : on retombe sur la taille
            // du fichier, qui est la même information côté client.
            const total = event.total || file.size;
            const percent = total > 0 ? Math.round((event.loaded / total) * 100) : 0;
            this.uploadPercent.set(Math.min(100, percent));
            break;
          }

          case HttpEventType.Response: {
            const created = event.body as Track | null;
            this.uploadPhase.set('success');
            this.uploadPercent.set(100);
            console.debug('[TracksPage] Piste envoyée', created?.id);
            this.notify(
              `« ${created?.title ?? title} » a été ajouté à votre bibliothèque.`,
            );
            // Vider le formulaire, puis revenir à la première page pour
            // montrer tout de suite le morceau qui vient d'être ajouté
            // (le serveur trie du plus récent au plus ancien).
            this.resetForm();
            this.page.set(1);
            this.load();
            break;
          }

          default:
            // Sent / DownloadProgress / User : sans intérêt pour l'affichage.
            break;
        }
      },
      error: (error: HttpErrorResponse) => {
        console.error('[TracksPage] Envoi impossible', error.status);
        this.uploadPhase.set('error');
        this.uploadPercent.set(0);
        this.uploadError.set(
          describeHttpError(error, 'L’envoi du fichier a échoué'),
        );
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Mission 3 — lecture sécurisée                                       */
  /* ------------------------------------------------------------------ */

  play(track: Track): void {
    this.audioError.set(null);
    this.audioLoadingId.set(track.id);

    this.service.audio(track.id).subscribe({
      next: (blob) => {
        this.audioLoadingId.set(null);

        if (!blob || blob.size === 0) {
          this.audioError.set('Le fichier audio reçu est vide ou illisible.');
          return;
        }

        // Révocation de l'ancienne URL avant d'en créer une nouvelle :
        // sinon le Blob précédent reste en mémoire jusqu'au rechargement.
        this.releaseAudioUrl();
        this.playingId.set(track.id);
        this.playingTitle.set(track.title);
        this.audioUrl.set(URL.createObjectURL(blob));
        console.debug(`[TracksPage] Audio prêt (${formatBytes(blob.size)})`);
      },
      error: (error: HttpErrorResponse) => {
        console.error('[TracksPage] Lecture impossible', error.status);
        this.audioLoadingId.set(null);
        this.playingId.set(null);
        this.audioError.set(
          describeHttpError(error, 'Lecture impossible'),
        );
      },
    });
  }

  /** Arrête la lecture et libère l'URL d'objet. */
  stop(): void {
    this.releaseAudioUrl();
    this.playingId.set(null);
    this.playingTitle.set('');
  }

  /** Le lecteur signale lui-même un problème (fichier corrompu, codec absent). */
  audioFailed(): void {
    this.audioError.set(
      'Le navigateur n’a pas pu lire ce morceau (fichier ou codec non pris en charge).',
    );
  }

  /* ------------------------------------------------------------------ */
  /* Mission 5 — suppression                                            */
  /* ------------------------------------------------------------------ */

  askDelete(track: Track): void {
    this.pendingDeleteId.set(track.id);
  }

  cancelDelete(): void {
    this.pendingDeleteId.set(null);
  }

  confirmDelete(track: Track): void {
    if (this.deletingId()) {
      return;
    }

    this.pendingDeleteId.set(null);
    this.deletingId.set(track.id);

    this.service.remove(track.id).subscribe({
      next: () => {
        console.debug('[TracksPage] Piste supprimée', track.id);
        this.deletingId.set(null);
        this.notify(`« ${track.title} » a été supprimé.`);

        if (this.playingId() === track.id) {
          this.stop();
        }

        this.refreshAfterDelete();
      },
      error: (error: HttpErrorResponse) => {
        console.error('[TracksPage] Suppression impossible', error.status);
        this.deletingId.set(null);

        // La piste a pu être supprimée entre-temps (autre onglet) ou
        // appartenir à quelqu'un d'autre : le backend répond alors 404.
        if (error.status === 404) {
          this.notify(
            `« ${track.title} » n’existe plus : la liste a été actualisée.`,
          );
          this.refreshAfterDelete();
          return;
        }

        this.notifyError(
          describeHttpError(error, 'Suppression impossible'),
        );
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Internes                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Recharge la page après suppression. Si la piste supprimée était la
   * dernière de la page courante, on recule d'une page pour éviter
   * d'afficher une page vide.
   */
  private refreshAfterDelete(): void {
    if (this.tracks().length === 1 && this.page() > 1) {
      this.page.set(this.page() - 1);
    }

    this.load();
  }

  /** Vide le formulaire d'import (titre, fichier, messages). */
  private resetForm(): void {
    this.title.setValue('');
    this.selectedFile.set(null);
    this.fileError.set(null);
    this.uploadError.set(null);
    this.fileInput().nativeElement.value = '';

    // La couverture fait partie du formulaire : elle est vidée elle aussi.
    this.selectedCover.set(null);
    this.coverError.set(null);
    this.coverInput().nativeElement.value = '';
  }

  /**
   * Bonus « image de couverture » : télécharge les vignettes de la page.
   *
   * Les images sont derrière la route protégée `GET /api/tracks/:id/cover` :
   * une balise `<img src="/api/...">` ne transmettrait pas le JWT. Elles
   * passent donc par HttpClient en Blob, puis sont exposées au template sous
   * forme d'URL `blob:`.
   */
  private loadCovers(items: Track[]): void {
    this.releaseCovers();

    const next: Record<string, string> = {};

    for (const track of items.filter((item) => item.hasCover)) {
      this.service.cover(track.id).subscribe({
        next: (blob) => {
          next[track.id] = URL.createObjectURL(blob);
          this.covers.set({ ...next });
        },
        error: (error: HttpErrorResponse) => {
          // Une vignette manquante n'est pas bloquante : la piste reste
          // utilisable, seule l'image n'est pas affichée.
          console.warn(
            `[TracksPage] Couverture indisponible pour ${track.id}`,
            error.status,
          );
        },
      });
    }
  }

  /** Libère toutes les URL `blob:` des vignettes. */
  private releaseCovers(): void {
    for (const url of Object.values(this.covers())) {
      URL.revokeObjectURL(url);
    }
    this.covers.set({});
  }

  /** Libère l'URL d'objet courante et vide le lecteur. */
  private releaseAudioUrl(): void {
    const currentUrl = this.audioUrl();
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      this.audioUrl.set('');
    }
  }

  private notify(message: string): void {
    this.snackBar.open(message, 'OK', {
      duration: 4000,
      panelClass: 'snack-success',
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  private notifyError(message: string): void {
    this.snackBar.open(message, 'Fermer', {
      duration: 6000,
      panelClass: 'snack-error',
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }
}
