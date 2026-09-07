# Les Veilleurs — Mise en route avant le lancement

Ce guide couvre tout ce qu'il reste à faire pour que la plateforme soit
réellement opérationnelle. À faire une seule fois, dans cet ordre.

Le tableau de bord a un onglet **Système** qui affiche en permanence ce qui
est prêt et ce qui manque. C'est votre référence : tant qu'un point est
marqué « bloquant », le site n'est pas prêt à encaisser de vraies commandes.

---

## Étape 1 — Passer au plan Pro (au moment du lancement)

Le plan gratuit de Vercel interdit l'usage commercial. Dès que le livre est
mis en vente, il faut le plan **Pro** (20 $/mois).

À faire le jour du lancement, pas avant.

---

## Étape 2 — Créer la base de données (INDISPENSABLE)

Sans elle, **rien n'est enregistré** : les commandes disparaissent, les
réglages ne tiennent pas, le compte à rebours redémarre à chaque visiteur.
C'est la cause n°1 d'un site qui « ne retient rien ».

> À savoir : « Vercel KV » n'existe plus. Vercel est passé par des
> partenaires. La base à créer s'appelle maintenant **Upstash for Redis**,
> et se crée depuis le Marketplace de Vercel. C'est exactement la même
> chose techniquement.

1. Ouvrir le projet sur **vercel.com**
2. Onglet **Storage**
3. Section **Marketplace Database Providers** → choisir **Upstash**
   (produit : **Redis**) → **Create** / **Install**
4. Si c'est la première fois, Vercel propose de gérer le compte Upstash
   à votre place : accepter (le plus simple, tout reste sur Vercel)
5. Configurer : nom (ex. `veilleurs-db`), région la plus proche
   (Europe si acheteurs européens), plan **gratuit** pour les tests
6. **Connect Project** → sélectionner ce projet → environnement
   **Production** (cocher aussi Preview et Development si proposé)
7. Redéployer : onglet **Deployments** → dernier déploiement →
   menu ⋯ → **Redeploy**

L'intégration ajoute automatiquement les identifiants de connexion dans les
variables d'environnement du projet. Le code les détecte seul (il accepte
les deux formats de noms, `KV_REST_API_*` comme `UPSTASH_REDIS_REST_*`).

**Vérification :** tableau de bord → onglet **Système** → la ligne
« Base de données » doit passer au vert. Si elle reste rouge, c'est que le
projet n'a pas été relié à la base, ou que le redéploiement n'a pas été fait.

Le plan gratuit d'Upstash (256 Mo, 30 000 commandes/jour) suffit très
largement pour une vente de 200 exemplaires sur 24 h.

---

## Étape 3 — Changer le mot de passe administrateur (INDISPENSABLE)

Le mot de passe par défaut (`Michel`) est écrit dans le code du site :
n'importe qui peut le retrouver, entrer dans le tableau de bord, lire les
coordonnées des acheteurs et modifier les clés de paiement.

1. Projet Vercel → **Settings** → **Environment Variables**
2. Ajouter :
   - Nom : `ADMIN_PASSWORD`
   - Valeur : un mot de passe d'au moins 12 caractères, unique
   - Environnement : **Production**
3. Redéployer

Protection déjà en place : au-delà de 8 essais ratés, l'adresse est bloquée
15 minutes.

---

## Étape 4 — Comptes marchands

À faire une fois les comptes ouverts. Les identifiants se collent dans le
tableau de bord → onglet **Paiements**. Ils sont stockés côté serveur et ne
sont jamais réaffichés en clair.

### Stripe (carte bancaire, Apple Pay)
- Clés sur dashboard.stripe.com → Développeurs → Clés API
- Créer un webhook vers `https://VOTRE-SITE/api/webhook/stripe`
  - événement : `checkout.session.completed`
  - copier le secret `whsec_...` dans le tableau de bord

Sans ce secret, un paiement par carte ne sera **pas** marqué « payé »
automatiquement.

### PayPal
- developer.paypal.com → My Apps & Credentials
- Basculer le mode sur **live** pour la vraie vente

### SingPay (Airtel Money, Moov Money)
- Créez un compte sur client.singpay.ga → section API pour récupérer :
  Client ID, Client Secret, ID du portefeuille (wallet, ex. am7314)
- Dans SingPay Workspace, configurez l'URL de callback du portefeuille :
  `https://VOTRE-SITE/api/webhook/singpay`
- Collez les identifiants dans l'admin → onglet Paiements → SingPay
- Le client paie par push USSD : il valide directement sur son téléphone,
  sans quitter le site. SingPay confirme ensuite via le callback.

---

## Étape 5 — E-mail de remerciement (optionnel)

Envoyé automatiquement après un paiement confirmé.

Variables d'environnement à ajouter sur Vercel :
- `RESEND_API_KEY` — compte sur resend.com
- `RESEND_FROM_EMAIL` — adresse d'expédition vérifiée
- `ANTHROPIC_API_KEY` — pour la rédaction du message

Sans ces variables, aucun e-mail n'est envoyé (le reste fonctionne).

---

## Étape 6 — Piloter la vente

Tout se fait dans le tableau de bord → onglet **Système** → bloc
**Contrôle de la vente**. Un badge indique l'état en permanence :

| État | Signification |
|------|---------------|
| Jamais lancée | Aucune date définie |
| Programmée | Ouverture prévue à une date future |
| En cours | Vente ouverte, compte à rebours actif |
| Terminée | Durée écoulée |
| Épuisée | Plus d'exemplaires |
| Clôturée manuellement | Fermée depuis le tableau de bord |

**Programmer le lancement de septembre :** indiquez la date et l'heure
d'ouverture, la durée (24 h), puis « Programmer / Lancer la vente ».
D'ici là, les visiteurs voient « Bientôt disponible » et un compte à rebours
jusqu'à l'ouverture. À l'heure dite, la vente s'ouvre toute seule.

**Autres commandes :**
- *Lancer maintenant* — démarre immédiatement
- *Clôturer immédiatement* — ferme la vente quel que soit le temps restant
- *Rouvrir* — annule une clôture manuelle

La vente peut être relancée autant de fois que nécessaire : chaque
relance rouvre la vente et redémarre le compte à rebours.

Le nombre d'exemplaires se règle dans l'onglet **Paiements → Lancement**.

> Avant le vrai lancement : « Réinitialiser les données » pour effacer les
> commandes de test, puis programmez la vente.

---

## Ce que fait le tableau de bord

**Statistiques** — visiteurs, ventes confirmées, recettes, exemplaires
restants, coordonnées collectées, taux de conversion.

**Commandes** — recherche, filtre par statut, marquage manuel « payé »
(utile pour un virement ou un mobile money encaissé hors ligne), export CSV.

**Paiements** — identifiants marchands et nombre d'exemplaires.

**Système** — diagnostic complet : ce qui marche, ce qui manque, et pourquoi
c'est important.

---

## Répétition générale conseillée

Avant septembre, avec Stripe en mode **test** :

1. Base de données créée, mot de passe changé
2. Passer une commande de bout en bout avec une carte de test Stripe
   (`4242 4242 4242 4242`)
3. Vérifier que la commande apparaît en « payé » et que le compteur
   d'exemplaires descend
4. Tester l'export CSV
5. « Réinitialiser les données » avant le vrai lancement

---

## Reste à faire avant une vente au public (juridique)

Non inclus dans le site à ce stade, mais obligatoire pour une vente en
Europe : mentions légales, conditions générales de vente, politique de
confidentialité (RGPD), information sur le droit de rétractation.
