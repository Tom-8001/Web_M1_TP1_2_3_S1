# Contrat HTTP - TP1 à TP3

Base : `/api`. Sauf inscription et connexion, envoyer `Authorization: Bearer <jeton>`.

Le contrat HTTP ne dépend pas du choix de persistance : le backend fourni utilise Mongoose et MongoDB. MongoDB conserve les utilisateurs et métadonnées ; les octets des fichiers restent sur le disque du serveur.

| Méthode | Route | Requête | Réponse principale |
|---|---|---|---|
| GET | `/health` | - | `{ "status": "ok" }` |
| POST | `/auth/register` | `{name,email,password}` | `201 {token,user}` |
| POST | `/auth/login` | `{email,password}` | `200 {token,user}` |
| GET | `/users/me` | JWT | `200 User` |
| PUT | `/users/me` | `{name}` + JWT | `200 User` |
| GET | `/tracks?page=1&limit=5&q=blues` | JWT | `Page<Track>` |
| POST | `/tracks` | multipart : `audio`, `title`, `cover` | `201 Track` |
| GET | `/tracks/:id/audio` | JWT | flux audio |
| GET | `/tracks/:id/cover` | JWT | flux image |
| DELETE | `/tracks/:id` | JWT | `204` (bonus) |

## `GET /tracks` — pagination et filtre (bonus TP2)

Paramètres de requête :

| Paramètre | Type | Défaut | Rôle |
|---|---|---|---|
| `page` | entier ≥ 1 | `1` | page demandée |
| `limit` | entier de 1 à 20 | `5` | nombre de pistes par page |
| `q` | texte | absent | filtre insensible à la casse sur `title` |

`q` est optionnel et s'applique **avant** la pagination : `total` et `pages` portent donc sur le résultat filtré, pas sur la bibliothèque entière. Les caractères spéciaux d'expression régulière sont échappés côté serveur, si bien que `q=.*` ne renvoie rien au lieu de tout renvoyer.

La pagination est calculée par le plugin Mongoose `aggregate-paginate-v2`. `Page<Track>` contient :

- les champs du contrat d'origine : `items`, `page`, `limit`, `total`, `pages` ;
- les champs ajoutés par le plugin : `totalDocs`, `totalPages`, `pagingCounter`, `hasPrevPage`, `hasNextPage`, `prevPage`, `nextPage`, `meta`.

`pages` vaut au minimum `1` (pour qu'une page reste affichable même sur une bibliothèque vide), tandis que `totalPages` est la valeur brute du plugin, qui vaut `0` sans aucune piste.

`Track` contient `id`, `ownerId`, `title`, `originalName`, `mimeType`, `size`, `createdAt`, `hasCover` et `coverMimeType`. Les noms de fichiers internes (`storedName`, `coverStoredName`) ne sont jamais exposés au client.

## `POST /tracks` — envoi d'un morceau

Champs multipart :

| Champ | Obligatoire | Contenu |
|---|---|---|
| `audio` | oui | fichier audio : MP3, WAV, OGG, M4A — 25 Mo maximum |
| `title` | non | titre affiché ; à défaut, le nom du fichier |
| `cover` | non | image de couverture : JPG, PNG, WEBP, GIF — 2 Mo maximum (bonus TP2) |

Erreurs : `400 Fichier audio requis`, `400 Format audio non accepté`, `400 Format d'image non accepté`, `400 Image de couverture trop volumineuse (2 Mo maximum)`.

## `GET /tracks/:id/cover` (bonus TP2)

Renvoie l'image de couverture de la piste. Comme la route audio, elle est protégée : seul le propriétaire y accède, un autre utilisateur reçoit `404`. Une piste sans couverture répond `404 Couverture inconnue`.

Erreurs courantes : `400` validation, `401` authentification, `404` ressource, `409` email déjà utilisé.
