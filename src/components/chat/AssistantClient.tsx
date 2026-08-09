"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquarePlus, Send, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useChat } from "./useChat";
import { MessageBulle } from "./MessageBulle";
import type { Profile } from "@/lib/types";

interface ConversationResume {
  id: string;
  titre: string | null;
  updated_at: string;
}

const SUGGESTIONS = [
  "Quels équipements vitaux sont en panne ?",
  "Quelles interventions sont prévues cette semaine ?",
  "Quel est le taux de disponibilité du parc ?",
  "Montre-moi l'historique du respirateur RESP-014.",
];

export function AssistantClient({ profile }: { profile: Profile }) {
  const [conversations, setConversations] = useState<ConversationResume[]>([]);
  const [saisie, setSaisie] = useState("");
  const { messages, enCours, erreur, conversationId, envoyerMessage, nouvelleConversation, chargerHistorique } = useChat();
  const finDesMessages = useRef<HTMLDivElement>(null);

  const rafraichirListe = useCallback(async () => {
    const reponse = await fetch("/api/chat/conversations");
    if (!reponse.ok) return;
    const { conversations: liste } = await reponse.json();
    setConversations(liste ?? []);
  }, []);

  useEffect(() => {
    rafraichirListe();
  }, [rafraichirListe]);

  useEffect(() => {
    if (!enCours) rafraichirListe();
  }, [enCours, rafraichirListe]);

  useEffect(() => {
    finDesMessages.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function supprimerConversation(id: string) {
    await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
    if (id === conversationId) nouvelleConversation();
    rafraichirListe();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!saisie.trim()) return;
    envoyerMessage(saisie);
    setSaisie("");
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <aside className="hidden w-64 shrink-0 flex-col rounded-2xl border border-gray-200 bg-white sm:flex">
        <div className="border-b border-gray-100 p-3">
          <button
            onClick={nouvelleConversation}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Nouvelle conversation
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={clsx(
                "group flex items-center justify-between gap-1 rounded-lg px-2 py-2 text-sm",
                c.id === conversationId ? "bg-primary-50 text-primary-700" : "text-gray-600 hover:bg-gray-100"
              )}
            >
              <button onClick={() => chargerHistorique(c.id)} className="min-w-0 flex-1 truncate text-left">
                {c.titre || "Nouvelle conversation"}
              </button>
              <button
                onClick={() => supprimerConversation(c.id)}
                className="shrink-0 text-gray-300 hover:text-danger-600 group-hover:text-gray-400"
                aria-label="Supprimer la conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {conversations.length === 0 && <p className="px-2 py-2 text-xs text-gray-400">Aucune conversation.</p>}
        </div>
      </aside>

      <div className="flex flex-1 flex-col rounded-2xl border border-gray-200 bg-white">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-md space-y-4 pt-8 text-center">
              <p className="text-sm text-gray-500">
                Bonjour {profile.nom_complet?.split(" ")[0] || ""}. Posez une question en langage naturel sur le parc,
                les interventions, les équipes ou les contrats.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => envoyerMessage(s)}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-left text-xs text-gray-600 hover:border-primary-300 hover:bg-primary-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => <MessageBulle key={m.id} message={m} />)
          )}
          {erreur && <p className="mx-auto max-w-md rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{erreur}</p>}
          <div ref={finDesMessages} />
        </div>

        <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-gray-200 p-4">
          <input
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder="Posez votre question..."
            disabled={enCours}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-gray-50"
          />
          <button
            type="submit"
            disabled={enCours || !saisie.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white disabled:bg-primary-300"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
