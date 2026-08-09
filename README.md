# GMAO Hospitalière

Application de gestion de maintenance assistée par ordinateur (GMAO / CMMS)
pour la maintenance biomédicale et technique en établissement hospitalier :
équipements, équipes, interventions, plans de maintenance préventive,
documents, contrats, tableau de bord et assistant IA intégré.

## Stack technique

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Supabase** : Postgres (schéma + Row Level Security), Auth, Storage
- **Tailwind CSS**
- **Anthropic Claude** (`claude-opus-5`) pour l'assistant conversationnel, en
  tool-use en lecture seule sur les données Supabase (pas de RAG vectoriel en
  V1 — voir « Limites connues »)

## Mise en route

### 1. Projet Supabase

1. Créez un projet sur [supabase.com](https://supabase.com) (idéalement une
   région européenne pour des données de santé).
2. Dans le **SQL Editor**, exécutez dans l'ordre :
   - `supabase/schema.sql` (tables, vues, fonctions, triggers, RLS)
   - `supabase/seed.sql` (jeu de données de démonstration)
3. Dans **Storage**, créez un bucket **privé** nommé `documents` (Public =
   OFF). Les politiques d'accès sont déjà définies par `schema.sql`.
4. Dans **Authentication → Providers**, l'email/mot de passe suffit pour
   démarrer. Désactivez `Enable email signups` une fois vos comptes de
   démonstration créés (dans une GMAO hospitalière, les comptes sont créés
   par l'administrateur, pas en self-service).
5. Créez 4 comptes via la page `/inscription` de l'application (un par
   rôle), puis, dans la table `profiles` (SQL Editor), mettez à jour leur
   colonne `role` — tout nouveau compte est créé en `lecture_seule` par
   défaut (principe du moindre privilège) :
   ```sql
   update profiles set role = 'admin' where email = 'vous@exemple.com';
   ```
   Rôles disponibles : `admin`, `responsable_maintenance`, `technicien`,
   `lecture_seule`.

### 2. Variables d'environnement

Copiez `.env.example` vers `.env.local` et renseignez :

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # Réglages API du projet Supabase
ANTHROPIC_API_KEY=...           # console.anthropic.com
CRON_SECRET=...                 # chaîne aléatoire longue, générée par vous
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 3. Installation et lancement

```bash
npm install
npm run dev
```

### 4. Tâches planifiées (préventif automatique, alertes contrats)

Deux fonctions Postgres génèrent automatiquement les interventions
préventives dues et les alertes d'expiration de contrats
(`fn_generer_interventions_preventives`, `fn_generer_alertes_contrats` —
toutes deux idempotentes, rejouables sans dupliquer). Deux façons de les
déclencher quotidiennement :

- **pg_cron** (recommandé) : activez l'extension `pg_cron` depuis
  *Database → Extensions* dans le Dashboard Supabase, puis dans le SQL
  Editor :
  ```sql
  select cron.schedule('preventif-quotidien', '0 5 * * *',
    $$ select public.fn_generer_interventions_preventives(); $$);
  select cron.schedule('alertes-contrats-quotidien', '30 5 * * *',
    $$ select public.fn_generer_alertes_contrats(90); $$);
  ```
- **Ordonnanceur externe** (filet ou alternative) : appelez quotidiennement
  `POST /api/cron/maintenance-preventive` et `POST /api/cron/alertes-contrats`
  avec l'en-tête `x-cron-secret: <CRON_SECRET>`.

## Rôles et permissions

| Rôle | Portée |
|---|---|
| `admin` | Tout, y compris gestion des comptes et suppressions. |
| `responsable_maintenance` | CRUD complet sur le métier (équipements, équipes, interventions, plans, documents, contrats). |
| `technicien` | Lecture globale ; écriture sur ses interventions/équipes assignées ; création d'interventions correctives ; upload de documents. |
| `lecture_seule` | Lecture seule partout (rôle par défaut à l'inscription). |

L'autorisation réelle est appliquée par les politiques **Row Level
Security** de Postgres (`supabase/schema.sql`) — les vérifications de rôle
côté UI (`src/lib/permissions.ts`) ne sont que des raccourcis d'ergonomie.

## Assistant IA

L'assistant (panneau flottant sur toutes les pages + page `/assistant`)
interroge les données en direct via des outils Claude en lecture seule
(`src/lib/chat/tools.ts`, `src/lib/chat/handlers.ts`). Chaque outil s'exécute
avec le client Supabase de la requête : le RLS s'applique donc avec
l'identité réelle de l'utilisateur connecté — un compte `lecture_seule` et un
compte `admin` posant la même question n'ont pas nécessairement la même
réponse.

## Limites connues (V1)

- **Pas de RAG documentaire** : l'assistant ne lit pas le contenu des
  fichiers uploadés (manuels, procédures), seulement leurs métadonnées. Le
  schéma prévoit déjà les colonnes nécessaires (`documents.statut_indexation`,
  `indexe_le`) pour ajouter une V2 avec embeddings/pgvector sans
  rearchitecture.
- **Hébergement** : Supabase Cloud ne constitue pas en soi un hébergement
  agréé données de santé (HDS). Pour une mise en production réelle en
  établissement hospitalier, vérifiez les exigences réglementaires
  applicables (HDS en France, équivalents locaux ailleurs).
- **Dépendances** : `next@15.5.x` embarque des dépendances transitives
  (`postcss`, `sharp`) avec des vulnérabilités connues, corrigées uniquement
  par la mise à jour majeure vers Next 16 (`npm audit`). Cette montée de
  version n'a pas été faite dans cette V1 pour rester sur la stack validée
  (Next 15 / React 19) ; à planifier avant une mise en production.
- **Hors périmètre V1**, explicitement repoussé en V2+ : gestion de stock de
  pièces détachées, maintenance conditionnelle sur compteurs d'usage, QR
  codes/PWA terrain, signature électronique des bons d'intervention.

## Structure du projet

```
supabase/
  schema.sql   # tables, vues (security_invoker), fonctions, triggers, RLS
  seed.sql     # jeu de données de démonstration
src/
  app/
    (auth)/            # connexion, inscription, mot de passe oublié
    (app)/              # application (sidebar + topbar), une route par module
    api/chat/           # assistant IA (streaming, conversations)
    api/cron/           # génération préventif + alertes contrats
    api/documents/      # URLs signées
    api/export/         # export CSV
  actions/              # Server Actions (écritures), un fichier par domaine
  components/           # UI, organisés par domaine + primitives réutilisables (ui/)
  lib/                  # clients Supabase/Anthropic, types, permissions, validation Zod
```
