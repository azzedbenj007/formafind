import type { SupabaseClient } from "@supabase/supabase-js";

const LIMITE_DEFAUT = 20;
const LIMITE_MAX = 50;

function plafonner(limite: unknown): number {
  const n = typeof limite === "number" ? limite : LIMITE_DEFAUT;
  return Math.min(Math.max(1, Math.round(n)), LIMITE_MAX);
}

function envelopper(resultats: unknown[], nombreTotal: number) {
  return JSON.stringify({
    nombre_total: nombreTotal,
    resultats,
    ...(nombreTotal > resultats.length
      ? { note: `Seuls les ${resultats.length} premiers résultats sur ${nombreTotal} sont affichés.` }
      : {}),
  });
}

async function rechercherEquipements(supabase: SupabaseClient, entree: Record<string, unknown>) {
  const limite = plafonner(entree.limite);
  let requete = supabase
    .from("vue_equipements_detail")
    .select("code_interne, nom, modele, statut, criticite, service_nom, site_nom, localisation_precise", { count: "exact" })
    .eq("actif", true);

  if (entree.statut) requete = requete.eq("statut", entree.statut as string);
  if (entree.criticite) requete = requete.eq("criticite", entree.criticite as string);
  if (entree.service) requete = requete.ilike("service_nom", `%${entree.service}%`);
  if (entree.recherche) {
    const q = String(entree.recherche).replace(/[%,]/g, "");
    requete = requete.or(`nom.ilike.%${q}%,code_interne.ilike.%${q}%,numero_serie.ilike.%${q}%`);
  }

  const { data, count, error } = await requete.limit(limite);
  if (error) return JSON.stringify({ erreur: error.message });
  return envelopper(data ?? [], count ?? (data?.length ?? 0));
}

async function obtenirEquipement(supabase: SupabaseClient, entree: Record<string, unknown>) {
  const identifiant = String(entree.identifiant ?? "").replace(/[%,]/g, "");
  if (!identifiant) return JSON.stringify({ erreur: "Identifiant manquant." });

  const { data: equipement, error } = await supabase
    .from("vue_equipements_detail")
    .select("*")
    .or(`code_interne.ilike.%${identifiant}%,nom.ilike.%${identifiant}%,numero_serie.ilike.%${identifiant}%`)
    .limit(1)
    .maybeSingle();

  if (error) return JSON.stringify({ erreur: error.message });
  if (!equipement) return JSON.stringify({ trouve: false, message: "Aucun équipement ne correspond à cet identifiant." });

  const [{ data: interventions }, { data: contrats }, { data: documents }, { data: plans }] = await Promise.all([
    supabase
      .from("vue_interventions_detail")
      .select("numero, titre, statut, type, date_echeance, date_fin")
      .eq("equipement_id", equipement.id)
      .order("date_echeance", { ascending: false })
      .limit(5),
    supabase
      .from("contrats_equipements")
      .select("contrats:contrat_id(intitule, date_fin, statut)")
      .eq("equipement_id", equipement.id),
    supabase.from("documents").select("titre, type_document").eq("equipement_id", equipement.id).limit(10),
    supabase
      .from("plans_maintenance")
      .select("nom, prochaine_echeance, frequence_valeur, frequence_unite")
      .eq("equipement_id", equipement.id)
      .eq("actif", true),
  ]);

  return JSON.stringify({
    trouve: true,
    equipement: {
      code_interne: equipement.code_interne,
      nom: equipement.nom,
      modele: equipement.modele,
      fabricant: equipement.fabricant,
      statut: equipement.statut,
      criticite: equipement.criticite,
      service: equipement.service_nom,
      site: equipement.site_nom,
      localisation: equipement.localisation_precise,
      fin_garantie: equipement.fin_garantie,
      sous_contrat: equipement.sous_contrat,
    },
    dernieres_interventions: interventions ?? [],
    contrats: (contrats ?? []).map((c) => (c as unknown as { contrats: unknown }).contrats),
    documents: documents ?? [],
    plans_maintenance: plans ?? [],
  });
}

async function compterEquipements(supabase: SupabaseClient, entree: Record<string, unknown>) {
  const dimension = String(entree.dimension ?? "statut");
  const colonne: Record<string, string> = {
    statut: "statut",
    criticite: "criticite",
    service: "service_nom",
    categorie: "categorie_nom",
  };
  const col = colonne[dimension] ?? "statut";

  const { data, error } = await supabase.from("vue_equipements_detail").select(col).eq("actif", true);
  if (error) return JSON.stringify({ erreur: error.message });

  const compteur: Record<string, number> = {};
  (data ?? []).forEach((ligne) => {
    const valeur = String((ligne as unknown as Record<string, unknown>)[col] ?? "non_renseigne");
    compteur[valeur] = (compteur[valeur] ?? 0) + 1;
  });

  return JSON.stringify({ dimension, repartition: Object.entries(compteur).map(([valeur, nombre]) => ({ valeur, nombre })) });
}

