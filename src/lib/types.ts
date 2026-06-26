// Types principaux de l'application FormaFind

export interface School {
  id: string;
  name: string;
  description: string;
  logo_url: string | null;
  location: string;
  contact_email: string;
  website_url: string | null;
  is_premium: boolean;
  is_verified: boolean;
  created_at: string;
  // Relations optionnelles
  courses?: Course[];
  _count?: { courses: number; reviews: number };
  avg_rating?: number;
}

export interface Course {
  id: string;
  school_id: string;
  title: string;
  description: string;
  category: CourseCategory;
  duration: string;
  format: CourseFormat;
  price: number;
  schedule_details: string;
  prerequisites: string | null;
  certification: string | null;
  seats_available: number | null;
  is_active: boolean;
  created_at: string;
  // Relations optionnelles
  school?: School;
  reviews?: Review[];
  avg_rating?: number;
  review_count?: number;
}

export interface Review {
  id: string;
  course_id: string;
  user_id: string;
  rating: number;
  comment: string;
  created_at: string;
  // Relations optionnelles
  course?: Course;
  profile?: Profile;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  school_id: string | null;
  created_at: string;
}

export interface Lead {
  id: string;
  course_id: string;
  school_id: string;
  user_name: string;
  user_email: string;
  user_phone: string | null;
  message: string | null;
  status: LeadStatus;
  created_at: string;
}

// Enums et types utilitaires
export type CourseCategory =
  | "informatique"
  | "langues"
  | "commerce"
  | "artisanat"
  | "sante"
  | "art"
  | "droit"
  | "gestion"
  | "autre";

export type CourseFormat = "online" | "presential" | "hybrid";

export type UserRole = "apprenant" | "ecole" | "admin";

export type LeadStatus = "nouveau" | "contacte" | "converti" | "perdu";

// Types pour les filtres de recherche
export interface SearchFilters {
  query?: string;
  category?: CourseCategory | "";
  format?: CourseFormat | "";
  location?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: "price_asc" | "price_desc" | "rating" | "newest";
}

// Labels lisibles pour les enums
export const CATEGORY_LABELS: Record<CourseCategory, string> = {
  informatique: "Informatique & Tech",
  langues: "Langues",
  commerce: "Commerce & Marketing",
  artisanat: "Artisanat & Métiers",
  sante: "Santé & Bien-être",
  art: "Art & Créativité",
  droit: "Droit & Juridique",
  gestion: "Gestion & Finance",
  autre: "Autre",
};

export const FORMAT_LABELS: Record<CourseFormat, string> = {
  online: "En ligne",
  presential: "Présentiel",
  hybrid: "Hybride",
};

export const FORMAT_COLORS: Record<CourseFormat, string> = {
  online: "bg-green-100 text-green-800",
  presential: "bg-blue-100 text-blue-800",
  hybrid: "bg-purple-100 text-purple-800",
};
