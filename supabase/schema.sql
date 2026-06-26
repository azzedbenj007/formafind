-- ================================================================
-- FormaFind - Schéma de base de données Supabase (PostgreSQL)
-- ================================================================

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================================
-- TABLE : profiles (extension de auth.users)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'apprenant' CHECK (role IN ('apprenant', 'ecole', 'admin')),
  school_id UUID, -- rempli si role = 'ecole'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE : schools (centres de formation)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.schools (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  logo_url TEXT,
  location TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  website_url TEXT,
  is_premium BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE : courses (formations)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.courses (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'informatique', 'langues', 'commerce', 'artisanat',
    'sante', 'art', 'droit', 'gestion', 'autre'
  )),
  duration TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('online', 'presential', 'hybrid')),
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  schedule_details TEXT NOT NULL,
  prerequisites TEXT,
  certification TEXT,
  seats_available INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE : reviews (avis et notations)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.reviews (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Un utilisateur ne peut laisser qu'un seul avis par formation
  UNIQUE(course_id, user_id)
);

-- ================================================================
-- TABLE : leads (demandes de contact/pré-inscriptions)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  user_phone TEXT,
  message TEXT,
  status TEXT DEFAULT 'nouveau' CHECK (status IN ('nouveau', 'contacte', 'converti', 'perdu')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- VUES UTILES
-- ================================================================

-- Vue : formations avec note moyenne et nombre d'avis
CREATE OR REPLACE VIEW public.courses_with_stats AS
SELECT
  c.*,
  s.name AS school_name,
  s.location AS school_location,
  s.logo_url AS school_logo_url,
  s.is_verified AS school_is_verified,
  COALESCE(ROUND(AVG(r.rating)::NUMERIC, 1), 0) AS avg_rating,
  COUNT(r.id) AS review_count
FROM public.courses c
LEFT JOIN public.schools s ON c.school_id = s.id
LEFT JOIN public.reviews r ON c.id = r.course_id
WHERE c.is_active = TRUE
GROUP BY c.id, s.name, s.location, s.logo_url, s.is_verified;

-- ================================================================
-- ROW LEVEL SECURITY (RLS)
-- ================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- SCHOOLS : lecture publique pour tous
CREATE POLICY "schools_select_public" ON public.schools
  FOR SELECT USING (true);

-- SCHOOLS : insertion/modification uniquement par admin ou propriétaire
CREATE POLICY "schools_insert_admin" ON public.schools
  FOR INSERT WITH CHECK (
    auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin')
  );

CREATE POLICY "schools_update_owner" ON public.schools
  FOR UPDATE USING (
    auth.uid() IN (
      SELECT id FROM public.profiles
      WHERE school_id = schools.id AND role = 'ecole'
    )
    OR
    auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin')
  );

-- COURSES : lecture publique pour tous
CREATE POLICY "courses_select_public" ON public.courses
  FOR SELECT USING (true);

-- COURSES : gestion par l'école propriétaire ou admin
CREATE POLICY "courses_insert_school" ON public.courses
  FOR INSERT WITH CHECK (
    auth.uid() IN (
      SELECT id FROM public.profiles
      WHERE school_id = courses.school_id AND role IN ('ecole', 'admin')
    )
  );

CREATE POLICY "courses_update_school" ON public.courses
  FOR UPDATE USING (
    auth.uid() IN (
      SELECT id FROM public.profiles
      WHERE school_id = courses.school_id AND role IN ('ecole', 'admin')
    )
  );

CREATE POLICY "courses_delete_school" ON public.courses
  FOR DELETE USING (
    auth.uid() IN (
      SELECT id FROM public.profiles
      WHERE school_id = courses.school_id AND role IN ('ecole', 'admin')
    )
  );

-- REVIEWS : lecture publique
CREATE POLICY "reviews_select_public" ON public.reviews
  FOR SELECT USING (true);

-- REVIEWS : un utilisateur connecté peut poster un avis
CREATE POLICY "reviews_insert_authenticated" ON public.reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- REVIEWS : un utilisateur peut modifier/supprimer son propre avis
CREATE POLICY "reviews_update_own" ON public.reviews
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "reviews_delete_own" ON public.reviews
  FOR DELETE USING (auth.uid() = user_id);

-- PROFILES : un utilisateur voit son propre profil
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- LEADS : insertion par tout le monde (formulaire de contact)
CREATE POLICY "leads_insert_public" ON public.leads
  FOR INSERT WITH CHECK (true);

-- LEADS : lecture uniquement par l'école concernée ou admin
CREATE POLICY "leads_select_school" ON public.leads
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM public.profiles
      WHERE school_id = leads.school_id AND role IN ('ecole', 'admin')
    )
  );

