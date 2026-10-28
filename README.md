# Guitar Practice Cloud — package étudiant

Ce dépôt contient uniquement les ressources nécessaires aux trois TP :
`backend/` et `frontend-starter/`, ainsi que les sujets et documents utiles.

## Comptes rendus

- [RAPPORT_TP1.md](RAPPORT_TP1.md) — authentification, profil, cartographie de l'application ;
- [RAPPORT_TP2.md](RAPPORT_TP2.md) — bibliothèque paginée, upload et lecture audio, bonus facultatifs ;
- [RAPPORT_TP3.md](RAPPORT_TP3.md) — suppression d'une piste, progression de l'upload, tests automatisés ;
- [RAPPORT_IA_MODELE.md](RAPPORT_IA_MODELE.md) — usage des assistants IA pendant les trois TP.

Toutes les captures d'écran citées dans ces rapports sont dans [`captures/`](captures/),
avec les échanges réseau bruts (`reseau-tp2-tp3.json`, `reseau-multipart.json`).

## Prérequis

- Node.js 22.22 ou plus récent **dans la branche 22**, ou Node.js 24.15 (ou plus) ;
  la CLI Angular 22.1.6 refuse les versions 24.x antérieures à 24.15.0
  (message : *« The Angular CLI requires a minimum Node.js version of v22.22.3 or
  v24.15.0 or v26.0.0 »*). Vérifier avec `node -v` ;
- un compte MongoDB Atlas par binôme ;
- Git et un navigateur récent.
- Un IDE de qualité
- Recommandé : un abonnement à un assistant IA de programmation

Consulter [ATLAS_SETUP.md](ATLAS_SETUP.md) pour créer la base de données.

## Démarrer le backend

```bash
cd backend
```

Créer un fichier `.env` **local, jamais versionné**, contenant ces trois variables :

```ini
MONGODB_URI=mongodb+srv://UTILISATEUR:MOT_DE_PASSE@VOTRE_CLUSTER.mongodb.net/guitar-practice-cloud?retryWrites=true&w=majority
JWT_SECRET=une-longue-chaine-aleatoire-propre-a-votre-machine
PORT=3000
```

Ne jamais publier ce fichier, ni copier un secret dans le code Angular. Il est
déjà couvert par `backend/.gitignore`.

```bash
npm install
npm start
```

Le backend écoute normalement sur `http://localhost:3000`.

## Démarrer le frontend

Dans un autre terminal :

```bash
cd frontend-starter
npm install
npm start
```

Ouvrir `http://localhost:4200`. Le compte de démonstration est
`demo@example.com` / `Demo1234!`.

## Lancer les tests

Frontend (Vitest via `@angular/build:unit-test`, environnement Node + jsdom —
aucun backend, aucune base de données nécessaire) :

```bash
cd frontend-starter
npm test
```

Backend (runner de test de Node) :

```bash
cd backend
npm test        # tests de contrat et de schémas : aucune base nécessaire
npm run test:db # ajoute les tests d'intégration ; lit MONGODB_URI dans .env
```

Les tests d’intégration se déclarent ignorés automatiquement quand aucune
connexion MongoDB n’est disponible.

Attendu, sur ce dépôt :

| Commande | Dossier | Résultat |
|---|---|---|
| `npm test` | `frontend-starter/` | 6 fichiers, **45 tests passés** |
| `npm test` | `backend/` | 16 tests, 10 passés, 6 ignorés (base absente) |
| `npm run test:db` | `backend/` | 16 tests, **16 passés** |

## Vérifier les fonctionnalités à la main

Backend et frontend démarrés, se connecter avec le compte de démonstration, puis
dans la bibliothèque :

1. **Pagination** — 5 pistes par page ; « Précédent » / « Suivant » suivent
   `hasPrevPage` / `hasNextPage` renvoyés par le serveur. Dans l’onglet Network,
   la requête est `GET /api/tracks?page=1&limit=5`.
