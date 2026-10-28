import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Track } from "../src/models/Track.js";

let server, base;

/*
 * Le secret est le même que celui du serveur : la variable d'environnement
 * quand elle est fournie (`npm run test:db`), sinon la valeur de développement.
 * Il sert uniquement à signer des jetons de test.
 */
const SECRET = process.env.JWT_SECRET || "tp1-development-secret";

/** Signe un JWT de test pour un identifiant d'utilisateur donné. */
function signToken(sub, secret = SECRET) {
  return jwt.sign({ sub: String(sub), email: "tests@example.com" }, secret, {
    expiresIn: "5m",
  });
}

/** Indique si une base MongoDB est réellement disponible pour ce test. */
function databaseReady() {
  return mongoose.connection.readyState === 1;
}

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  // Les tests de contrat ne dépendent pas de MongoDB. Ceux qui en ont besoin
  // sont ignorés proprement si aucune base n'est joignable.
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 15000,
      });
      console.log("[test] MongoDB connecté pour les tests d'intégration");
    } catch (error) {
      console.warn("[test] MongoDB injoignable, tests base ignorés", error.message);
    }
  }
});

test.after(async () => {
  server.close();
  if (databaseReady()) {
    await mongoose.disconnect();
  }
});

/* ------------------------------------------------------------------ */
/* Tests fournis au départ (conservés tels quels)                      */
/* ------------------------------------------------------------------ */

test("health sans dépendre de MongoDB", async () => {
  const r = await fetch(base + "/api/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "ok");
});

test("schémas Mongoose et relation", () => {
  const u = new User({
    name: "Test",
    email: "TEST@example.com",
    password: "12345678",
  });

  assert.equal(u.email, "test@example.com");
  const t = new Track({
    ownerId: new mongoose.Types.ObjectId(),
    title: "Blues",
    originalName: "b.mp3",
    storedName: "x.mp3",
    mimeType: "audio/mpeg",
    size: 42,
  });
  
  assert.equal(t.title, "Blues");
  assert.equal(Track.schema.path("ownerId").options.ref, "User");
});

/* ------------------------------------------------------------------ */
/* Mission 7 — tests de contrat et de sécurité (aucune base requise)   */
/* ------------------------------------------------------------------ */

test("les routes protégées répondent 401 sans JWT", async () => {
  const protectedRoutes = [
    ["GET", "/api/users/me"],
    ["PUT", "/api/users/me"],
    ["GET", "/api/tracks"],
    ["POST", "/api/tracks"],
    ["GET", "/api/tracks/000000000000000000000001/audio"],
    ["GET", "/api/tracks/000000000000000000000001/cover"],
    ["DELETE", "/api/tracks/000000000000000000000001"],
  ];

  for (const [method, path] of protectedRoutes) {
    const response = await fetch(base + path, { method });
    assert.equal(response.status, 401, `${method} ${path} doit répondre 401`);
    const body = await response.json();
    assert.equal(body.message, "Authentification requise");
  }
});

test("un JWT signé avec un mauvais secret est refusé (401)", async () => {
  const forged = signToken(
    new mongoose.Types.ObjectId().toHexString(),
    "mauvais-secret",
  );

  const response = await fetch(base + "/api/tracks", {
    headers: { Authorization: `Bearer ${forged}` },
  });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).message, "Jeton invalide ou expiré");
});

test("un JWT expiré est refusé (401)", async () => {
  const expired = jwt.sign(
    { sub: new mongoose.Types.ObjectId().toHexString() },
    SECRET,
    { expiresIn: -10 },
  );

  const response = await fetch(base + "/api/tracks", {
    headers: { Authorization: `Bearer ${expired}` },
  });

  assert.equal(response.status, 401);
});

test("un en-tête mal formé (sans « Bearer ») est refusé (401)", async () => {
  const token = signToken(new mongoose.Types.ObjectId().toHexString());

  const response = await fetch(base + "/api/tracks", {
    headers: { Authorization: token },
  });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).message, "Authentification requise");
});

