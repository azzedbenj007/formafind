// Page de modification d'une formation existante
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { mockCourses } from "@/lib/mock-data";
import CourseForm from "@/components/forms/CourseForm";

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: "Modifier la formation | Dashboard",
};

export default async function EditCoursePage({ params }: Props) {
  const { id } = await params;

  // En production : requête Supabase avec vérification que l'utilisateur est bien propriétaire
  const course = mockCourses.find((c) => c.id === id);
  if (!course) notFound();

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
        <h1 className="text-2xl font-bold text-gray-900">Modifier la formation</h1>
        <p className="text-sm text-gray-500 mt-1 truncate">{course.title}</p>
      </div>

      <CourseForm
        schoolId={course.school_id}
        course={course}
        isEditing
      />
    </div>
  );
}