-- ================================================================
-- TRIGGERS : création automatique du profil à l'inscription
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ================================================================
-- DONNÉES DE DÉMONSTRATION
-- ================================================================

INSERT INTO public.schools (id, name, description, logo_url, location, contact_email, website_url, is_premium, is_verified) VALUES
  ('a1b2c3d4-0001-0001-0001-000000000001', 'Academy du Numérique', 'Centre de formation spécialisé dans les métiers du numérique. Nos formateurs sont des professionnels en activité.', NULL, 'Paris 11ème', 'contact@academy-numerique.fr', 'https://academy-numerique.fr', TRUE, TRUE),
  ('a1b2c3d4-0002-0002-0002-000000000002', 'LinguaWorld', 'École de langues avec des méthodes immersives et des professeurs natifs. Cours pour tous niveaux.', NULL, 'Lyon 2ème', 'info@linguaworld.fr', NULL, FALSE, TRUE),
  ('a1b2c3d4-0003-0003-0003-000000000003', 'Business Excellence', 'Formation professionnelle en commerce, marketing digital et gestion. MBA et certifications reconnues.', NULL, 'Bordeaux Centre', 'formation@business-excellence.fr', NULL, TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.courses (id, school_id, title, description, category, duration, format, price, schedule_details, prerequisites, certification, seats_available) VALUES
  ('c0000001-0001-0001-0001-000000000001', 'a1b2c3d4-0001-0001-0001-000000000001', 'Développement Web Full-Stack React & Node.js', 'Maîtrisez React, Node.js, PostgreSQL et le déploiement cloud. Formation intensive pour reconversions.', 'informatique', '6 mois (840h)', 'hybrid', 4500.00, 'Lundi-Vendredi 9h-17h (présentiel) + 2 soirs/semaine en ligne', 'Bases en logique de programmation souhaitées', 'RNCP Niveau 6 - Développeur Web', 8),
  ('c0000002-0002-0002-0002-000000000002', 'a1b2c3d4-0001-0001-0001-000000000001', 'Data Science & Machine Learning avec Python', 'Analyse de données, visualisation et algorithmes ML. Projets sur des datasets réels d''entreprises.', 'informatique', '4 mois (480h)', 'online', 3200.00, '100% en ligne, à votre rythme + sessions live hebdomadaires le samedi', 'Notions de Python et statistiques de base', 'Certificat Data Scientist - France Compétences', 15),
  ('c0000003-0003-0003-0003-000000000003', 'a1b2c3d4-0002-0002-0002-000000000002', 'Anglais Professionnel - Niveau Intermédiaire à Avancé', 'Anglais professionnel : présentations, négociations, emails. Professeurs anglophones natifs.', 'langues', '3 mois (120h)', 'presential', 1800.00, 'Mardi et Jeudi 18h30-20h30, Samedi 9h-12h', 'Niveau B1 minimum (test gratuit à l''inscription)', 'Préparation TOEIC incluse', 12),
  ('c0000004-0004-0004-0004-000000000004', 'a1b2c3d4-0002-0002-0002-000000000002', 'Espagnol Débutant - Méthode Accélérée', 'De zéro à la conversation en 3 mois grâce à notre méthode immersive et nos outils digitaux.', 'langues', '3 mois (90h)', 'hybrid', 990.00, 'Mercredi 18h-20h + e-learning en autonomie', 'Aucun prérequis', 'Attestation de niveau FormaFind', 20),
  ('c0000005-0005-0005-0005-000000000005', 'a1b2c3d4-0003-0003-0003-000000000003', 'Marketing Digital & Réseaux Sociaux', 'Google Ads, Facebook Ads, SEO et création de contenu. Pilotez des campagnes rentables.', 'commerce', '2 mois (160h)', 'online', 1490.00, '100% en ligne, accessible 24h/24 pendant 6 mois', 'Maîtrise basique d''internet', 'Certification Google Ads incluse', NULL),
  ('c0000006-0006-0006-0006-000000000006', 'a1b2c3d4-0003-0003-0003-000000000003', 'Gestion de Projet Agile & Scrum', 'Devenez Chef de Projet Agile certifié. Scrum, Kanban, Jira et Trello.', 'gestion', '1 mois (40h)', 'presential', 1200.00, 'Semaines intensives Lundi-Vendredi, 4 sessions par an', 'Expérience en gestion d''équipe recommandée', 'Certification PSM I (Professional Scrum Master)', 6)
ON CONFLICT (id) DO NOTHING;
