import express from "express";
import cors from "cors";
import multer from "multer";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { User } from "./models/User.js";
import { Track } from "./models/Track.js";
import mongoose from "mongoose";

// Les fichiers audio restent sur le disque du serveur dans ce TP.
// MongoDB ne conserve que leurs métadonnées : titre, nom, taille, etc.
const UPLOADS = path.resolve("data/uploads");

try {
  // mkdirSync est utilisé au démarrage : l'application doit disposer de ce
  // dossier avant de pouvoir accepter le premier upload.
  fs.mkdirSync(UPLOADS, { recursive: true });
  console.log(`[startup] Dossier des uploads prêt : ${UPLOADS}`);
} catch (error) {
  console.error("[startup] Impossible de créer le dossier des uploads", error);
  throw error;
}

// Ce secret reste côté serveur. Il ne doit jamais être copié dans Angular.
const SECRET = process.env.JWT_SECRET || "tp1-development-secret";

// La taille maximale d'un fichier audio est de 25 Mo. Les fichiers plus gros
// sont refusés par Multer avant d'être écrits sur le disque.
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// Les types MIME autorisés correspondent aux formats demandés dans le sujet.
const allowed = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
]);

/*
 * Bonus « image de couverture » : les images sont acceptées en plus des
 * fichiers audio, mais uniquement dans le champ multipart `cover`. La liste
 * reste volontairement courte (formats que tous les navigateurs affichent).
 */
const allowedImages = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

// Une pochette n'a pas besoin d'être lourde : 2 Mo suffisent largement.
const MAX_COVER_SIZE = 2 * 1024 * 1024;

/**
 * Crée un jeton JWT contenant uniquement l'identité nécessaire à l'API.
 * Le mot de passe n'est jamais placé dans le token. `sub` signifie subject
 * et contient l'identifiant MongoDB de l'utilisateur.
 */
function token(user) {
  console.log(`[auth] Création d'un token pour l'utilisateur ${user.id}`);
  return jwt.sign({ sub: user.id, email: user.email }, SECRET, {
    expiresIn: "2h",
  });
}

/** Middleware Express qui protège les routes privées. */
function auth(req, res, next) {
  const raw = req.headers.authorization;

  // Le token est transmis dans l'en-tête Authorization sous la forme
    // "Authorization: Bearer <token>". Le préfixe "Bearer " est obligatoire pour que
    // le middleware sache qu'il s'agit d'un JWT et non d'un autre type de jeton.
  if (!raw?.startsWith("Bearer ")) {
    console.warn(`[auth] Authorization absente pour ${req.method} ${req.path}`);
    return res.status(401).json({ message: "Authentification requise" });
  }

  try {
    // jwt.verify vérifie la signature et la date d'expiration du token.
    // On ne logue jamais sa valeur, car un JWT permettrait une usurpation.
    req.auth = jwt.verify(raw.slice(7), SECRET);
    console.log(`[auth] Token accepté pour ${req.auth.sub}`);
    next();
  } catch (error) {
    console.error("[auth] Token invalide ou expiré", error);
    return res.status(401).json({ message: "Jeton invalide ou expiré" });
  }
}

/*
 * Multer transforme une requête HTTP multipart/form-data en données exploitables
 * par Express et traite les fichiers envoyés par un formulaire HTML.
 * Documentation officielle : https://github.com/expressjs/multer
 *
 * diskStorage indique que Multer écrit directement le fichier sur disque.
 * Chaque callback doit appeler cb(error, value) : null signifie qu'il n'y a
 * pas d'erreur. Le nom aléatoire évite les collisions entre utilisateurs.
 */
const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    console.debug(`[multer] Destination sélectionnée : ${UPLOADS}`);
    callback(null, UPLOADS);
  },
  filename: (_request, file, callback) => {
    const filename =
      crypto.randomUUID() + path.extname(file.originalname).toLowerCase();
    console.log(`[multer] Nom de stockage généré pour ${file.originalname}`);
    callback(null, filename);
  },
});

