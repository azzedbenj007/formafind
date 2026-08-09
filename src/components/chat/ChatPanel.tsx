"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Maximize2, Send, X } from "lucide-react";
import { useChat } from "./useChat";
import { MessageBulle } from "./MessageBulle";
import type { Profile } from "@/lib/types";

const SUGGESTIONS = [
  "Quels équipements vitaux sont en panne ?",
  "Quelles interventions sont en retard ?",
  "Quels contrats expirent dans les 60 jours ?",
  "Quel est le taux de disponibilité du parc ?",
];

export function ChatPanel({ profile }: { profile: Profile }) {
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState("");
  const { messages, enCours, erreur, envoyerMessage } = useChat();
  const finDesMessages = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finDesMessages.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!saisie.trim()) return;
    envoyerMessage(saisie);
    setSaisie("");
  }

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
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary-600" />
              <span className="text-sm font-semibold text-gray-900">Assistant GMAO</span>
            </div>
            <Link href="/assistant" className="text-gray-400 hover:text-gray-600" title="Ouvrir en plein écran">
              <Maximize2 className="h-4 w-4" />
            </Link>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">
                  Bonjour {profile.nom_complet?.split(" ")[0] || ""}. Posez-moi une question sur le parc, les
                  interventions ou les contrats.
                </p>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => envoyerMessage(s)}
                      className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-xs text-gray-600 hover:border-primary-300 hover:bg-primary-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => <MessageBulle key={m.id} message={m} />)
            )}
            {erreur && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-700">{erreur}</p>}
            <div ref={finDesMessages} />
          </div>

          <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-gray-200 p-3">
            <input
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              placeholder="Posez votre question..."
              disabled={enCours}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-gray-50"
            />
            <button
              type="submit"
              disabled={enCours || !saisie.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white disabled:bg-primary-300"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
