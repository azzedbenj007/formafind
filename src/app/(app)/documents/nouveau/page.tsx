import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { peutUploaderDocument } from "@/lib/permissions";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { DocumentForm } from "@/components/documents/DocumentForm";
import { Carte } from "@/components/ui/Carte";

export const metadata = { title: "Nouveau document" };

interface SearchParams {
  equipement?: string;
}

export default async function NouveauDocumentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const profile = await getCurrentProfile();
  if (!peutUploaderDocument(profile?.role)) redirect("/documents");

  const supabase = await createServerSupabaseClient();
  const [{ data: equipements }, { data: contrats }] = await Promise.all([
    supabase.from("equipements").select("id, nom, code_interne").eq("actif", true).order("nom"),
    supabase.from("contrats").select("id, intitule, reference").order("intitule"),
  ]);

  const hrefRetour = params.equipement ? `/documents?equipement=${params.equipement}` : "/documents";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={hrefRetour} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          Retour à la liste
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Nouveau document</h1>
      </div>

      <Carte>
        <DocumentForm
          equipements={equipements ?? []}
          contrats={contrats ?? []}
          equipementIdPreselectionne={params.equipement}
        />
      </Carte>
    </div>
  );
}
