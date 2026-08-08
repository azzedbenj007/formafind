// Helpers de rôle côté UI (affichage conditionnel de boutons/liens).
// Ce ne sont QUE des raccourcis d'ergonomie : la véritable barrière
// d'autorisation est le Row Level Security de Supabase (supabase/schema.sql).
// Ne jamais faire reposer une décision de sécurité uniquement sur ces helpers.
import type { Role } from "./types";

export function peutGererReferentiels(role: Role | null | undefined): boolean {
  return role === "admin" || role === "responsable_maintenance";
}

export function peutSupprimer(role: Role | null | undefined): boolean {
  return role === "admin";
}

export function peutCreerIntervention(role: Role | null | undefined): boolean {
  return role !== "lecture_seule" && !!role;
}

export function peutUploaderDocument(role: Role | null | undefined): boolean {
  return role !== "lecture_seule" && !!role;
}

export function peutModifierIntervention(
  role: Role | null | undefined,
  profileId: string | null | undefined,
  intervention: { technicien_id: string | null; equipe_id: string | null },
  mesEquipeIds: string[]
): boolean {
  if (role === "admin" || role === "responsable_maintenance") return true;
  if (!profileId) return false;
  if (intervention.technicien_id === profileId) return true;
  if (intervention.equipe_id && mesEquipeIds.includes(intervention.equipe_id)) return true;
  return false;
}

export function peutGererUtilisateurs(role: Role | null | undefined): boolean {
  return role === "admin";
}

export function estLectureSeule(role: Role | null | undefined): boolean {
  return role === "lecture_seule" || !role;
}