/*
 * limits.fileSize protège le serveur contre les fichiers trop volumineux.
 * fileFilter est appelé avant l'enregistrement : accepter le fichier appelle
 * callback(null, true), le refuser transmet une vraie Error à Express.
 */
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_request, file, callback) => {
    // Bonus « image de couverture » : le champ `cover` accepte des images, le
    // champ `audio` reste limité aux types MIME audio du sujet. Le filtrage se
    // fait donc sur le nom du champ ET sur le type MIME.
    if (file.fieldname === "cover") {
      if (allowedImages.has(file.mimetype)) {
        console.log(`[multer] Image acceptée : ${file.mimetype}`);
        return callback(null, true);
      }

      const imageError = new Error("Format d'image non accepté");
      console.error(`[multer] Image refusée : ${file.mimetype}`, imageError);
      return callback(imageError);
    }

    // Seuls les types MIME audio demandés dans le sujet sont acceptés.
    if (allowed.has(file.mimetype)) {
      console.log(`[multer] Type accepté : ${file.mimetype}`);
      return callback(null, true);
    }

    const error = new Error("Format audio non accepté");
    console.error(`[multer] Type refusé : ${file.mimetype}`, error);
    return callback(error);
  },
});

/**
 * Supprime des fichiers déjà écrits sur le disque. Multer écrit un fichier avant
 * que la route ne le valide : si la requête est ensuite refusée (audio manquant,
 * pochette trop lourde, erreur MongoDB), ces fichiers deviendraient orphelins.
 */
async function removeFiles(files) {
  for (const file of files.filter(Boolean)) {
    const filePath = path.join(UPLOADS, file.filename);
    try {
      await fsPromises.unlink(filePath);
      console.log(`[tracks] Fichier temporaire supprimé : ${filePath}`);
    } catch (error) {
      console.error(`[tracks] Impossible de supprimer ${filePath}`, error);
    }
  }
}

/**
 * Construit l'application Express sans ouvrir de port.
 * Cette séparation permet au serveur réel et aux tests de créer la même
 * application. Le port est ouvert uniquement dans server.js.
 */