async function rechercherInterventions(supabase: SupabaseClient, entree: Record<string, unknown>) {
  const limite = plafonner(entree.limite);
  let requete = supabase
    .from("vue_interventions_detail")
    .select("numero, titre, type, statut, priorite, equipement_nom, equipement_code_interne, service_nom, technicien_nom, date_echeance, en_retard", {
      count: "exact",
    });

  if (entree.statut) requete = requete.eq("statut", entree.statut as string);
  if (entree.type) requete = requete.eq("type", entree.type as string);
  if (entree.priorite) requete = requete.eq("priorite", entree.priorite as string);
  if (entree.service) requete = requete.ilike("service_nom", `%${entree.service}%`);
  if (entree.equipement) {
    const q = String(entree.equipement).replace(/[%,]/g, "");
    requete = requete.or(`equipement_nom.ilike.%${q}%,equipement_code_interne.ilike.%${q}%`);
  }
  if (entree.en_retard === true) requete = requete.eq("en_retard", true);

  const { data, count, error } = await requete.order("date_echeance", { ascending: true }).limit(limite);
  if (error) return JSON.stringify({ erreur: error.message });
  return envelopper(data ?? [], count ?? (data?.length ?? 0));
}

async function obtenirKpis(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("vue_kpi_global").select("*").single();
  if (error) return JSON.stringify({ erreur: error.message });
  return JSON.stringify(data);
}

async function rechercherContrats(supabase: SupabaseClient, entree: Record<string, unknown>) {
  const limite = plafonner(entree.limite);
  let requete = supabase
    .from("vue_contrats_detail")
    .select("reference, intitule, fournisseur_nom, type_contrat, statut, date_fin, jours_avant_expiration, nb_equipements_couverts", {
      count: "exact",
    });

  if (entree.statut) requete = requete.eq("statut", entree.statut as string);
  if (typeof entree.expire_dans_jours === "number") {
    requete = requete.eq("statut", "actif").lte("jours_avant_expiration", entree.expire_dans_jours);
  }

  const { data, count, error } = await requete.order("date_fin", { ascending: true }).limit(limite);
  if (error) return JSON.stringify({ erreur: error.message });
  return envelopper(data ?? [], count ?? (data?.length ?? 0));
}

async function listerMaintenancesDues(supabase: SupabaseClient, entree: Record<string, unknown>) {
  const limite = plafonner(entree.limite);
  const dansJours = typeof entree.dans_jours === "number" ? entree.dans_jours : 30;
  const echeanceMax = new Date(Date.now() + dansJours * 86400000).toISOString().slice(0, 10);

  const { data, count, error } = await supabase
    .from("plans_maintenance")
    .select("nom, type_intervention, prochaine_echeance, priorite, equipements:equipement_id(nom, code_interne)", { count: "exact" })
    .eq("actif", true)
    .lte("prochaine_echeance", echeanceMax)
    .order("prochaine_echeance", { ascending: true })
    .limit(limite);

  if (error) return JSON.stringify({ erreur: error.message });
  return envelopper(data ?? [], count ?? (data?.length ?? 0));
}

async function rechercherDocuments(supabase: SupabaseClient, entree: Record<string, unknown>) {
  const limite = plafonner(entree.limite);
  let requete = supabase
    .from("documents")
    .select("titre, type_document, created_at, equipements:equipement_id(nom, code_interne)", { count: "exact" });

  if (entree.type_document) requete = requete.eq("type_document", entree.type_document as string);
  if (entree.recherche) {
    const q = String(entree.recherche).replace(/[%,]/g, "");
    requete = requete.ilike("titre", `%${q}%`);
  }

  const { data, count, error } = await requete.order("created_at", { ascending: false }).limit(limite);
  if (error) return JSON.stringify({ erreur: error.message });
  return envelopper(data ?? [], count ?? (data?.length ?? 0));
}

async function obtenirChargeEquipe(supabase: SupabaseClient, entree: Record<string, unknown>) {
  let requeteEquipes = supabase.from("equipes").select("id, nom");
  if (entree.equipe) requeteEquipes = requeteEquipes.ilike("nom", `%${entree.equipe}%`);
  const { data: equipes, error: erreurEquipes } = await requeteEquipes;
  if (erreurEquipes) return JSON.stringify({ erreur: erreurEquipes.message });

  const resultats = await Promise.all(
    (equipes ?? []).map(async (e) => {
      const { data: interventions } = await supabase
        .from("vue_interventions_detail")
        .select("statut, en_retard")
        .eq("equipe_id", e.id);
      const ouvertes = (interventions ?? []).filter((i) => ["a_faire", "en_cours", "en_attente_pieces"].includes(i.statut));
      return {
        equipe: e.nom,
        interventions_ouvertes: ouvertes.length,
        interventions_en_retard: ouvertes.filter((i) => i.en_retard).length,
      };
    })
  );

  return JSON.stringify({ resultats });
}

export async function executerOutil(nom: string, entree: Record<string, unknown>, supabase: SupabaseClient): Promise<string> {
  try {
    switch (nom) {
      case "rechercher_equipements":
        return await rechercherEquipements(supabase, entree);
      case "obtenir_equipement":
        return await obtenirEquipement(supabase, entree);
      case "compter_equipements":
        return await compterEquipements(supabase, entree);
      case "rechercher_interventions":
        return await rechercherInterventions(supabase, entree);
      case "obtenir_kpis":
        return await obtenirKpis(supabase);
      case "rechercher_contrats":
        return await rechercherContrats(supabase, entree);
      case "lister_maintenances_dues":
        return await listerMaintenancesDues(supabase, entree);
      case "rechercher_documents":
        return await rechercherDocuments(supabase, entree);
      case "obtenir_charge_equipe":
        return await obtenirChargeEquipe(supabase, entree);
      default:
        return JSON.stringify({ erreur: `Outil inconnu : ${nom}` });
    }
  } catch (e) {
    return JSON.stringify({ erreur: e instanceof Error ? e.message : "Erreur inconnue lors de l'exécution de l'outil." });
  }
}
