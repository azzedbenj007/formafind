// Formulaire de demande de contact / pré-inscription
"use client";
import { useState } from "react";
import { Send, CheckCircle } from "lucide-react";
import { Course } from "@/lib/types";

interface LeadFormProps {
  course: Course;
}

export default function LeadForm({ course }: LeadFormProps) {
  const [form, setForm] = useState({
    user_name: "",
    user_email: "",
    user_phone: "",
    message: "",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { createClient } = await import("@/lib/supabase");
      const supabase = createClient();

      const { error: dbError } = await supabase.from("leads").insert({
        course_id: course.id,
        school_id: course.school_id,
        ...form,
      });

      if (dbError) throw dbError;
      setSuccess(true);
    } catch {
      setError("Une erreur est survenue. Veuillez réessayer.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
        <CheckCircle size={32} className="text-green-600 mx-auto mb-3" />
        <h3 className="font-semibold text-green-800 mb-1">Demande envoyée !</h3>
        <p className="text-sm text-green-700">
          L&apos;école vous contactera sous 48h ouvrées.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Nom complet *
        </label>
        <input
          type="text"
          required
          value={form.user_name}
          onChange={(e) => setForm({ ...form, user_name: e.target.value })}
          placeholder="Jean Dupont"
          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Email *
        </label>
        <input
          type="email"
          required
          value={form.user_email}
          onChange={(e) => setForm({ ...form, user_email: e.target.value })}
          placeholder="jean@exemple.fr"
          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Téléphone
        </label>
        <input
          type="tel"
          value={form.user_phone}
          onChange={(e) => setForm({ ...form, user_phone: e.target.value })}
          placeholder="06 12 34 56 78"
          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Message
        </label>
        <textarea
          rows={3}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          placeholder="Vos questions, votre situation actuelle..."
          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white font-medium py-3 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-70"
      >
        <Send size={16} />
        {loading ? "Envoi en cours..." : "Envoyer ma demande"}
      </button>

      <p className="text-xs text-gray-400 text-center">
        Vos données ne seront partagées qu&apos;avec l&apos;école concernée.
      </p>
    </form>
  );
}