export function createApp() {
  const app = express();

  // Journaliser la fin de chaque requête permet de suivre méthode, URL,
  // statut et durée sans exposer les corps contenant des mots de passe.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      console.log(
        `[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt} ms)`,
      );
    });
    next();
  });

  // CORS est nécessaire pour que le frontend Angular puisse appeler l'API.
  // C'est-à-dire que le navigateur autorise les requêtes cross-origin depuis localhost:4200.
  // Dans un vrai projet, il est recommandé de limiter les origines autorisées.
  app.use(cors());

  // Express ne gère pas nativement le JSON : ce middleware transforme le corps JSON en objet JavaScript 
  // accessible via req.body.
  // Il est placé avant les routes pour que toutes les requêtes JSON soient traitées.
  app.use(express.json());

  /** Endpoint public utilisé pour vérifier que l'API répond. */
  app.get("/api/health", (_req, res) => {
    console.log("[health] Vérification de l'API");
    res.json({ status: "ok" });
  });

  /** Requête POST pour "insertion" de donnée.
   * Inscrit un utilisateur et renvoie un token avec ses données publiques. 
   * @param {Object} req - La requête HTTP.
   * @param {Object} res - La réponse HTTP.
   * @param {Function} next - La fonction de middleware suivante.
   */
  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const { name, email, password } = req.body || {};
      console.log(`[auth] Tentative d'inscription pour ${email || "email absent"}`);

      if (!name || !email || !password || password.length < 8) {
        console.warn("[auth] Inscription refusée : données invalides ou incomplètes");
        return res.status(400).json({
          message: "Nom, email et mot de passe de 8 caractères requis",
        });
      }

      // Vérifie si l'email est déjà utilisé avant de créer un nouvel utilisateur.
      if (await User.exists({ email: String(email).toLowerCase() })) {
        console.warn(`[auth] Email déjà utilisé : ${email}`);
        return res.status(409).json({ message: "Email déjà utilisé" });
      }

      // Crée l'utilisateur et le stocke dans MongoDB. Le mot de passe est haché
      // par le hook pre('validate') défini dans le schéma Mongoose.
      const user = await User.create({ name, email, password });
      console.log(`[auth] Utilisateur créé : ${user.id}`);
      res.status(201).json({ token: token(user), user: user.toPublic() });
    } catch (error) {
      console.error("[auth] Erreur pendant l'inscription", error);
      next(error);
    }
  });

  /** Vérifie les identifiants et ouvre une session JWT. Les identifiants sont envoyés dans le corps de la 
   * requête par un HTTP POST. */
  app.post("/api/auth/login", async (req, res, next) => {
    try {
        // req.body est déjà un objet JavaScript grâce au middleware express.json() placé plus haut.
        // il contient les champs email et password envoyés par le frontend Angular.
      const email = String(req.body?.email || "").toLowerCase();
      console.log(`[auth] Tentative de connexion pour ${email || "email absent"}`);

      // Sélectionne le mot de passe haché pour vérifier les identifiants.
      // User est un modèle Mongoose qui correspond au schéma défini dans models/User.js.
      // on envoie les requête à MongoDB via cet objet. Le mot de passe haché est stocké dans 
      // passwordHash, mais il n'est pas renvoyé par défaut dans les requêtes pour 
      // des raisons de sécurité.
      const user = await User.findOne({ email }).select("+passwordHash");

      if (!user || !(await user.verifyPassword(req.body?.password || ""))) {
        console.warn(`[auth] Identifiants incorrects pour ${email}`);
        return res.status(401).json({ message: "Identifiants incorrects" });
      }

      console.log(`[auth] Connexion réussie : ${user.id}`);
      res.json({ token: token(user), user: user.toPublic() });
    } catch (error) {
      console.error("[auth] Erreur pendant la connexion", error);
      next(error);
    }
  });

  /** Retourne le profil public de l'utilisateur identifié par le JWT. 
   * Les paramètres sont :
   * @param auth - Le middleware qui vérifie le JWT et ajoute req.auth. 
   * @param {Object} req - La requête HTTP.
   * @param {Object} res - La réponse HTTP.
   * @param {Function} next - La fonction de middleware suivante.
  */
  app.get("/api/users/me", auth, async (req, res, next) => {
    try {
        // req.auth.sub contient l'identifiant MongoDB de l'utilisateur 
        // extrait du JWT par le middleware auth. ici req.auth est un objet ajouté par le middleware 
        // auth à la requête, et sub est la propriété qui contient l'identifiant de l'utilisateur.
      const user = await User.findById(req.auth.sub);
      if (!user) {
        console.warn(`[user] Profil introuvable : ${req.auth.sub}`);
        return res.status(404).json({ message: "Utilisateur inconnu" });
      }

      console.log(`[user] Profil envoyé : ${user.id}`);
      res.json(user.toPublic());
    } catch (error) {
      console.error("[user] Erreur de lecture du profil", error);
      next(error);
    }
  });

  /** Modifie uniquement le nom de l'utilisateur connecté. */
  app.put("/api/users/me", auth, async (req, res, next) => {
    try {
      const user = await User.findByIdAndUpdate(
        req.auth.sub,
        { $set: { name: req.body?.name } },
        { new: true, runValidators: true },
      );

      if (!user) {
        console.warn(`[user] Mise à jour impossible : ${req.auth.sub}`);
        return res.status(404).json({ message: "Utilisateur inconnu" });
      }

      console.log(`[user] Nom mis à jour : ${user.id}`);
      res.json(user.toPublic());
    } catch (error) {
      console.error("[user] Erreur de mise à jour du profil", error);
      next(error);
    }
  });

  /** Retourne une page des pistes appartenant exclusivement à l'utilisateur. */
  app.get("/api/tracks", auth, async (req, res, next) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
      /*
       * Une agrégation ne convertit PAS les chaînes en ObjectId, contrairement à
       * find() : sans cette conversion, le $match ne correspondrait à aucun
       * document et la bibliothèque reviendrait toujours vide.
       */
      if (!mongoose.Types.ObjectId.isValid(req.auth.sub)) {
        return res.status(401).json({ message: "Jeton invalide ou expiré" });
      }

      const filter = { ownerId: new mongoose.Types.ObjectId(req.auth.sub) };

      /*
       * Bonus « filtre par titre » : `q` est optionnel. Les caractères spéciaux
       * d'expression régulière sont échappés pour que la saisie reste une simple
       * recherche de texte (elle ne peut pas devenir un motif arbitraire).
       */
      const q = String(req.query.q || "").trim();
      if (q) {
        filter.title = {
          $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        };
      }

      console.log(
        `[tracks] Lecture page=${page}, limit=${limit}, q=${q || "-"}, user=${req.auth.sub}`,
      );

      /*
       * Bonus « pagination Mongoose » : aggregate-paginate-v2 exécute ce pipeline
       * puis calcule lui-même le total et les métadonnées de pagination
       * (totalPages, hasNextPage, prevPage, pagingCounter…), ce que
       * find().skip().limit() + countDocuments() ne fournissaient pas.
       *
       * Attention : contrairement à find(), une agrégation n'applique PAS les
       * options `select: false` du schéma. storedName et coverStoredName sont
       * donc exclus explicitement par le $project, sinon les noms de fichiers
       * internes seraient exposés au client.
       */
      const result = await Track.aggregatePaginate(
        Track.aggregate([
          { $match: filter },
          { $sort: { createdAt: -1 } },
          {
            $addFields: {
              hasCover: {
                $cond: [{ $ifNull: ["$coverStoredName", false] }, true, false],
              },
            },
          },
          {
            $project: {
              storedName: 0,
              coverStoredName: 0,
              __v: 0,
              updatedAt: 0,
            },
          },
        ]),
        { page, limit },
      );

      const items = result.docs;
      const total = result.totalDocs;

      // items.map(track) crée un nouveau tableau publicItems en transformant chaque piste pour inclure 
      // uniquement les champs nécessaires à l'API.
      // L'identifiant MongoDB (_id) est converti en chaîne de caractères (id) pour être plus lisible 
      // côté frontend.
      // Le champ _id (généré par MongoDB) est supprimé pour éviter de l'exposer dans la réponse JSON.
      // Une agrégation renvoie des objets simples et non des documents Mongoose :
      // la forme publique est donc construite explicitement pour Angular.
      const publicItems = items.map((track) => ({
        id: String(track._id),
        ownerId: String(track.ownerId),
        title: track.title,
        originalName: track.originalName,
        mimeType: track.mimeType,
        size: track.size,
        createdAt: track.createdAt,
        hasCover: Boolean(track.hasCover),
        coverMimeType: track.coverMimeType || null,
      }));

      console.log(`[tracks] ${publicItems.length} piste(s) envoyée(s) sur ${total}`);

      // envoi de la réponse JSON avec les pistes publiques, la page actuelle, la limite par page, 
      // le nombre total de pistes et le nombre total de pages.
      res.json({
        // Champs d'origine, conservés pour ne pas casser le contrat du TP2.
        items: publicItems,
        page: result.page,
        limit: result.limit,
        total: result.totalDocs,
        pages: Math.max(1, result.totalPages),
        // Champs supplémentaires fournis par aggregate-paginate-v2 (bonus TP2).
        totalDocs: result.totalDocs,
        totalPages: result.totalPages,
        pagingCounter: result.pagingCounter,
        hasPrevPage: result.hasPrevPage,
        hasNextPage: result.hasNextPage,
        prevPage: result.prevPage,
        nextPage: result.nextPage,
        meta: result.meta,
      });
    } catch (error) {
      console.error("[tracks] Erreur de pagination", error);
      next(error);
    }
  });

  /**
   * Reçoit les champs multipart audio (obligatoire), cover (facultatif) et le
   * champ texte title.
   * upload.fields([...]) traite les deux fichiers et les place dans req.files :
   * req.files.audio[0] et, si elle est fournie, req.files.cover[0].
   * C'est ici qu'est fait l'upload de fichiers sur le serveur.
   * Le middleware auth vérifie le JWT avant d'accepter l'upload.
   * Si les fichiers sont acceptés, ils sont stockés sur le disque et leurs
   * métadonnées sont enregistrées dans MongoDB.
   */
  app.post(
    "/api/tracks",
    auth,
    upload.fields([
      { name: "audio", maxCount: 1 },
      { name: "cover", maxCount: 1 },
    ]),
    async (req, res, next) => {
      const audioFile = req.files?.audio?.[0] ?? null;
      const coverFile = req.files?.cover?.[0] ?? null;

      try {
        if (!audioFile) {
          console.warn(`[tracks] Upload sans fichier par ${req.auth.sub}`);
          // Une pochette seule ne suffit pas : le fichier déjà écrit est retiré.
          await removeFiles([coverFile]);
          return res.status(400).json({ message: "Fichier audio requis" });
        }

        // limits.fileSize de Multer s'applique à tous les champs : la limite
        // plus stricte de la pochette est donc vérifiée ici, après écriture.
        if (coverFile && coverFile.size > MAX_COVER_SIZE) {
          console.warn(`[tracks] Couverture trop lourde : ${coverFile.size} octets`);
          await removeFiles([audioFile, coverFile]);
          return res.status(400).json({
            message: "Image de couverture trop volumineuse (2 Mo maximum)",
          });
        }

        const track = await Track.create({
          ownerId: req.auth.sub,
          title: req.body.title || audioFile.originalname,
          originalName: audioFile.originalname,
          storedName: audioFile.filename,
          mimeType: audioFile.mimetype,
          size: audioFile.size,
          coverStoredName: coverFile ? coverFile.filename : null,
          coverMimeType: coverFile ? coverFile.mimetype : null,
          coverSize: coverFile ? coverFile.size : 0,
        });

        console.log(
          `[tracks] Upload enregistré : ${track.id}${coverFile ? " (avec couverture)" : ""}`,
        );
        res.status(201).json(track.toPublic());
      } catch (error) {
        console.error("[tracks] Erreur après l'enregistrement du fichier", error);

        // Si MongoDB échoue après l'écriture sur disque, on tente de nettoyer
        // les fichiers orphelins. L'erreur de nettoyage est elle aussi loguée.
        await removeFiles([audioFile, coverFile]);
        next(error);
      }
    },
  );

  /** Envoie le contenu binaire d'une piste après vérification de sa propriété. */
  app.get("/api/tracks/:id/audio", auth, async (req, res, next) => {
    try {
      const track = await Track.findOne({
        _id: req.params.id,
        ownerId: req.auth.sub,
      }).select("+storedName");

      if (!track) {
        console.warn(`[tracks] Audio introuvable ou interdit : ${req.params.id}`);
        return res.status(404).json({ message: "Piste inconnue" });
      }

      const audioPath = path.join(UPLOADS, track.storedName);
      res.type(track.mimeType);
      // Ce callback permet de loguer le succès ou l'erreur du transfert.
      res.sendFile(audioPath, (error) => {
        if (error) {
          console.error(`[tracks] Erreur d'envoi audio ${track.id}`, error);
          if (!res.headersSent) next(error);
          return;
        }
        console.log(`[tracks] Audio envoyé : ${track.id}`);
      });
    } catch (error) {
      console.error("[tracks] Erreur de préparation du flux audio", error);
      next(error);
    }
  });

  /**
   * Bonus « image de couverture » : envoie l'image après vérification de sa
   * propriété, exactement comme la route audio. L'image n'est jamais publique :
   * le client la reçoit en Blob avec son en-tête Authorization.
   */
  app.get("/api/tracks/:id/cover", auth, async (req, res, next) => {
    try {
      const track = await Track.findOne({
        _id: req.params.id,
        ownerId: req.auth.sub,
      }).select("+coverStoredName");

      if (!track || !track.coverStoredName) {
        console.warn(`[tracks] Couverture introuvable ou interdite : ${req.params.id}`);
        return res.status(404).json({ message: "Couverture inconnue" });
      }

      const coverPath = path.join(UPLOADS, track.coverStoredName);
      res.type(track.coverMimeType || "image/jpeg");
      res.sendFile(coverPath, (error) => {
        if (error) {
          console.error(`[tracks] Erreur d'envoi de la couverture ${track.id}`, error);
          if (!res.headersSent) next(error);
          return;
        }
        console.log(`[tracks] Couverture envoyée : ${track.id}`);
      });
    } catch (error) {
      console.error("[tracks] Erreur de préparation de la couverture", error);
      next(error);
    }
  });

  /** Supprime la métadonnée et le fichier physique correspondant. */
  app.delete("/api/tracks/:id", auth, async (req, res, next) => {
    try {
      const track = await Track.findOneAndDelete({
        _id: req.params.id,
        ownerId: req.auth.sub,
      }).select("+storedName +coverStoredName");

      if (!track) {
        console.warn(`[tracks] Suppression impossible : ${req.params.id}`);
        return res.status(404).json({ message: "Piste inconnue" });
      }

      const audioPath = path.join(UPLOADS, track.storedName);
      try {
        await fsPromises.unlink(audioPath);
        console.log(`[tracks] Fichier supprimé : ${audioPath}`);
      } catch (error) {
        // L'exception n'est volontairement pas ignorée : l'administrateur doit
        // voir ce fichier orphelin si sa suppression échoue.
        console.error(`[tracks] Fichier audio non supprimé : ${audioPath}`, error);
        return res.status(500).json({
          message: "Métadonnée supprimée, mais fichier audio non supprimé",
        });
      }

      // La couverture est facultative : si sa suppression échoue, l'incident est
      // signalé dans les logs mais ne remet pas en cause la suppression de la piste.
      if (track.coverStoredName) {
        const coverPath = path.join(UPLOADS, track.coverStoredName);
        try {
          await fsPromises.unlink(coverPath);
          console.log(`[tracks] Couverture supprimée : ${coverPath}`);
        } catch (error) {
          console.error(`[tracks] Couverture non supprimée : ${coverPath}`, error);
        }
      }

      res.status(204).end();
    } catch (error) {
      console.error("[tracks] Erreur de suppression", error);
      next(error);
    }
  });

  /** Gestionnaire central des erreurs connues de l'application. */
  app.use((error, _req, res, next) => {
    console.error("[error] Erreur reçue par le gestionnaire central", error);

    if (
      error instanceof multer.MulterError ||
      error?.message === "Format audio non accepté" ||
      error?.message === "Format d'image non accepté"
    ) {
      return res.status(400).json({ message: error.message });
    }
    if (error?.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    if (error?.name === "CastError") {
      return res.status(404).json({ message: "Ressource inconnue" });
    }

    next(error);
  });

  return app;
}