test("upload sans fichier : 400 et message explicite", async () => {
  const form = new FormData();
  form.append("title", "Sans audio");

  const response = await fetch(base + "/api/tracks", {
    method: "POST",
    headers: { Authorization: `Bearer ${signToken(new mongoose.Types.ObjectId().toHexString())}` },
    body: form,
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "Fichier audio requis");
});

test("type MIME refusé : 400 « Format audio non accepté »", async () => {
  const form = new FormData();
  form.append("audio", new File(["du texte"], "notes.txt", { type: "text/plain" }));
  form.append("title", "Pas un son");

  const response = await fetch(base + "/api/tracks", {
    method: "POST",
    headers: { Authorization: `Bearer ${signToken(new mongoose.Types.ObjectId().toHexString())}` },
    body: form,
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "Format audio non accepté");
});

test("type d'image refusé : 400 « Format d'image non accepté »", async () => {
  const form = new FormData();
  form.append("audio", new File(["audio"], "morceau.mp3", { type: "audio/mpeg" }));
  form.append("cover", new File(["du texte"], "notes.txt", { type: "text/plain" }));
  form.append("title", "Pochette invalide");

  const response = await fetch(base + "/api/tracks", {
    method: "POST",
    headers: { Authorization: `Bearer ${signToken(new mongoose.Types.ObjectId().toHexString())}` },
    body: form,
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, "Format d'image non accepté");
});

test("register refuse un mot de passe trop court (400)", async () => {
  const response = await fetch(base + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Court", email: "court@example.com", password: "1234" }),
  });

  assert.equal(response.status, 400);
});

test("login avec un corps vide n’ouvre jamais de session", async (t) => {
  // Cette route interroge MongoDB : sans base joignable, on l'ignore.
  if (!databaseReady()) return t.skip("MongoDB indisponible");

  const response = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).message, "Identifiants incorrects");
});

/* ------------------------------------------------------------------ */
/* Mission 7 — tests d'intégration (nécessitent MongoDB)              */
/* ------------------------------------------------------------------ */

test("pagination : page et limit sont respectés par le serveur", async (t) => {
  if (!databaseReady()) return t.skip("MongoDB indisponible");

  const suffix = Date.now();
  const owner = await User.create({
    name: "Paginateur",
    email: `pagination-${suffix}@example.com`,
    password: "12345678",
  });

  const created = [];
  try {
    for (let index = 1; index <= 3; index += 1) {
      created.push(
        await Track.create({
          ownerId: owner.id,
          title: `Piste ${index}`,
          originalName: `piste-${index}.mp3`,
          storedName: `piste-${index}.mp3`,
          mimeType: "audio/mpeg",
          size: 10,
        }),
      );
    }

    const headers = { Authorization: `Bearer ${signToken(owner.id)}` };

    const first = await fetch(base + "/api/tracks?page=1&limit=2", { headers });
    assert.equal(first.status, 200);
    const firstPage = await first.json();
    assert.equal(firstPage.items.length, 2);
    assert.equal(firstPage.page, 1);
    assert.equal(firstPage.limit, 2);
    assert.equal(firstPage.total, 3);
    assert.equal(firstPage.pages, 2);

    const second = await fetch(base + "/api/tracks?page=2&limit=2", { headers });
    const secondPage = await second.json();
    assert.equal(secondPage.items.length, 1, "la seconde page contient la piste restante");
    assert.equal(secondPage.page, 2);

    // Les identifiants des deux pages ne se recouvrent pas.
    const firstIds = firstPage.items.map((track) => track.id);
    const secondIds = secondPage.items.map((track) => track.id);
    assert.equal(firstIds.some((id) => secondIds.includes(id)), false);
  } finally {
    await Track.deleteMany({ ownerId: owner.id });
    await User.deleteOne({ _id: owner.id });
  }
});

