-- ============================================================================
-- Jeu de données de démonstration — GMAO Hospitalière
-- ============================================================================
-- À exécuter après supabase/schema.sql, dans le SQL Editor Supabase.
-- Ne dépend d'aucun compte utilisateur : les colonnes qui référencent
-- `profiles` (created_by, demandeur_id, technicien_id, responsable_id...)
-- restent NULL ici. Pour peupler ces colonnes avec de vraies personnes :
--   1. Créez 4 comptes via /inscription (un par rôle : admin,
--      responsable_maintenance, technicien, lecture_seule).
--   2. Dans `profiles`, mettez à jour leur `role` (le trigger d'inscription
--      les crée tous en 'lecture_seule' par défaut).
--   3. Optionnel : UPDATE quelques `interventions`/`equipes` pour les
--      assigner à ces comptes, à des fins de démonstration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Site & services
-- ----------------------------------------------------------------------------
insert into public.sites (id, nom, adresse, ville, code_postal) values
  ('11111111-0000-0000-0000-000000000001', 'CHU Central', '12 avenue de la Santé', 'Casablanca', '20000');

insert into public.services (id, site_id, nom, code, etage, responsable_nom, telephone) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Réanimation', 'REA', '2e étage', 'Dr. Amina Bensouda', '05 22 00 00 01'),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'Bloc opératoire', 'BLOC', '1er étage', 'Dr. Karim Idrissi', '05 22 00 00 02'),
  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'Cardiologie', 'CARDIO', '3e étage', 'Dr. Sara El Fassi', '05 22 00 00 03'),
  ('22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'Urgences', 'URG', 'Rez-de-chaussée', 'Dr. Youssef Alaoui', '05 22 00 00 04'),
  ('22222222-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'Imagerie médicale', 'IMG', 'Sous-sol', 'Dr. Nadia Chraibi', '05 22 00 00 05'),
  ('22222222-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', 'Pédiatrie', 'PEDIA', '4e étage', 'Dr. Hicham Benali', '05 22 00 00 06');

-- ----------------------------------------------------------------------------
-- Catégories d'équipement
-- ----------------------------------------------------------------------------
insert into public.categories_equipement (id, nom, famille, criticite_par_defaut) values
  ('33333333-0000-0000-0000-000000000001', 'Respirateur', 'biomedical', 'vitale'),
  ('33333333-0000-0000-0000-000000000002', 'Moniteur multiparamétrique', 'biomedical', 'vitale'),
  ('33333333-0000-0000-0000-000000000003', 'Défibrillateur', 'biomedical', 'vitale'),
  ('33333333-0000-0000-0000-000000000004', 'Pousse-seringue', 'biomedical', 'haute'),
  ('33333333-0000-0000-0000-000000000005', 'Imagerie (scanner/IRM/échographe)', 'biomedical', 'haute'),
  ('33333333-0000-0000-0000-000000000006', 'Lit médicalisé', 'technique', 'moyenne'),
  ('33333333-0000-0000-0000-000000000007', 'Génie climatique / CVC', 'technique', 'moyenne'),
  ('33333333-0000-0000-0000-000000000008', 'Informatique médicale', 'informatique', 'basse');

-- ----------------------------------------------------------------------------
-- Fournisseurs
-- ----------------------------------------------------------------------------
insert into public.fournisseurs (id, nom, contact_nom, email, telephone) values
  ('44444444-0000-0000-0000-000000000001', 'MedTech Maroc', 'Fatima Zahra', 'contact@medtech.ma', '05 22 11 11 01'),
  ('44444444-0000-0000-0000-000000000002', 'BioServ International', 'Omar Tazi', 'support@bioserv.com', '05 22 11 11 02'),
  ('44444444-0000-0000-0000-000000000003', 'ClimaSanté', 'Rachid Amrani', 'sav@climasante.ma', '05 22 11 11 03'),
  ('44444444-0000-0000-0000-000000000004', 'Philips Healthcare', 'Support Philips', 'support.ma@philips.com', '05 22 11 11 04'),
  ('44444444-0000-0000-0000-000000000005', 'Général Électrique Médical', 'Support GE', 'ge.support@ge.com', '05 22 11 11 05');

-- ----------------------------------------------------------------------------
-- Équipes
-- ----------------------------------------------------------------------------
insert into public.equipes (id, nom, specialite, description) values
  ('55555555-0000-0000-0000-000000000001', 'Biomédical', 'Dispositifs médicaux', 'Maintenance des équipements biomédicaux critiques'),
  ('55555555-0000-0000-0000-000000000002', 'Électricité & Fluides', 'Génie technique', 'Électricité, fluides médicaux, génie climatique'),
  ('55555555-0000-0000-0000-000000000003', 'Informatique', 'Systèmes d''information', 'Postes, réseau, systèmes hospitaliers');

-- ----------------------------------------------------------------------------
-- Compétences
-- ----------------------------------------------------------------------------
insert into public.competences (id, nom, description) values
  ('66666666-0000-0000-0000-000000000001', 'Habilitation dispositifs classe IIb/III', 'Requise pour respirateurs, défibrillateurs'),
  ('66666666-0000-0000-0000-000000000002', 'Habilitation électrique BR', 'Interventions sur installations électriques'),
  ('66666666-0000-0000-0000-000000000003', 'Fluides médicaux', 'Oxygène, air médical, vide'),
  ('66666666-0000-0000-0000-000000000004', 'Imagerie médicale', 'Scanner, IRM, échographes');

-- ----------------------------------------------------------------------------
-- Équipements (~30, criticité et statuts variés)
-- ----------------------------------------------------------------------------
insert into public.equipements
  (code_interne, nom, categorie_id, numero_serie, modele, fabricant, fournisseur_id, site_id, service_id, localisation_precise, statut, criticite, date_achat, date_mise_service, fin_garantie, cout_acquisition)
values
  ('RESP-001', 'Respirateur Evita V500', '33333333-0000-0000-0000-000000000001', 'SN-RESP-001', 'Evita V500', 'Dräger', '44444444-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'Chambre 201', 'operationnel', 'vitale', '2023-02-10', '2023-03-01', '2026-03-01', 185000),
  ('RESP-002', 'Respirateur Evita V500', '33333333-0000-0000-0000-000000000001', 'SN-RESP-002', 'Evita V500', 'Dräger', '44444444-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'Chambre 202', 'en_panne', 'vitale', '2023-02-10', '2023-03-01', '2026-03-01', 185000),
  ('RESP-003', 'Respirateur portable Oxylog 3000', '33333333-0000-0000-0000-000000000001', 'SN-RESP-003', 'Oxylog 3000+', 'Dräger', '44444444-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000004', 'Salle de déchoquage', 'operationnel', 'vitale', '2024-01-15', '2024-02-01', '2027-02-01', 32000),
  ('RESP-014', 'Respirateur Savina 300', '33333333-0000-0000-0000-000000000001', 'SN-RESP-014', 'Savina 300', 'Dräger', '44444444-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'Chambre 214', 'en_panne', 'vitale', '2022-06-01', '2022-07-01', '2025-07-01', 165000),
  ('MON-001', 'Moniteur IntelliVue MX800', '33333333-0000-0000-0000-000000000002', 'SN-MON-001', 'IntelliVue MX800', 'Philips', '44444444-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'Chambre 201', 'operationnel', 'vitale', '2023-05-01', '2023-06-01', '2026-06-01', 45000),
  ('MON-002', 'Moniteur IntelliVue MX800', '33333333-0000-0000-0000-000000000002', 'SN-MON-002', 'IntelliVue MX800', 'Philips', '44444444-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'Salle 3', 'operationnel', 'vitale', '2023-05-01', '2023-06-01', '2026-06-01', 45000),
  ('MON-003', 'Moniteur portable IntelliVue MP5', '33333333-0000-0000-0000-000000000002', 'SN-MON-003', 'IntelliVue MP5', 'Philips', '44444444-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000004', 'Box 3 urgences', 'en_maintenance', 'vitale', '2022-09-01', '2022-10-01', '2025-10-01', 18000),
  ('MON-004', 'Moniteur cardiaque', '33333333-0000-0000-0000-000000000002', 'SN-MON-004', 'CardioWatch', 'GE Healthcare', '44444444-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000003', 'Salle de suivi', 'operationnel', 'haute', '2023-01-01', '2023-02-01', '2026-02-01', 22000),
  ('DEFIB-001', 'Défibrillateur HeartStart XL+', '33333333-0000-0000-0000-000000000003', 'SN-DEFIB-001', 'HeartStart XL+', 'Philips', '44444444-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000004', 'Salle de déchoquage', 'operationnel', 'vitale', '2023-03-01', '2023-04-01', '2026-04-01', 28000),
  ('DEFIB-002', 'Défibrillateur HeartStart XL+', '33333333-0000-0000-0000-000000000003', 'SN-DEFIB-002', 'HeartStart XL+', 'Philips', '44444444-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'Salle 1', 'operationnel', 'vitale', '2023-03-01', '2023-04-01', '2026-04-01', 28000),
  ('DEFIB-003', 'Défibrillateur portable', '33333333-0000-0000-0000-000000000003', 'SN-DEFIB-003', 'FRx', 'Philips', '44444444-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'Chariot d''urgence', 'hors_service', 'vitale', '2019-01-01', '2019-02-01', '2022-02-01', 15000),
  ('PSE-001', 'Pousse-seringue Perfusor Space', '33333333-0000-0000-0000-000000000004', 'SN-PSE-001', 'Perfusor Space', 'B. Braun', '44444444-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'Chambre 203', 'operationnel', 'haute', '2023-07-01', '2023-08-01', '2026-08-01', 3500),
  ('PSE-002', 'Pousse-seringue Perfusor Space', '33333333-0000-0000-0000-000000000004', 'SN-PSE-002', 'Perfusor Space', 'B. Braun', '44444444-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'Chambre 204', 'operationnel', 'haute', '2023-07-01', '2023-08-01', '2026-08-01', 3500),
  ('PSE-003', 'Pousse-seringue Perfusor Space', '33333333-0000-0000-0000-000000000004', 'SN-PSE-003', 'Perfusor Space', 'B. Braun', '44444444-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000006', 'Chambre 401', 'en_panne', 'haute', '2021-03-01', '2021-04-01', '2024-04-01', 3500),
  ('SCAN-001', 'Scanner 128 coupes', '33333333-0000-0000-0000-000000000005', 'SN-SCAN-001', 'Revolution EVO', 'GE Healthcare', '44444444-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000005', 'Salle scanner 1', 'operationnel', 'haute', '2022-01-01', '2022-03-01', '2027-03-01', 950000),
  ('IRM-001', 'IRM 1.5 Tesla', '33333333-0000-0000-0000-000000000005', 'SN-IRM-001', 'Signa Voyager', 'GE Healthcare', '44444444-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000005', 'Salle IRM', 'operationnel', 'haute', '2021-06-01', '2021-09-01', '2026-09-01', 1450000),
  ('ECHO-001', 'Échographe Vivid E95', '33333333-0000-0000-0000-000000000005', 'SN-ECHO-001', 'Vivid E95', 'GE Healthcare', '44444444-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000003', 'Salle d''échographie', 'operationnel', 'haute', '2023-04-01', '2023-05-01', '2026-05-01', 210000),
  ('ECHO-002', 'Échographe portable', '33333333-0000-0000-0000-000000000005', 'SN-ECHO-002', 'Vscan Air', 'GE Healthcare', '44444444-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000004', 'Poste 2', 'en_maintenance', 'haute', '2023-04-01', '2023-05-01', '2026-05-01', 25000),
  ('LIT-001', 'Lit médicalisé électrique', '33333333-0000-0000-0000-000000000006', 'SN-LIT-001', 'Multicare', 'Linet', '44444444-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'Chambre 201', 'operationnel', 'moyenne', '2022-05-01', '2022-06-01', '2025-06-01', 12000),
  ('LIT-002', 'Lit médicalisé électrique', '33333333-0000-0000-0000-000000000006', 'SN-LIT-002', 'Multicare', 'Linet', '44444444-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000006', 'Chambre 402', 'operationnel', 'moyenne', '2022-05-01', '2022-06-01', '2025-06-01', 12000),
  ('LIT-003', 'Lit médicalisé électrique', '33333333-0000-0000-0000-000000000006', 'SN-LIT-003', 'Multicare', 'Linet', '44444444-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000006', 'Chambre 403', 'reforme', 'moyenne', '2016-01-01', '2016-02-01', '2019-02-01', 9000),
  ('CVC-001', 'Centrale de traitement d''air - Bloc', '33333333-0000-0000-0000-000000000007', 'SN-CVC-001', 'CTA-5000', 'Carrier', '44444444-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'Local technique bloc', 'operationnel', 'haute', '2020-01-01', '2020-03-01', '2025-03-01', 320000),
  ('CVC-002', 'Groupe froid climatisation Réanimation', '33333333-0000-0000-0000-000000000007', 'SN-CVC-002', 'GF-2000', 'Carrier', '44444444-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'Local technique 2e étage', 'en_panne', 'haute', '2019-05-01', '2019-07-01', '2024-07-01', 180000),
  ('INFO-001', 'Poste informatique dossier patient', '33333333-0000-0000-0000-000000000008', 'SN-INFO-001', 'OptiPlex 7020', 'Dell', null, '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'Poste infirmier', 'operationnel', 'basse', '2023-01-01', '2023-01-15', '2026-01-15', 1200),
  ('INFO-002', 'Poste informatique dossier patient', '33333333-0000-0000-0000-000000000008', 'SN-INFO-002', 'OptiPlex 7020', 'Dell', null, '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000004', 'Accueil urgences', 'operationnel', 'basse', '2023-01-01', '2023-01-15', '2026-01-15', 1200),
  ('INFO-003', 'Serveur PACS imagerie', '33333333-0000-0000-0000-000000000008', 'SN-INFO-003', 'PowerEdge R750', 'Dell', null, '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000005', 'Salle serveur', 'operationnel', 'haute', '2022-02-01', '2022-03-01', '2025-03-01', 45000),
  ('RESP-020', 'Respirateur néonatal', '33333333-0000-0000-0000-000000000001', 'SN-RESP-020', 'Babylog VN500', 'Dräger', '44444444-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000006', 'Chambre 405', 'operationnel', 'vitale', '2023-09-01', '2023-10-01', '2026-10-01', 175000),
  ('MON-010', 'Moniteur néonatal', '33333333-0000-0000-0000-000000000002', 'SN-MON-010', 'IntelliVue MX550', 'Philips', '44444444-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000006', 'Chambre 405', 'operationnel', 'vitale', '2023-09-01', '2023-10-01', '2026-10-01', 32000),
  ('PSE-010', 'Pousse-seringue pédiatrique', '33333333-0000-0000-0000-000000000004', 'SN-PSE-010', 'Perfusor Space', 'B. Braun', '44444444-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000006', 'Chambre 405', 'operationnel', 'haute', '2023-09-01', '2023-10-01', '2026-10-01', 3500),
  ('DEFIB-010', 'Défibrillateur pédiatrique', '33333333-0000-0000-0000-000000000003', 'SN-DEFIB-010', 'HeartStart XL+ Pédia', 'Philips', '44444444-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000006', 'Poste infirmier pédiatrie', 'operationnel', 'vitale', '2023-09-01', '2023-10-01', '2026-10-01', 29000);

-- ----------------------------------------------------------------------------
-- Contrats & couverture équipements
-- ----------------------------------------------------------------------------
insert into public.contrats (id, reference, intitule, fournisseur_id, type_contrat, date_debut, date_fin, cout_annuel, delai_intervention_heures, couverture_horaire, tacite_reconduction, statut) values
  ('77777777-0000-0000-0000-000000000001', 'CT-2024-001', 'Contrat full-service respirateurs Dräger', '44444444-0000-0000-0000-000000000001', 'full_service', '2024-01-01', '2026-12-31', 85000, 4, '24/7', true, 'actif'),
  ('77777777-0000-0000-0000-000000000002', 'CT-2024-002', 'Maintenance préventive moniteurs Philips', '44444444-0000-0000-0000-000000000004', 'maintenance_preventive', '2024-03-01', '2026-09-15', 42000, 8, '8h-18h ouvrés', false, 'actif'),
  ('77777777-0000-0000-0000-000000000003', 'CT-2023-014', 'Garantie constructeur imagerie GE', '44444444-0000-0000-0000-000000000005', 'garantie', '2023-01-01', '2026-08-25', 0, 24, '8h-18h ouvrés', false, 'actif'),
  ('77777777-0000-0000-0000-000000000004', 'CT-2022-030', 'Assistance climatisation ClimaSanté', '44444444-0000-0000-0000-000000000003', 'assistance', '2022-01-01', '2025-12-31', 28000, 6, '24/7', true, 'actif'),
  ('77777777-0000-0000-0000-000000000005', 'CT-2021-005', 'Location lits médicalisés Linet', '44444444-0000-0000-0000-000000000002', 'location', '2021-01-01', '2024-12-31', 15000, 48, '8h-18h ouvrés', false, 'actif'),
  ('77777777-0000-0000-0000-000000000006', 'CT-2023-022', 'Maintenance défibrillateurs Philips', '44444444-0000-0000-0000-000000000004', 'maintenance_preventive', '2023-06-01', '2025-09-01', 18000, 8, '8h-18h ouvrés', false, 'actif');

insert into public.contrats_equipements (contrat_id, equipement_id)
select '77777777-0000-0000-0000-000000000001', id from public.equipements where code_interne like 'RESP-%'
union all
select '77777777-0000-0000-0000-000000000002', id from public.equipements where code_interne like 'MON-%'
union all
select '77777777-0000-0000-0000-000000000003', id from public.equipements where code_interne in ('SCAN-001', 'IRM-001', 'ECHO-001', 'ECHO-002')
union all
select '77777777-0000-0000-0000-000000000004', id from public.equipements where code_interne like 'CVC-%'
union all
select '77777777-0000-0000-0000-000000000005', id from public.equipements where code_interne like 'LIT-%'
union all
select '77777777-0000-0000-0000-000000000006', id from public.equipements where code_interne like 'DEFIB-%';

-- ----------------------------------------------------------------------------
-- Plans de maintenance préventive (échéances étalées, certaines proches)
-- ----------------------------------------------------------------------------
insert into public.plans_maintenance (equipement_id, nom, description, type_intervention, frequence_valeur, frequence_unite, prochaine_echeance, equipe_id, priorite, jours_anticipation)
select id, 'Contrôle préventif trimestriel', 'Vérification fonctionnelle et électrique selon protocole constructeur', 'preventive', 3, 'mois', current_date + 3, '55555555-0000-0000-0000-000000000001', 'haute', 7
from public.equipements where code_interne = 'RESP-001'
union all
select id, 'Contrôle préventif trimestriel', 'Vérification fonctionnelle et électrique selon protocole constructeur', 'preventive', 3, 'mois', current_date + 10, '55555555-0000-0000-0000-000000000001', 'haute', 7
from public.equipements where code_interne = 'RESP-003'
union all
select id, 'Étalonnage semestriel', 'Étalonnage capteurs et vérification alarmes', 'preventive', 6, 'mois', current_date + 5, '55555555-0000-0000-0000-000000000001', 'haute', 7
from public.equipements where code_interne = 'MON-001'
union all
select id, 'Étalonnage semestriel', 'Étalonnage capteurs et vérification alarmes', 'preventive', 6, 'mois', current_date + 45, '55555555-0000-0000-0000-000000000001', 'normale', 7
from public.equipements where code_interne = 'MON-002'
union all
select id, 'Contrôle réglementaire annuel', 'Contrôle réglementaire obligatoire (dispositif classe IIb)', 'controle_reglementaire', 12, 'mois', current_date + 15, '55555555-0000-0000-0000-000000000001', 'urgente', 14
from public.equipements where code_interne = 'DEFIB-001'
union all
select id, 'Contrôle réglementaire annuel', 'Contrôle réglementaire obligatoire (dispositif classe IIb)', 'controle_reglementaire', 12, 'mois', current_date + 60, '55555555-0000-0000-0000-000000000001', 'haute', 14
from public.equipements where code_interne = 'DEFIB-002'
union all
select id, 'Vérification débit et pression', 'Contrôle mensuel du bon fonctionnement', 'preventive', 1, 'mois', current_date + 2, '55555555-0000-0000-0000-000000000001', 'normale', 5
from public.equipements where code_interne = 'PSE-001'
union all
select id, 'Vérification débit et pression', 'Contrôle mensuel du bon fonctionnement', 'preventive', 1, 'mois', current_date + 20, '55555555-0000-0000-0000-000000000001', 'normale', 5
from public.equipements where code_interne = 'PSE-002'
union all
select id, 'Maintenance constructeur annuelle', 'Maintenance préventive imagerie selon plan constructeur', 'preventive', 12, 'mois', current_date + 90, '55555555-0000-0000-0000-000000000001', 'haute', 14
from public.equipements where code_interne = 'SCAN-001'
union all
select id, 'Maintenance constructeur annuelle', 'Maintenance préventive imagerie selon plan constructeur', 'preventive', 12, 'mois', current_date + 120, '55555555-0000-0000-0000-000000000001', 'haute', 14
from public.equipements where code_interne = 'IRM-001'
union all
select id, 'Entretien filtration et nettoyage', 'Entretien trimestriel CVC', 'preventive', 3, 'mois', current_date + 8, '55555555-0000-0000-0000-000000000002', 'normale', 5
from public.equipements where code_interne = 'CVC-001'
union all
select id, 'Entretien filtration et nettoyage', 'Entretien trimestriel CVC', 'preventive', 3, 'mois', current_date - 2, '55555555-0000-0000-0000-000000000002', 'haute', 5
from public.equipements where code_interne = 'CVC-002';

-- ----------------------------------------------------------------------------
-- Interventions (réparties sur tous les statuts, dont certaines en retard)
-- ----------------------------------------------------------------------------
insert into public.interventions (titre, description, type, equipement_id, equipe_id, statut, priorite, date_planifiee, date_echeance, date_debut, date_fin, compte_rendu, cout_pieces, cout_main_oeuvre)
select 'Panne alarme haute pression', 'Alarme haute pression persistante malgré redémarrage', 'corrective', id, '55555555-0000-0000-0000-000000000001', 'a_faire', 'urgente', now() - interval '1 day', now() - interval '1 day', null, null, null, 0, 0
from public.equipements where code_interne = 'RESP-002'
union all
select 'Écran tactile hors service', 'Écran ne répond plus aux commandes tactiles', 'corrective', id, '55555555-0000-0000-0000-000000000001', 'en_cours', 'urgente', now() - interval '3 days', now() - interval '2 days', now() - interval '2 days', null, null, 0, 0
from public.equipements where code_interne = 'RESP-014'
union all
select 'Pièce détachée en attente', 'Remplacement moteur nécessaire, pièce commandée', 'corrective', id, '55555555-0000-0000-0000-000000000001', 'en_attente_pieces', 'haute', now() - interval '5 days', now() - interval '4 days', now() - interval '4 days', null, null, 450, 0
from public.equipements where code_interne = 'PSE-003'
union all
select 'Défaillance compresseur', 'Le groupe froid ne redémarre plus après coupure', 'corrective', id, '55555555-0000-0000-0000-000000000002', 'en_cours', 'urgente', now() - interval '2 days', now() - interval '1 day', now() - interval '1 day', null, null, 0, 0
from public.equipements where code_interne = 'CVC-002'
union all
select 'Contrôle qualité image', 'Bruit sur les images échographiques', 'corrective', id, '55555555-0000-0000-0000-000000000001', 'a_faire', 'normale', now() + interval '2 days', now() + interval '2 days', null, null, null, 0, 0
from public.equipements where code_interne = 'ECHO-002'
union all
select 'Remplacement batterie', 'Batterie ne tient plus la charge', 'corrective', id, '55555555-0000-0000-0000-000000000001', 'a_faire', 'haute', now() + interval '1 day', now() + interval '1 day', null, null, null, 0, 0
from public.equipements where code_interne = 'MON-003'
union all
select 'Contrôle préventif trimestriel', 'Vérification fonctionnelle et électrique', 'preventive', id, '55555555-0000-0000-0000-000000000001', 'terminee', 'normale', now() - interval '35 days', now() - interval '32 days', now() - interval '32 days', now() - interval '32 days' + interval '90 minutes', 'RAS, équipement conforme.', 0, 200
from public.equipements where code_interne = 'RESP-001'
union all
select 'Étalonnage semestriel', 'Étalonnage capteurs et alarmes', 'preventive', id, '55555555-0000-0000-0000-000000000001', 'terminee', 'normale', now() - interval '20 days', now() - interval '18 days', now() - interval '18 days', now() - interval '18 days' + interval '60 minutes', 'Étalonnage réalisé conforme.', 0, 150
from public.equipements where code_interne = 'MON-004'
union all
select 'Contrôle réglementaire annuel', 'Contrôle réglementaire dispositif classe IIb', 'controle_reglementaire', id, '55555555-0000-0000-0000-000000000001', 'terminee', 'haute', now() - interval '50 days', now() - interval '48 days', now() - interval '48 days', now() - interval '48 days' + interval '120 minutes', 'Conforme, PV transmis.', 0, 300
from public.equipements where code_interne = 'DEFIB-003'
union all
select 'Mise à jour logicielle', 'Mise à jour firmware constructeur', 'amelioration', id, '55555555-0000-0000-0000-000000000003', 'terminee', 'basse', now() - interval '10 days', now() - interval '9 days', now() - interval '9 days', now() - interval '9 days' + interval '30 minutes', 'Mise à jour effectuée sans incident.', 0, 80
from public.equipements where code_interne = 'INFO-003'
union all
select 'Fuite réseau air médical', 'Signalement infirmier d''une baisse de pression', 'corrective', id, '55555555-0000-0000-0000-000000000002', 'annulee', 'haute', now() - interval '6 days', now() - interval '6 days', null, null, 'Doublon avec intervention CVC-002.', 0, 0
from public.equipements where code_interne = 'CVC-001';
