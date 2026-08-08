-- ============================================================================
-- GMAO Hospitalière — schéma Supabase (Postgres)
-- ============================================================================
-- Organisation : extensions → tables → index → fonctions/triggers →
--                fonctions RLS → politiques RLS → vues → politiques Storage →
--                tâches planifiées (pg_cron, optionnel).
--
-- Hors périmètre V1 (volontairement absent de ce schéma) : gestion de stock
-- de pièces détachées, maintenance conditionnelle sur compteurs, RAG
-- documentaire (document_chunks + embeddings + pgvector). Le RAG pourra être
-- ajouté en V2 sans rearchitecture : `documents` porte déjà les colonnes
-- `statut_indexation` / `indexe_le` prévues à cet effet.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensions
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- recherche texte approximative

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------

-- Profils utilisateurs, extension de auth.users.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nom_complet text,
  telephone text,
  role text not null default 'lecture_seule'
    check (role in ('admin', 'responsable_maintenance', 'technicien', 'lecture_seule')),
  avatar_url text,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.profiles is 'Extension de auth.users. Le rôle par défaut est le moins privilégié (principe du moindre privilège) ; un admin promeut ensuite.';

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  adresse text,
  ville text,
  code_postal text,
  created_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  nom text not null,
  code text,
  etage text,
  responsable_nom text,
  telephone text,
  created_at timestamptz not null default now(),
  unique (site_id, nom)
);

create table public.categories_equipement (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  famille text not null default 'autre'
    check (famille in ('biomedical', 'technique', 'informatique', 'autre')),
  description text,
  criticite_par_defaut text default 'moyenne'
    check (criticite_par_defaut in ('vitale', 'haute', 'moyenne', 'basse')),
  created_at timestamptz not null default now()
);

create table public.fournisseurs (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  contact_nom text,
  email text,
  telephone text,
  adresse text,
  siret text,
  notes text,
  created_at timestamptz not null default now()
);

