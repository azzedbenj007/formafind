// Formulaire de création/modification d'une formation (Dashboard école)
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Course, CATEGORY_LABELS, FORMAT_LABELS, CourseCategory, CourseFormat } from "@/lib/types";

interface CourseFormProps {
  schoolId: string;
  course?: Partial<Course>;
  isEditing?: boolean;
}

export default function CourseForm({ schoolId, course, isEditing = false }: CourseFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    title: course?.title || "",
    description: course?.description || "",
    category: (course?.category || "") as CourseCategory | "",
    duration: course?.duration || "",
    format: (course?.format || "") as CourseFormat | "",
    price: course?.price?.toString() || "",
    schedule_details: course?.schedule_details || "",
    prerequisites: course?.prerequisites || "",
    certification: course?.certification || "",
    seats_available: course?.seats_available?.toString() || "",
  });

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { createClient } = await import("@/lib/supabase");
      const supabase = createClient();

      const payload = {
        school_id: schoolId,
        title: form.title,
        description: form.description,
        category: form.category as CourseCategory,
        duration: form.duration,
        format: form.format as CourseFormat,
        price: parseFloat(form.price),
        schedule_details: form.schedule_details,
        prerequisites: form.prerequisites || null,
        certification: form.certification || null,
        seats_available: form.seats_available ? parseInt(form.seats_available) : null,
      };

      let dbError;
      if (isEditing && course?.id) {
        ({ error: dbError } = await supabase
          .from("courses")
          .update(payload)
          .eq("id", course.id));
      } else {
        ({ error: dbError } = await supabase.from("courses").insert(payload));
      }

      if (dbError) throw dbError;
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Une erreur est survenue. Vérifiez les données et réessayez.");
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Informations principales */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Informations principales</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Titre de la formation *</label>
          <input type="text" required value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Ex : Développement Web Full-Stack React" className={inputClass} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
          <textarea required rows={4} value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Décrivez le contenu, les objectifs et les débouchés de cette formation..." className={`${inputClass} resize-none`} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Domaine *</label>
            <select required value={form.category} onChange={(e) => update("category", e.target.value)} className={inputClass}>
              <option value="">Sélectionner un domaine</option>
              {(Object.entries(CATEGORY_LABELS) as [CourseCategory, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Format *</label>
            <select required value={form.format} onChange={(e) => update("format", e.target.value)} className={inputClass}>
              <option value="">Sélectionner un format</option>
              {(Object.entries(FORMAT_LABELS) as [CourseFormat, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Logistique */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Logistique & Tarification</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Durée *</label>
            <input type="text" required value={form.duration} onChange={(e) => update("duration", e.target.value)} placeholder="Ex : 3 mois (120h)" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prix (€) *</label>
            <input type="number" required min="0" step="0.01" value={form.price} onChange={(e) => update("price", e.target.value)} placeholder="1500" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Places disponibles</label>
            <input type="number" min="0" value={form.seats_available} onChange={(e) => update("seats_available", e.target.value)} placeholder="Illimité si vide" className={inputClass} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Horaires *</label>
          <textarea required rows={2} value={form.schedule_details} onChange={(e) => update("schedule_details", e.target.value)} placeholder="Ex : Lundi-Vendredi 9h-17h + cours en ligne le soir" className={`${inputClass} resize-none`} />
        </div>
      </div>

      {/* Informations complémentaires */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Informations complémentaires</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Prérequis</label>
          <input type="text" value={form.prerequisites} onChange={(e) => update("prerequisites", e.target.value)} placeholder="Ex : Bac+2 ou expérience équivalente" className={inputClass} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Certification obtenue</label>
          <input type="text" value={form.certification} onChange={(e) => update("certification", e.target.value)} placeholder="Ex : RNCP Niveau 6 - Développeur Web" className={inputClass} />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>
      )}

      <div className="flex gap-3 justify-end">
        <button type="button" onClick={() => router.back()} className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          Annuler
        </button>
        <button type="submit" disabled={loading} className="flex items-center gap-2 bg-primary-600 text-white font-medium px-6 py-2.5 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-70">
          <Save size={16} />
          {loading ? "Enregistrement..." : isEditing ? "Mettre à jour" : "Publier la formation"}
        </button>
      </div>
    </form>
  );
}
