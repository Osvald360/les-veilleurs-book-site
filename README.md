# Les Veilleurs et l'étude des signes — Plateforme de lancement

Plateforme de vente en ligne pour le livre **« Les Veilleurs et l'étude des signes »**
de Michel Ambouroue (CRN Éditions).

Vente en édition limitée sur une fenêtre de 24 heures, avec compte à rebours
partagé, compteur d'exemplaires, paiements multi-canaux (Europe et Afrique
centrale) et tableau de bord d'administration.

---

## Stack technique

- **Hébergement** : Vercel (fonctions serverless)
- **Base de données** : Upstash Redis (via l'intégration Vercel Storage)
- **Front** : HTML/CSS/JS sans framework, dans un fichier unique
- **Paiements** : Stripe (carte, Apple Pay), PayPal, SingPay (Airtel Money / Moov Money)
- **E-mails** : Resend + API Anthropic pour la rédaction du message

Aucune étape de build : le site est servi tel quel.

---

## Structure

```
index.html              Page publique + tableau de bord admin (vidéo intégrée en base64)
author.jpg              Photo de l'auteur (page)
author-email.jpg        Photo recadrée pour la signature e-mail (200x300)
presentation.mp4        Vidéo de présentation (source)
vercel.json             Configuration Vercel
package.json            Dépendances
.env.example            Variables d'environnement à définir

api/
  admin.js              Endpoint unique du tableau de bord (action en paramètre)
  checkout.js           Initiation des paiements (Stripe / PayPal / SingPay)
  launch.js             État de la vente : compte à rebours, stock, prix
  order.js              Création d'une commande
  payment-status.js     Moyens de paiement configurés
  paypal-return.js      Capture du paiement au retour de PayPal
  transaction.js        Enregistrement des intentions de paiement
  visit.js              Compteur de visites
  webhook/
    stripe.js           Confirmation Stripe (signature vérifiée)
    singpay.js          Confirmation SingPay (callback Mobile Money)
  _lib/
    store.js            Couche d'accès Redis (détecte si la base est connectée)
    auth.js             Authentification admin + limitation des tentatives
    orders.js           Gestion des commandes
    settings.js         Réglages (clés de paiement, prix)
    thankyou.js         E-mail de remerciement rédigé par IA
```

> **Pas de dossier `public/`** : sur Vercel, sa présence masquerait
> `index.html` et provoquerait une erreur 404. Les images restent à la racine.

---

## Installation

### 1. Base de données

Vercel → projet → **Storage** → **Marketplace Database Providers** → **Upstash**
→ produit **Redis** → créer → **Connect Project** (environnement Production).

Les variables `KV_REST_API_URL` et `KV_REST_API_TOKEN` sont ajoutées
automatiquement. Le code accepte aussi les noms `UPSTASH_REDIS_REST_*`.

### 2. Variables d'environnement

Voir `.env.example`. À définir dans Vercel → Settings → Environment Variables :

| Variable | Rôle | Obligatoire |
|---|---|---|
| `ADMIN_PASSWORD` | Mot de passe du tableau de bord | Recommandé |
| `KV_REST_API_URL` | Base Upstash | Oui (auto) |
| `KV_REST_API_TOKEN` | Base Upstash | Oui (auto) |
| `RESEND_API_KEY` | Envoi des e-mails | Non |
| `RESEND_FROM_EMAIL` | Adresse d'expédition | Non |
| `ANTHROPIC_API_KEY` | Rédaction du message | Non |

### 3. Clés de paiement

Elles ne se mettent **pas** dans les variables d'environnement, mais dans le
tableau de bord du site (onglet **Paiements**). Elles sont stockées côté
serveur et ne sont jamais renvoyées en clair au navigateur.

- **Stripe** : clé publique, clé secrète, secret de webhook
  → webhook à créer vers `/api/webhook/stripe`, événement `checkout.session.completed`
- **PayPal** : Client ID, Client Secret, mode (`sandbox` ou `live`)
- **SingPay** : Client ID, Client Secret, ID de portefeuille
  → callback à configurer dans SingPay vers `/api/webhook/singpay`

---

## Tableau de bord

Accessible depuis le lien « Administration » en bas de page.

- **Statistiques** — visiteurs, ventes, recettes, exemplaires restants, conversion
- **Commandes** — recherche, filtre, marquage manuel « payé », export CSV
- **Paiements** — clés marchands, prix du livre (EUR et FCFA), nombre d'exemplaires
- **Système** — diagnostic complet et contrôle de la vente
  (programmer, lancer, clôturer, rouvrir)

Sécurité : comparaison du mot de passe à durée constante, blocage après
8 tentatives par IP pendant 15 minutes.

---

## Fonctionnement de la vente

L'état est calculé côté serveur (`api/launch.js`) pour que tous les visiteurs
voient la même chose, indépendamment de l'horloge de leur appareil.

| État | Signification |
|---|---|
| `idle` | Jamais lancée |
| `scheduled` | Ouverture programmée à une date future |
| `open` | Vente en cours |
| `ended` | Durée écoulée |
| `soldout` | Plus d'exemplaires |
| `closed` | Clôturée manuellement |

---

## Déploiement

Le projet se déploie tel quel sur Vercel, sans build.

- **Via GitHub** : connecter le dépôt au projet Vercel (déploiement automatique)
- **Via Vercel Drop** : glisser le dossier zippé sur la page Overview du projet

> Le plan Hobby de Vercel interdit l'usage commercial : passer au plan **Pro**
> avant toute vente réelle.

---

## Reste à faire avant une mise en vente publique

- Mentions légales, CGV, politique de confidentialité (RGPD)
- Information sur le droit de rétractation
- Accord écrit avec l'éditeur sur qui encaisse et comment les fonds sont reversés