2. **Filtre par titre** (bonus) — taper `blues` dans le champ de recherche : la
   requête devient `GET /api/tracks?page=1&limit=5&q=blues` et la liste ne garde
   que les pistes correspondantes. Le filtre est appliqué par le serveur, sur
   toute la bibliothèque, **avant** la pagination.
3. **Upload avec couverture** (bonus) — choisir un fichier audio, un titre, puis
   une image (JPEG, PNG, WebP ou GIF, 2 Mo maximum). La réponse `201` contient
   `hasCover: true` et `coverMimeType`, jamais le nom du fichier stocké ; la
   vignette apparaît ensuite dans la bibliothèque.
4. **Lecture audio** — le bouton de lecture déclenche
   `GET /api/tracks/:id/audio` avec l’en-tête `Authorization` : c’est la route
   protégée qui sert le fichier, et non une balise `<audio src="…">` directe.
5. **Suppression** — la suppression demande confirmation, puis
   `DELETE /api/tracks/:id` répond `204`.

Pour vérifier une route protégée directement, il faut passer le jeton :

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"Demo1234!"}' \
  | python -c "import json,sys; print(json.load(sys.stdin)['token'])")

curl -s "http://localhost:3000/api/tracks?page=1&limit=5&q=blues" \
  -H "Authorization: Bearer $TOKEN"
```

La route `GET /api/tracks/:id/cover` renvoie une **image binaire**, pas du JSON :
l’écrire dans un fichier avec `curl -o image.png`, sinon l’affichage est illisible.

## Documents de travail

- [SUJET_ETUDIANT_TP1.md](SUJET_ETUDIANT_TP1.md), [SUJET_ETUDIANT_TP2.md](SUJET_ETUDIANT_TP2.md) et [SUJET_ETUDIANT_TP3.md](SUJET_ETUDIANT_TP3.md) : missions des trois séances ;
- [API_CONTRACT.md](API_CONTRACT.md) : endpoints, authentification et formats échangés. Le backend a été modifié pour les **bonus facultatifs du TP2** (filtre par titre, pagination `aggregate-paginate-v2`, image de couverture) : le contrat a été mis à jour en même temps, comme l’exige `frontend-starter/AGENTS.md` ;
- les comptes rendus sont listés en tête de ce fichier (section « Comptes rendus ») ;
- [CONSEILS_POUR_UTIISER_ASSISTANT_AI.md](CONSEILS_POUR_UTIISER_ASSISTANT_AI.md) : utiliser correctement un assistant IA, quel que soit l’outil choisi ;
- `captures/` : captures d’écran de l’application, rendus de l’onglet Network et
  échanges réseau bruts (`reseau-tp2-tp3.json`, `reseau-multipart.json`).

## Bonus facultatifs réalisés (TP2)

Trois bonus du TP2 touchent le backend. Ils sont donc documentés dans
[API_CONTRACT.md](API_CONTRACT.md) :

- **filtre par titre** : paramètre `q` sur `GET /tracks`, appliqué par le serveur
  avant la pagination ;
- **pagination Mongoose** : plugin `aggregate-paginate-v2`, qui ajoute
  `totalDocs`, `totalPages`, `pagingCounter`, `hasPrevPage`, `hasNextPage`,
  `prevPage` et `nextPage` à la réponse ;
- **image de couverture** : champ multipart `cover` à l’envoi et route protégée
  `GET /tracks/:id/cover` pour la restitution.

Le backend contient également ses propres consignes pour les assistants :
[`backend/AGENTS.md`](backend/AGENTS.md), [`backend/CLAUDE.md`](backend/CLAUDE.md),
[`backend/GEMINI.md`](backend/GEMINI.md) et
[`backend/best-practices.md`](backend/best-practices.md). Elles couvrent
Node.js, Express, Mongoose, MongoDB, l’authentification, Multer, les uploads,
les logs et les tests.

Les fichiers audio présents dans `frontend-starter/fichiers-audio-de-test/` sont
des fixtures fournies pour les essais. Aucun fichier uploadé, dossier de
dépendances (`node_modules`), fichier `.env` ou identifiant local n’est inclus.