-- Équipements : table centrale du parc biomédical/technique.
create table public.equipements (
  id uuid primary key default gen_random_uuid(),
  code_interne text not null unique,
  nom text not null,
  categorie_id uuid references public.categories_equipement(id) on delete set null,
  numero_serie text,
  modele text,
  fabricant text,
  fournisseur_id uuid references public.fournisseurs(id) on delete set null,
  site_id uuid not null references public.sites(id) on delete restrict,
  service_id uuid references public.services(id) on delete set null,
  localisation_precise text,
  statut text not null default 'operationnel'
    check (statut in ('operationnel', 'en_panne', 'en_maintenance', 'hors_service', 'reforme')),
  criticite text not null default 'moyenne'
    check (criticite in ('vitale', 'haute', 'moyenne', 'basse')),
  date_achat date,
  date_mise_service date,
  fin_garantie date,
  cout_acquisition numeric(12, 2),
  photo_url text,
  notes text,
  actif boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.equipements.criticite is 'Pivot métier hospitalier : vitale = dispositif de maintien en vie (respirateur, moniteur, défibrillateur...).';

create table public.equipes (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  specialite text,
  description text,
  responsable_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.membres_equipe (
  equipe_id uuid not null references public.equipes(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_dans_equipe text default 'technicien',
  date_affectation date default current_date,
  primary key (equipe_id, profile_id)
);

create table public.competences (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  description text
);

create table public.profil_competences (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  competence_id uuid not null references public.competences(id) on delete cascade,
  niveau smallint not null default 1 check (niveau between 1 and 4),
  date_certification date,
  primary key (profile_id, competence_id)
);

-- Moteur du préventif récurrent.
create table public.plans_maintenance (
  id uuid primary key default gen_random_uuid(),
  equipement_id uuid not null references public.equipements(id) on delete cascade,
  nom text not null,
  description text,
  type_intervention text not null default 'preventive'
    check (type_intervention in ('preventive', 'controle_reglementaire')),
  frequence_valeur integer not null check (frequence_valeur > 0),
  frequence_unite text not null check (frequence_unite in ('jours', 'semaines', 'mois', 'annees')),
  prochaine_echeance date not null,
  derniere_execution date,
  duree_estimee_min integer,
  equipe_id uuid references public.equipes(id) on delete set null,
  priorite text not null default 'normale'
    check (priorite in ('urgente', 'haute', 'normale', 'basse')),
  checklist jsonb not null default '[]'::jsonb,
  jours_anticipation integer not null default 7,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

-- Ordres de travail (interventions).
create table public.interventions (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  titre text not null,
  description text,
  type text not null
    check (type in ('preventive', 'corrective', 'controle_reglementaire', 'amelioration')),
  equipement_id uuid not null references public.equipements(id) on delete restrict,
  plan_maintenance_id uuid references public.plans_maintenance(id) on delete set null,
  demandeur_id uuid references public.profiles(id) on delete set null,
  equipe_id uuid references public.equipes(id) on delete set null,
  technicien_id uuid references public.profiles(id) on delete set null,
  statut text not null default 'a_faire'
    check (statut in ('a_faire', 'en_cours', 'en_attente_pieces', 'terminee', 'annulee')),
  priorite text not null default 'normale'
    check (priorite in ('urgente', 'haute', 'normale', 'basse')),
  date_planifiee timestamptz,
  date_echeance timestamptz,
  date_debut timestamptz,
  date_fin timestamptz,
  duree_reelle_min integer,
  arret_equipement boolean not null default false,
  compte_rendu text,
  checklist_resultats jsonb default '[]'::jsonb,
  cout_pieces numeric(10, 2) not null default 0,
  cout_main_oeuvre numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.interventions_historique (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  type_evenement text not null
    check (type_evenement in ('creation', 'changement_statut', 'affectation', 'commentaire', 'cloture')),
  ancien_statut text,
  nouveau_statut text,
  commentaire text,
  created_at timestamptz not null default now()
);

create table public.contrats (
  id uuid primary key default gen_random_uuid(),
  reference text not null,
  intitule text not null,
  fournisseur_id uuid not null references public.fournisseurs(id) on delete restrict,
  type_contrat text not null
    check (type_contrat in ('maintenance_preventive', 'full_service', 'garantie', 'location', 'assistance')),
  date_debut date not null,
  date_fin date not null,
  cout_annuel numeric(12, 2),
  delai_intervention_heures integer,
  couverture_horaire text,
  conditions text,
  tacite_reconduction boolean not null default false,
  preavis_jours integer default 90,
  statut text not null default 'actif'
    check (statut in ('actif', 'expire', 'resilie', 'en_renouvellement')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_fin > date_debut)
);

create table public.contrats_equipements (
  contrat_id uuid not null references public.contrats(id) on delete cascade,
  equipement_id uuid not null references public.equipements(id) on delete cascade,
  primary key (contrat_id, equipement_id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  type_document text not null
    check (type_document in ('manuel', 'certificat', 'procedure', 'rapport_controle', 'photo', 'facture', 'autre')),
  chemin_stockage text not null,
  nom_fichier text,
  mime_type text,
  taille_octets bigint,
  equipement_id uuid references public.equipements(id) on delete cascade,
  contrat_id uuid references public.contrats(id) on delete cascade,
  intervention_id uuid references public.interventions(id) on delete cascade,
  tags text[] not null default '{}',
  description text,
  -- Préparation V2 (RAG documentaire) : colonnes inertes en V1.
  statut_indexation text not null default 'non_indexe'
    check (statut_indexation in ('non_indexe', 'en_cours', 'indexe', 'erreur')),
  indexe_le timestamptz,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  role_cible text check (role_cible in ('admin', 'responsable_maintenance', 'technicien', 'lecture_seule')),
  type text not null
    check (type in ('maintenance_due', 'intervention_retard', 'contrat_expire', 'equipement_panne', 'affectation')),
  titre text not null,
  message text,
  lien text,
  lu boolean not null default false,
  created_at timestamptz not null default now(),
  check (profile_id is not null or role_cible is not null)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  titre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages_chat (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  contenu text not null,
  outils_utilises jsonb not null default '[]'::jsonb,
  tokens_entree integer,
  tokens_sortie integer,
  created_at timestamptz not null default now()
);

create table public.journal_audit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  table_concernee text not null,
  enregistrement_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  donnees_avant jsonb,
  donnees_apres jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. Index
-- ----------------------------------------------------------------------------
create index idx_equipements_statut on public.equipements(statut);
create index idx_equipements_criticite on public.equipements(criticite);
create index idx_equipements_service on public.equipements(service_id);
create index idx_equipements_categorie on public.equipements(categorie_id);
create index idx_equipements_fin_garantie on public.equipements(fin_garantie);
create index idx_equipements_recherche on public.equipements
  using gin ((coalesce(nom, '') || ' ' || coalesce(code_interne, '') || ' ' || coalesce(numero_serie, '')) gin_trgm_ops);

create index idx_interventions_statut on public.interventions(statut);
create index idx_interventions_equipement on public.interventions(equipement_id);
create index idx_interventions_technicien on public.interventions(technicien_id);
create index idx_interventions_equipe on public.interventions(equipe_id);
create index idx_interventions_echeance on public.interventions(date_echeance);
create index idx_interventions_ouvertes on public.interventions(date_echeance)
  where statut in ('a_faire', 'en_cours', 'en_attente_pieces');

create index idx_interventions_historique_intervention on public.interventions_historique(intervention_id);

create index idx_plans_maintenance_echeance on public.plans_maintenance(prochaine_echeance) where actif;
create index idx_plans_maintenance_equipement on public.plans_maintenance(equipement_id);

create index idx_documents_equipement on public.documents(equipement_id);
create index idx_documents_contrat on public.documents(contrat_id);
create index idx_documents_intervention on public.documents(intervention_id);

create index idx_contrats_date_fin on public.contrats(date_fin);
create index idx_contrats_equipements_equipement on public.contrats_equipements(equipement_id);

create index idx_notifications_profile on public.notifications(profile_id, lu);
create index idx_messages_chat_conversation on public.messages_chat(conversation_id);
create index idx_journal_audit_table on public.journal_audit(table_concernee, enregistrement_id);

-- ----------------------------------------------------------------------------
-- 4. Fonctions & triggers utilitaires
-- ----------------------------------------------------------------------------

create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_equipements_updated_at before update on public.equipements
  for each row execute function public.fn_set_updated_at();
create trigger trg_interventions_updated_at before update on public.interventions
  for each row execute function public.fn_set_updated_at();
create trigger trg_contrats_updated_at before update on public.contrats
  for each row execute function public.fn_set_updated_at();
create trigger trg_conversations_updated_at before update on public.conversations
  for each row execute function public.fn_set_updated_at();

-- Création automatique du profil à l'inscription (pattern repris de formafind).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, nom_complet, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nom_complet', split_part(new.email, '@', 1)),
    'lecture_seule'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Numérotation automatique des interventions : INT-<année>-<séquence>.
create sequence if not exists public.seq_intervention_numero start 1;

create or replace function public.fn_set_numero_intervention()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null then
    new.numero := 'INT-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.seq_intervention_numero')::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger trg_set_numero_intervention before insert on public.interventions
  for each row execute function public.fn_set_numero_intervention();

-- Journal métier des interventions (distinct de l'audit technique).
create or replace function public.fn_log_intervention()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.interventions_historique (intervention_id, profile_id, type_evenement, nouveau_statut)
    values (new.id, auth.uid(), 'creation', new.statut);
  elsif tg_op = 'UPDATE' and new.statut is distinct from old.statut then
    insert into public.interventions_historique (intervention_id, profile_id, type_evenement, ancien_statut, nouveau_statut)
    values (new.id, auth.uid(), 'changement_statut', old.statut, new.statut);
  end if;
  return new;
end;
$$;

create trigger trg_log_intervention after insert or update on public.interventions
  for each row execute function public.fn_log_intervention();

-- Journal d'audit générique (traçabilité réglementaire sur le parc biomédical).
create or replace function public.fn_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.journal_audit (profile_id, table_concernee, enregistrement_id, action, donnees_avant, donnees_apres)
  values (
    auth.uid(),
    tg_table_name,
    coalesce(new.id, old.id),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create trigger trg_audit_equipements after insert or update or delete on public.equipements
  for each row execute function public.fn_audit();
create trigger trg_audit_interventions after insert or update or delete on public.interventions
  for each row execute function public.fn_audit();
create trigger trg_audit_contrats after insert or update or delete on public.contrats
  for each row execute function public.fn_audit();
create trigger trg_audit_profiles after update on public.profiles
  for each row execute function public.fn_audit();

-- ----------------------------------------------------------------------------
-- 5. Fonctions RLS (SECURITY DEFINER, court-circuitent le RLS pour éviter
--    les sous-SELECT répétés par ligne et la récursion infinie sur profiles)
-- ----------------------------------------------------------------------------

create or replace function public.mon_role()
returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.a_role(roles text[])
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.mon_role() = any(roles);
$$;

create or replace function public.mes_equipes()
returns uuid[]
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(array_agg(equipe_id), '{}') from public.membres_equipe where profile_id = auth.uid();
$$;

-- Verrouille la colonne `role` : seul un admin peut la modifier.
create or replace function public.fn_verrouiller_role()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role and not public.a_role(array['admin']) then
    raise exception 'Seul un administrateur peut modifier le rôle d''un utilisateur.';
  end if;
  return new;
end;
$$;

create trigger trg_verrouiller_role before update on public.profiles
  for each row execute function public.fn_verrouiller_role();

-- ----------------------------------------------------------------------------
-- 6. Génération du préventif & alertes contrats
-- ----------------------------------------------------------------------------

-- Idempotente : peut être rejouée plusieurs fois sans dupliquer les
-- interventions (garde sur plan_maintenance_id + date_echeance).
create or replace function public.fn_generer_interventions_preventives()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan record;
  v_nb integer := 0;
  v_existe boolean;
begin
  for v_plan in
    select * from public.plans_maintenance
    where actif = true
      and prochaine_echeance <= current_date + (jours_anticipation || ' days')::interval
  loop
    select exists (
      select 1 from public.interventions
      where plan_maintenance_id = v_plan.id
        and date_echeance::date = v_plan.prochaine_echeance
        and statut <> 'annulee'
    ) into v_existe;

    if not v_existe then
      insert into public.interventions (
        titre, description, type, equipement_id, plan_maintenance_id,
        equipe_id, statut, priorite, date_planifiee, date_echeance, checklist_resultats
      ) values (
        v_plan.nom, v_plan.description, v_plan.type_intervention, v_plan.equipement_id, v_plan.id,
        v_plan.equipe_id, 'a_faire', v_plan.priorite,
        v_plan.prochaine_echeance::timestamptz, v_plan.prochaine_echeance::timestamptz, v_plan.checklist
      );

      insert into public.notifications (role_cible, type, titre, message, lien)
      values (
        'responsable_maintenance', 'maintenance_due',
        'Maintenance préventive à planifier',
        'Le plan "' || v_plan.nom || '" a généré une nouvelle intervention.',
        '/interventions'
      );

      v_nb := v_nb + 1;
    end if;

    update public.plans_maintenance
    set prochaine_echeance = (v_plan.prochaine_echeance +
          (v_plan.frequence_valeur || ' ' || v_plan.frequence_unite)::interval)::date,
        derniere_execution = current_date
    where id = v_plan.id;
  end loop;

  return v_nb;
end;
$$;

create or replace function public.fn_rafraichir_statuts_contrats()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with maj as (
    update public.contrats
    set statut = 'expire'
    where statut = 'actif' and date_fin < current_date
    returning id
  )
  select count(*)::integer from maj;
$$;

-- Idempotente sur 7 jours (ne renotifie pas un contrat déjà signalé récemment).
create or replace function public.fn_generer_alertes_contrats(p_jours integer default 90)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contrat record;
  v_nb integer := 0;
  v_existe boolean;
begin
  perform public.fn_rafraichir_statuts_contrats();

  for v_contrat in
    select * from public.contrats
    where statut = 'actif' and date_fin <= current_date + (p_jours || ' days')::interval
  loop
    select exists (
      select 1 from public.notifications
      where type = 'contrat_expire'
        and lien = '/contrats/' || v_contrat.id
        and created_at > now() - interval '7 days'
    ) into v_existe;

    if not v_existe then
      insert into public.notifications (role_cible, type, titre, message, lien)
      values (
        'responsable_maintenance', 'contrat_expire',
        'Contrat proche de l''expiration',
        'Le contrat "' || v_contrat.intitule || '" expire le ' || to_char(v_contrat.date_fin, 'DD/MM/YYYY') || '.',
        '/contrats/' || v_contrat.id
      );
      v_nb := v_nb + 1;
    end if;
  end loop;

  return v_nb;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.services enable row level security;
alter table public.categories_equipement enable row level security;
alter table public.fournisseurs enable row level security;
alter table public.equipements enable row level security;
alter table public.equipes enable row level security;
alter table public.membres_equipe enable row level security;
alter table public.competences enable row level security;
alter table public.profil_competences enable row level security;
alter table public.plans_maintenance enable row level security;
alter table public.interventions enable row level security;
alter table public.interventions_historique enable row level security;
alter table public.contrats enable row level security;
alter table public.contrats_equipements enable row level security;
alter table public.documents enable row level security;
alter table public.notifications enable row level security;
alter table public.conversations enable row level security;
alter table public.messages_chat enable row level security;
alter table public.journal_audit enable row level security;

-- profiles : chacun voit son propre profil + les rôles avec droits de gestion
-- voient tout l'annuaire (nécessaire pour afficher "assigné à ..."). Écriture
-- de son propre profil (hors `role`, verrouillé par trigger) ou par un admin.
create policy "profiles_select" on public.profiles for select
  using (auth.uid() = id or public.a_role(array['admin', 'responsable_maintenance']));
create policy "profiles_update" on public.profiles for update
  using (auth.uid() = id or public.a_role(array['admin']));

-- Référentiels : lecture pour tout authentifié, écriture réservée admin/responsable.
create policy "sites_select" on public.sites for select using (auth.uid() is not null);
create policy "sites_write" on public.sites for insert with check (public.a_role(array['admin', 'responsable_maintenance']));
create policy "sites_update" on public.sites for update using (public.a_role(array['admin', 'responsable_maintenance']));
create policy "sites_delete" on public.sites for delete using (public.a_role(array['admin']));

create policy "services_select" on public.services for select using (auth.uid() is not null);
create policy "services_write" on public.services for insert with check (public.a_role(array['admin', 'responsable_maintenance']));
create policy "services_update" on public.services for update using (public.a_role(array['admin', 'responsable_maintenance']));
create policy "services_delete" on public.services for delete using (public.a_role(array['admin']));

create policy "categories_select" on public.categories_equipement for select using (auth.uid() is not null);
create policy "categories_write" on public.categories_equipement for insert with check (public.a_role(array['admin', 'responsable_maintenance']));
create policy "categories_update" on public.categories_equipement for update using (public.a_role(array['admin', 'responsable_maintenance']));
create policy "categories_delete" on public.categories_equipement for delete using (public.a_role(array['admin']));

create policy "fournisseurs_select" on public.fournisseurs for select using (auth.uid() is not null);
create policy "fournisseurs_write" on public.fournisseurs for insert with check (public.a_role(array['admin', 'responsable_maintenance']));
create policy "fournisseurs_update" on public.fournisseurs for update using (public.a_role(array['admin', 'responsable_maintenance']));
create policy "fournisseurs_delete" on public.fournisseurs for delete using (public.a_role(array['admin']));

create policy "competences_select" on public.competences for select using (auth.uid() is not null);
create policy "competences_write" on public.competences for insert with check (public.a_role(array['admin', 'responsable_maintenance']));
create policy "competences_update" on public.competences for update using (public.a_role(array['admin', 'responsable_maintenance']));
create policy "competences_delete" on public.competences for delete using (public.a_role(array['admin']));

-- Équipements : lecture globale, écriture métier réservée, suppression admin seul
-- (en pratique on réforme un équipement plutôt que de le supprimer).
create policy "equipements_select" on public.equipements for select using (auth.uid() is not null);
create policy "equipements_insert" on public.equipements for insert with check (public.a_role(array['admin', 'responsable_maintenance']));
create policy "equipements_update" on public.equipements for update using (public.a_role(array['admin', 'responsable_maintenance']));
create policy "equipements_delete" on public.equipements for delete using (public.a_role(array['admin']));

create policy "equipes_select" on public.equipes for select using (auth.uid() is not null);
create policy "equipes_write" on public.equipes for insert with check (public.a_role(array['admin', 'responsable_maintenance']));
create policy "equipes_update" on public.equipes for update using (public.a_role(array['admin', 'responsable_maintenance']));
create policy "equipes_delete" on public.equipes for delete using (public.a_role(array['admin']));

create policy "membres_equipe_select" on public.membres_equipe for select using (auth.uid() is not null);
create policy "membres_equipe_write" on public.membres_equipe for insert with check (public.a_role(array['admin', 'responsable_maintenance']));
create policy "membres_equipe_update" on public.membres_equipe for update using (public.a_role(array['admin', 'responsable_maintenance']));
create policy "membres_equipe_delete" on public.membres_equipe for delete using (public.a_role(array['admin', 'responsable_maintenance']));

create policy "profil_competences_select" on public.profil_competences for select using (auth.uid() is not null);
create policy "profil_competences_write" on public.profil_competences for insert with check (public.a_role(array['admin', 'responsable_maintenance']));
create policy "profil_competences_update" on public.profil_competences for update using (public.a_role(array['admin', 'responsable_maintenance']));
create policy "profil_competences_delete" on public.profil_competences for delete using (public.a_role(array['admin', 'responsable_maintenance']));

create policy "plans_maintenance_select" on public.plans_maintenance for select using (auth.uid() is not null);
create policy "plans_maintenance_write" on public.plans_maintenance for insert with check (public.a_role(array['admin', 'responsable_maintenance']));
create policy "plans_maintenance_update" on public.plans_maintenance for update using (public.a_role(array['admin', 'responsable_maintenance']));
create policy "plans_maintenance_delete" on public.plans_maintenance for delete using (public.a_role(array['admin', 'responsable_maintenance']));

-- Interventions : lecture globale ; création par tout rôle sauf lecture_seule
-- (un technicien doit pouvoir déclarer une panne) ; modification par
-- admin/responsable ou par le technicien/l'équipe assignés ; pas de
-- suppression (on annule).
create policy "interventions_select" on public.interventions for select using (auth.uid() is not null);
create policy "interventions_insert" on public.interventions for insert
  with check (not public.a_role(array['lecture_seule']));
create policy "interventions_update" on public.interventions for update
  using (
    public.a_role(array['admin', 'responsable_maintenance'])
    or technicien_id = auth.uid()
    or equipe_id = any(public.mes_equipes())
  );
create policy "interventions_delete" on public.interventions for delete using (public.a_role(array['admin']));

create policy "interventions_historique_select" on public.interventions_historique for select using (auth.uid() is not null);
create policy "interventions_historique_insert" on public.interventions_historique for insert
  with check (profile_id = auth.uid() or profile_id is null);

create policy "contrats_select" on public.contrats for select using (auth.uid() is not null);
create policy "contrats_write" on public.contrats for insert with check (public.a_role(array['admin', 'responsable_maintenance']));
create policy "contrats_update" on public.contrats for update using (public.a_role(array['admin', 'responsable_maintenance']));
create policy "contrats_delete" on public.contrats for delete using (public.a_role(array['admin']));

create policy "contrats_equipements_select" on public.contrats_equipements for select using (auth.uid() is not null);
create policy "contrats_equipements_write" on public.contrats_equipements for insert with check (public.a_role(array['admin', 'responsable_maintenance']));
create policy "contrats_equipements_delete" on public.contrats_equipements for delete using (public.a_role(array['admin', 'responsable_maintenance']));

-- Documents : lecture globale ; upload par tout rôle sauf lecture_seule ;
-- modification/suppression par l'auteur ou admin/responsable.
create policy "documents_select" on public.documents for select using (auth.uid() is not null);
create policy "documents_insert" on public.documents for insert with check (not public.a_role(array['lecture_seule']));
create policy "documents_update" on public.documents for update
  using (uploaded_by = auth.uid() or public.a_role(array['admin', 'responsable_maintenance']));
create policy "documents_delete" on public.documents for delete
  using (uploaded_by = auth.uid() or public.a_role(array['admin', 'responsable_maintenance']));

create policy "notifications_select" on public.notifications for select
  using (profile_id = auth.uid() or role_cible = public.mon_role());
create policy "notifications_update" on public.notifications for update
  using (profile_id = auth.uid() or role_cible = public.mon_role());

-- Conversations/messages du chatbot : strictement privés, sans exception admin.
create policy "conversations_all" on public.conversations for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "messages_chat_all" on public.messages_chat for all
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.profile_id = auth.uid()))
  with check (exists (select 1 from public.conversations c where c.id = conversation_id and c.profile_id = auth.uid()));

-- Journal d'audit : lecture admin uniquement, écriture réservée au trigger SECURITY DEFINER.
create policy "journal_audit_select" on public.journal_audit for select using (public.a_role(array['admin']));

-- ----------------------------------------------------------------------------
-- 8. Vues (security_invoker = true : indispensable pour hériter du RLS
--    des tables sous-jacentes — sans ça, les vues contournent le RLS).
-- ----------------------------------------------------------------------------

create or replace view public.vue_equipements_detail
  with (security_invoker = true) as
select
  e.*,
  c.nom as categorie_nom,
  c.famille as categorie_famille,
  s.nom as service_nom,
  si.nom as site_nom,
  f.nom as fournisseur_nom,
  (select max(i.date_fin) from public.interventions i where i.equipement_id = e.id and i.statut = 'terminee') as derniere_intervention_le,
  (select count(*) from public.interventions i where i.equipement_id = e.id and i.statut in ('a_faire', 'en_cours', 'en_attente_pieces')) as nb_interventions_ouvertes,
  exists (
    select 1 from public.contrats_equipements ce
    join public.contrats co on co.id = ce.contrat_id
    where ce.equipement_id = e.id and co.statut = 'actif'
  ) as sous_contrat
from public.equipements e
left join public.categories_equipement c on c.id = e.categorie_id
left join public.services s on s.id = e.service_id
left join public.sites si on si.id = e.site_id
left join public.fournisseurs f on f.id = e.fournisseur_id;

create or replace view public.vue_interventions_detail
  with (security_invoker = true) as
select
  i.*,
  e.nom as equipement_nom,
  e.code_interne as equipement_code_interne,
  e.criticite as equipement_criticite,
  s.nom as service_nom,
  eq.nom as equipe_nom,
  p.nom_complet as technicien_nom,
  (i.date_echeance < now() and i.statut not in ('terminee', 'annulee')) as en_retard
from public.interventions i
join public.equipements e on e.id = i.equipement_id
left join public.services s on s.id = e.service_id
left join public.equipes eq on eq.id = i.equipe_id
left join public.profiles p on p.id = i.technicien_id;

create or replace view public.vue_contrats_detail
  with (security_invoker = true) as
select
  c.*,
  f.nom as fournisseur_nom,
  (select count(*) from public.contrats_equipements ce where ce.contrat_id = c.id) as nb_equipements_couverts,
  (c.date_fin - current_date) as jours_avant_expiration
from public.contrats c
join public.fournisseurs f on f.id = c.fournisseur_id;

create or replace view public.vue_kpi_global
  with (security_invoker = true) as
select
  (select count(*) from public.equipements where actif) as total_equipements,
  (select count(*) from public.equipements where actif and statut = 'en_panne') as equipements_en_panne,
  (select count(*) from public.equipements where actif and statut = 'en_panne' and criticite = 'vitale') as equipements_vitaux_en_panne,
  round(
    100.0 * (select count(*) from public.equipements where actif and statut = 'operationnel')
    / greatest((select count(*) from public.equipements where actif), 1), 1
  ) as taux_disponibilite,
  (select count(*) from public.interventions where statut in ('a_faire', 'en_cours', 'en_attente_pieces')) as interventions_ouvertes,
  (select count(*) from public.interventions where statut in ('a_faire', 'en_cours', 'en_attente_pieces') and date_echeance < now()) as interventions_en_retard,
  (select count(*) from public.plans_maintenance where actif and prochaine_echeance <= current_date + interval '30 days') as preventif_du_30j,
  (select count(*) from public.contrats where statut = 'actif' and date_fin <= current_date + interval '90 days') as contrats_expirant_90j,
  (
    select round(avg(extract(epoch from (date_fin - date_debut)) / 3600.0)::numeric, 1)
    from public.interventions
    where type = 'corrective' and statut = 'terminee' and date_fin >= now() - interval '30 days'
  ) as mttr_heures_30j;

-- ----------------------------------------------------------------------------
-- 9. Storage — bucket privé "documents"
-- ----------------------------------------------------------------------------
-- Le bucket doit être créé une fois via le Dashboard Supabase (Storage → New
-- bucket → "documents", Public = OFF) ou via l'API Storage. Les politiques
-- ci-dessous s'appliquent une fois le bucket créé.
-- Convention de chemin : equipements/{id}/{uuid}-{nom}, contrats/{id}/...,
-- interventions/{id}/... — l'accès en lecture passe toujours par une URL
-- signée générée côté serveur (createSignedUrl), jamais par une URL publique.

create policy "documents_storage_select" on storage.objects for select
  using (bucket_id = 'documents' and auth.uid() is not null);
create policy "documents_storage_insert" on storage.objects for insert
  with check (bucket_id = 'documents' and not public.a_role(array['lecture_seule']));
create policy "documents_storage_delete" on storage.objects for delete
  using (bucket_id = 'documents' and (owner = auth.uid() or public.a_role(array['admin', 'responsable_maintenance'])));

-- ----------------------------------------------------------------------------
-- 10. Tâches planifiées (optionnel — pg_cron)
-- ----------------------------------------------------------------------------
-- pg_cron doit être activé depuis Database → Extensions dans le Dashboard
-- Supabase (nécessite des privilèges que le SQL Editor n'a pas toujours).
-- Une fois activé, planifier :
--
--   select cron.schedule('preventif-quotidien', '0 5 * * *',
--     $$ select public.fn_generer_interventions_preventives(); $$);
--   select cron.schedule('alertes-contrats-quotidien', '30 5 * * *',
--     $$ select public.fn_generer_alertes_contrats(90); $$);
--
-- À défaut (ou en complément, comme filet), les routes protégées par
-- CRON_SECRET /api/cron/maintenance-preventive et /api/cron/alertes-contrats
-- appellent les mêmes fonctions et peuvent être déclenchées par un
-- ordonnanceur externe (GitHub Actions, cron-job.org, etc.).