test("une piste ne peut être lue ni supprimée par un autre utilisateur", async (t) => {
  if (!databaseReady()) return t.skip("MongoDB indisponible");

  const suffix = Date.now();
  const owner = await User.create({
    name: "Propriétaire",
    email: `owner-${suffix}@example.com`,
    password: "12345678",
  });
  const intruder = await User.create({
    name: "Intrus",
    email: `intruder-${suffix}@example.com`,
    password: "12345678",
  });

  try {
    const track = await Track.create({
      ownerId: owner.id,
      title: "Privée",
      originalName: "privee.mp3",
      storedName: "privee.mp3",
      mimeType: "audio/mpeg",
      size: 10,
    });

    const ownerHeaders = { Authorization: `Bearer ${signToken(owner.id)}` };
    const intruderHeaders = { Authorization: `Bearer ${signToken(intruder.id)}` };

    // Le propriétaire voit sa piste.
    const mine = await fetch(base + "/api/tracks", { headers: ownerHeaders });
    assert.equal((await mine.json()).items.length, 1);

    // L'intrus ne la voit pas et ne peut pas la supprimer.
    const theirs = await fetch(base + "/api/tracks", { headers: intruderHeaders });
    assert.equal((await theirs.json()).items.length, 0);

    const forbiddenDelete = await fetch(`${base}/api/tracks/${track.id}`, {
      method: "DELETE",
      headers: intruderHeaders,
    });
    assert.equal(forbiddenDelete.status, 404);

    const forbiddenAudio = await fetch(`${base}/api/tracks/${track.id}/audio`, {
      headers: intruderHeaders,
    });
    assert.equal(forbiddenAudio.status, 404);

    // La piste existe toujours.
    assert.ok(await Track.findById(track.id));
  } finally {
    await Track.deleteMany({ ownerId: { $in: [owner.id, intruder.id] } });
    await User.deleteMany({ _id: { $in: [owner.id, intruder.id] } });
  }
});


/* ------------------------------------------------------------------ */
/* Bonus TP2 — filtre par titre, pagination Mongoose, couverture       */
/* ------------------------------------------------------------------ */

/** Petite image PNG valide (1x1) utilisée comme pochette de test. */
const COVER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Enregistre un utilisateur de test jetable et renvoie son document. */
async function createUser(label) {
  return User.create({
    name: label,
    email: `${label.toLowerCase()}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.com`,
    password: "12345678",
  });
}

/** Crée une piste de test appartenant à `owner`. */
async function createTrack(owner, title, extra = {}) {
  return Track.create({
    ownerId: owner.id,
    title,
    originalName: `${title}.mp3`,
    storedName: `${title}-${Math.random().toString(16).slice(2, 8)}.mp3`,
    mimeType: "audio/mpeg",
    size: 10,
    ...extra,
  });
}

test("filtre par titre : q restreint les résultats côté serveur", async (t) => {
  if (!databaseReady()) return t.skip("MongoDB indisponible");

  const owner = await createUser("Filtre");

  try {
    for (const title of ["Blues en Mi", "Blues mineur", "Ballade"]) {
      await createTrack(owner, title);
    }

    const headers = { Authorization: `Bearer ${signToken(owner.id)}` };

    const all = await (await fetch(base + "/api/tracks", { headers })).json();
    assert.equal(all.total, 3, "sans filtre, les trois pistes sont renvoyées");

    const filtered = await (
      await fetch(base + "/api/tracks?q=blues", { headers })
    ).json();
    assert.equal(filtered.total, 2, "seules les deux pistes « Blues » correspondent");
    assert.ok(filtered.items.every((track) => /blues/i.test(track.title)));

    // La recherche ignore la casse et les espaces autour du terme.
    const upper = await (
      await fetch(base + "/api/tracks?q=%20BLUES%20", { headers })
    ).json();
    assert.equal(upper.total, 2);

    // Un motif d'expression régulière est traité comme du texte brut :
    // « .* » ne doit pas correspondre à toutes les pistes.
    const regex = await (
      await fetch(base + "/api/tracks?q=.*", { headers })
    ).json();
    assert.equal(regex.total, 0);

    const none = await (
      await fetch(base + "/api/tracks?q=introuvable", { headers })
    ).json();
    assert.equal(none.total, 0);
  } finally {
    await Track.deleteMany({ ownerId: owner.id });
    await User.deleteOne({ _id: owner.id });
  }
});

