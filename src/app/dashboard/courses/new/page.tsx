// Page de création d'une nouvelle formation
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import CourseForm from "@/components/forms/CourseForm";

export const metadata: Metadata = {
  title: "Nouvelle formation | Dashboard",
};

export default function NewCoursePage() {
  // En production : récupérer le school_id de l'utilisateur connecté depuis Supabase
  const schoolId = "a1b2c3d4-0001-0001-0001-000000000001";

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-primary-600 transition-colors"
        >
          <ArrowLeft size={16} />
          Retour au dashboard
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Publier une nouvelle formation</h1>
        <p className="text-gray-500 text-sm mt-1">
          Remplissez les informations ci-dessous pour publier votre formation sur FormaFind.
        </p>
      </div>

      <CourseForm schoolId={schoolId} />
    </div>
  );
}
