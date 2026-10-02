import mongoose from "mongoose";
import aggregatePaginate from "mongoose-aggregate-paginate-v2";

/*
 * Ce schéma conserve les métadonnées d'une piste. Le fichier audio lui-même
 * reste sur le disque ; storedName contient le nom technique utilisé côté
 * serveur et n'est jamais exposé par toPublic().
 */
const schema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true, select: false },
    mimeType: { type: String, required: true },
        size: { type: Number, required: true, min: 0 },
        /*
         * Bonus « image de couverture » : le fichier image est stocké sur le disque
         * comme l'audio. Seuls son type MIME et sa présence sont exposés au client,
         * donc coverStoredName reste `select: false`, exactement comme storedName.
         */
        coverStoredName: { type: String, default: null, select: false },
        coverMimeType: { type: String, default: null },
        coverSize: { type: Number, default: 0, min: 0 },
      },
      { timestamps: true },
    );

// Cet index accélère la liste des pistes d'un utilisateur triées par date.
schema.index({ ownerId: 1, createdAt: -1 });

/*
 * Bonus « pagination Mongoose » : ce plugin ajoute `Track.aggregatePaginate()`.
 * Il exécute le pipeline d'agrégation fourni puis calcule lui-même le total et
 * les métadonnées de pagination (totalPages, hasNextPage, prevPage,
 * pagingCounter…), ce que le `skip`/`limit` écrit à la main ne fournissait pas.
 */
schema.plugin(aggregatePaginate);

/**
 * Convertit un document Mongoose en objet sûr pour le frontend.
 * L'identifiant MongoDB devient la propriété simple `id` attendue par Angular.
 */
schema.methods.toPublic = function () {
  console.debug(`[track-model] Préparation de la piste publique ${this.id}`);
  return {
    id: this.id,
    ownerId: String(this.ownerId),
    title: this.title,
    originalName: this.originalName,
    mimeType: this.mimeType,
        size: this.size,
        createdAt: this.createdAt,
        hasCover: Boolean(this.coverStoredName),
        coverMimeType: this.coverMimeType || null,
      };
    };

export const Track = mongoose.model("Track", schema);