test("pagination : les métadonnées du plugin accompagnent la réponse", async (t) => {
  if (!databaseReady()) return t.skip("MongoDB indisponible");

  const owner = await createUser("Metadonnees");

  try {
    for (let index = 1; index <= 3; index += 1) {
      await createTrack(owner, `Piste ${index}`);
    }

    const headers = { Authorization: `Bearer ${signToken(owner.id)}` };

    const first = await (
      await fetch(base + "/api/tracks?page=1&limit=2", { headers })
    ).json();
    assert.equal(first.totalDocs, 3);
    assert.equal(first.totalPages, 2);
    assert.equal(first.pagingCounter, 1);
    assert.equal(first.hasPrevPage, false);
    assert.equal(first.hasNextPage, true);
    assert.equal(first.prevPage, null);
    assert.equal(first.nextPage, 2);

    const second = await (
      await fetch(base + "/api/tracks?page=2&limit=2", { headers })
    ).json();
    assert.equal(second.hasPrevPage, true);
    assert.equal(second.hasNextPage, false);
    assert.equal(second.prevPage, 1);
    assert.equal(second.nextPage, null);
    assert.equal(second.pagingCounter, 3);

    // Le filtre et la pagination se combinent : le total porte sur le filtre.
    const filtered = await (
      await fetch(base + "/api/tracks?q=Piste&page=1&limit=2", { headers })
    ).json();
    assert.equal(filtered.totalDocs, 3);
    assert.equal(filtered.totalPages, 2);
    assert.equal(filtered.hasNextPage, true);
  } finally {
    await Track.deleteMany({ ownerId: owner.id });
    await User.deleteOne({ _id: owner.id });
  }
});

test("image de couverture : envoi, lecture protégée et suppression", async (t) => {
  if (!databaseReady()) return t.skip("MongoDB indisponible");

  const owner = await createUser("Pochette");
  const intruder = await createUser("Intrus");

  try {
    const headers = { Authorization: `Bearer ${signToken(owner.id)}` };

    const form = new FormData();
    form.append(
      "audio",
      new File(["contenu audio"], "morceau.mp3", { type: "audio/mpeg" }),
    );
    form.append("cover", new File([COVER_PNG], "pochette.png", { type: "image/png" }));
    form.append("title", "Avec pochette");

    const created = await fetch(base + "/api/tracks", {
      method: "POST",
      headers,
      body: form,
    });
    assert.equal(created.status, 201);
    const track = await created.json();

    assert.equal(track.hasCover, true);
    assert.equal(track.coverMimeType, "image/png");
    // Le nom du fichier stocké ne doit jamais sortir du serveur.
    assert.equal("coverStoredName" in track, false);

    // Le propriétaire récupère son image…
    const cover = await fetch(`${base}/api/tracks/${track.id}/cover`, { headers });
    assert.equal(cover.status, 200);
    assert.equal(cover.headers.get("content-type"), "image/png");
    assert.ok((await cover.arrayBuffer()).byteLength > 0);

    // …mais pas un autre utilisateur.
    const forbidden = await fetch(`${base}/api/tracks/${track.id}/cover`, {
      headers: { Authorization: `Bearer ${signToken(intruder.id)}` },
    });
    assert.equal(forbidden.status, 404);

    // La liste signale la pochette sans exposer le nom du fichier.
    const list = await (await fetch(base + "/api/tracks", { headers })).json();
    assert.equal(list.items[0].hasCover, true);
    assert.equal("coverStoredName" in list.items[0], false);

    // Une piste sans pochette répond 404 sur la route dédiée.
    const withoutCover = await createTrack(owner, "Sans pochette");
    const missing = await fetch(`${base}/api/tracks/${withoutCover.id}/cover`, {
      headers,
    });
    assert.equal(missing.status, 404);

    // À la suppression, la piste disparaît de la base et son image aussi.
    const removed = await fetch(`${base}/api/tracks/${track.id}`, {
      method: "DELETE",
      headers,
    });
    assert.equal(removed.status, 204);
    assert.equal(await Track.findById(track.id), null);

    const gone = await fetch(`${base}/api/tracks/${track.id}/cover`, { headers });
    assert.equal(gone.status, 404);
  } finally {
    await Track.deleteMany({ ownerId: { $in: [owner.id, intruder.id] } });
    await User.deleteMany({ _id: { $in: [owner.id, intruder.id] } });
  }
});
