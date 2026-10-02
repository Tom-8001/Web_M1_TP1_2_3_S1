import { defineConfig } from 'vitest/config';

/**
 * Configuration du runner de tests (Vitest) utilisée par le builder
 * `@angular/build:unit-test` via l'option `runnerConfig` de `angular.json`.
 *
 * Pourquoi ce fichier existe : le pool `forks` par défaut de Vitest n'arrive pas
 * à démarrer ses workers sur ce poste (chemin OneDrive long + antivirus), ce qui
 * produit « Timeout waiting for worker to respond » et zéro test exécuté.
 * Le pool `threads` en mono-thread démarre sans spawn de processus fils.
 */
export default defineConfig({
  test: {
    // Vitest 4 : `pool` et `fileParallelism` sont des options de premier niveau
    // (`poolOptions` a été supprimé). Mono-thread + fichiers sérialisés : le
    // démarrage des workers jsdom est lent sur ce poste, et les lancer en
    // parallèle dépasse le délai de démarrage de Vitest.
    pool: 'threads',
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});