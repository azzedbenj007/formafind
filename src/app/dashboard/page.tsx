// Dashboard principal pour les centres de formation
"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, Eye, TrendingUp, Users, Star, BookOpen } from "lucide-react";
import { Course } from "@/lib/types";
import { mockCourses } from "@/lib/mock-data";
import { FORMAT_LABELS, CATEGORY_LABELS } from "@/lib/types";
import StarRating from "@/components/ui/StarRating";

export default function DashboardPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // En production : charger les formations de l'école connectée depuis Supabase
    // const supabase = createClient();
    // const { data: { user } } = await supabase.auth.getUser();
    // const { data } = await supabase.from("courses").select("*, reviews(*)").eq("school_id", user.profile.school_id);
    setTimeout(() => {
      setCourses(mockCourses.slice(0, 4));
      setLoading(false);
    }, 300);
  }, []);

  const handleDelete = async (courseId: string) => {
    if (!confirm("Supprimer cette formation ? Cette action est irréversible.")) return;
    setCourses((prev) => prev.filter((c) => c.id !== courseId));
    // En production : await supabase.from("courses").delete().eq("id", courseId);
  };

  const stats = [
    { label: "Formations actives", value: courses.length, icon: BookOpen, color: "bg-blue-50 text-blue-600" },
    { label: "Leads ce mois", value: 12, icon: Users, color: "bg-green-50 text-green-600" },
    { label: "Note moyenne", value: "4.6", icon: Star, color: "bg-amber-50 text-amber-600" },
    { label: "Vues profil", value: 248, icon: TrendingUp, color: "bg-purple-50 text-purple-600" },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* En-tête */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
          <p className="text-gray-500 text-sm mt-0.5">Gérez vos formations et suivez vos performances</p>
        </div>
        <Link
          href="/dashboard/courses/new"
          className="flex items-center gap-2 bg-primary-600 text-white font-medium px-5 py-2.5 rounded-xl hover:bg-primary-700 transition-colors"
        >
          <Plus size={18} />
          Nouvelle formation
        </Link>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className={`inline-flex p-2.5 rounded-xl mb-3 ${color}`}>
              <Icon size={20} />
            </div>
            <div className="text-2xl font-bold text-gray-900">{value}</div>
            <div className="text-sm text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Liste des formations */}
      <div className="bg-white rounded-2xl border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Mes formations</h2>
          <span className="text-sm text-gray-500">{courses.length} formation{courses.length !== 1 ? "s" : ""}</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400">Chargement...</div>
        ) : courses.length === 0 ? (
          <div className="p-12 text-center">
            <BookOpen size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 mb-4">Aucune formation publiée pour l&apos;instant.</p>
            <Link
              href="/dashboard/courses/new"
              className="inline-flex items-center gap-2 bg-primary-600 text-white font-medium px-5 py-2.5 rounded-xl hover:bg-primary-700 transition-colors"
            >
              <Plus size={16} />
              Créer ma première formation
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {courses.map((course) => (
              <div key={course.id} className="px-6 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                {/* Infos formation */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 text-sm truncate">{course.title}</h3>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="text-xs text-gray-500">{CATEGORY_LABELS[course.category]}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-xs text-gray-500">{FORMAT_LABELS[course.format]}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-xs font-medium text-gray-700">{course.price.toLocaleString("fr-FR")} €</span>
                  </div>
                </div>

                {/* Note */}
                <div className="hidden sm:flex items-center gap-1.5">
                  {course.avg_rating !== undefined && course.avg_rating > 0 ? (
                    <>
                      <StarRating rating={course.avg_rating} size="sm" />
                      <span className="text-xs text-gray-500">({course.review_count})</span>
                    </>
                  ) : (
                    <span className="text-xs text-gray-400">Aucun avis</span>
                  )}
                </div>

                {/* Statut */}
                <span className={`hidden md:inline-flex text-xs px-2.5 py-1 rounded-full font-medium ${
                  course.is_active
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-600"
                }`}>
                  {course.is_active ? "Publié" : "Inactif"}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <Link
                    href={`/course/${course.id}`}
                    title="Voir la page publique"
                    className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                  >
                    <Eye size={16} />
                  </Link>
                  <Link
                    href={`/dashboard/courses/${course.id}/edit`}
                    title="Modifier"
                    className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                  >
                    <Edit2 size={16} />
                  </Link>
                  <button
                    onClick={() => handleDelete(course.id)}
                    title="Supprimer"
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
