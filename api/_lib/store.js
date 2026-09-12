// Couche d'accès au stockage.
//
// Objectif : ne plus jamais échouer en silence. Si la base de données n'est
// pas connectée, on le sait explicitement et on peut l'afficher dans le
// tableau de bord au lieu de laisser l'utilisateur deviner.
//
// Vercel KV / Upstash renseigne automatiquement ces variables
// d'environnement quand la base est reliée au projet.

import { Redis } from '@upstash/redis';

const URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  '';
const TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  '';

export const storageReady = Boolean(URL && TOKEN);

let client = null;
if (storageReady) {
  client = new Redis({ url: URL, token: TOKEN });
}

// Erreur typée : permet aux endpoints de répondre proprement
// « base non connectée » plutôt qu'une erreur 500 opaque.
export class StorageNotConfigured extends Error {
  constructor() {
    super('storage_not_configured');
    this.code = 'storage_not_configured';
  }
}

function need() {
  if (!client) throw new StorageNotConfigured();
  return client;
}

export const store = {
  get: (k) => need().get(k),
  mget: (ks) => need().mget(...ks),
  set: (k, v) => need().set(k, v),
  setnx: (k, v) => need().setnx(k, v),
  del: (k) => need().del(k),
  lpush: (k, v) => need().lpush(k, v),
  lrange: (k, a, b) => need().lrange(k, a, b),
  ltrim: (k, a, b) => need().ltrim(k, a, b),
  incr: (k) => need().incr(k),
  expire: (k, s) => need().expire(k, s),
};

// Test de connexion réel (utilisé par le tableau de bord).
export async function storageHealth() {
  if (!storageReady) {
    return { ready: false, reason: 'Aucune base de données connectée au projet.' };
  }
  try {
    await client.set('healthcheck', Date.now());
    await client.get('healthcheck');
    return { ready: true };
  } catch (e) {
    return { ready: false, reason: 'Base connectée mais injoignable : ' + (e.message || 'erreur inconnue') };
  }
}
