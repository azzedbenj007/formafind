"use client";

// Panneau de chat global, monté dans (app)/layout.tsx sur toutes les pages.
// NOTE : ceci est un placeholder de la structure UI posé lors du jalon
// fondations. Le câblage complet (streaming SSE vers /api/chat, historique
// des conversations, tool-use Claude) est implémenté au jalon "Chatbot IA".
import { useState } from "react";
import { Bot, X } from "lucide-react";
import type { Profile } from "@/lib/types";

export function ChatPanel({ profile }: { profile: Profile }) {
  const [ouvert, setOuvert] = useState(false);

  return (
    <>
      <button
        onClick={() => setOuvert((v) => !v)}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary-600 text-white shadow-lg transition-transform hover:scale-105"
        aria-label="Ouvrir l'assistant IA"
      >
        {ouvert ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </button>

      {ouvert && (
        <div className="fixed bottom-20 right-5 z-40 flex h-[32rem] w-96 max-w-[calc(100vw-2.5rem)] flex-col rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
            <Bot className="h-4 w-4 text-primary-600" />
            <span className="text-sm font-semibold text-gray-900">Assistant GMAO</span>
          </div>
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <p className="text-sm text-gray-500">
              Bonjour {profile.nom_complet?.split(" ")[0] || ""}. L&apos;assistant IA arrive au prochain jalon —
              interrogation en langage naturel du parc, des interventions et des contrats.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
