"use client";

import { useCallback, useState } from "react";

export interface MessageAffiche {
  id: string;
  role: "user" | "assistant";
  contenu: string;
  outilEnCours?: string;
}

export function useChat(conversationIdInitiale?: string) {
  const [conversationId, setConversationId] = useState<string | undefined>(conversationIdInitiale);
  const [messages, setMessages] = useState<MessageAffiche[]>([]);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const chargerHistorique = useCallback(async (id: string) => {
    const reponse = await fetch(`/api/chat/conversations/${id}`);
    if (!reponse.ok) return;
    const { messages: historique } = await reponse.json();
    setMessages(
      (historique ?? []).map((m: { id: string; role: "user" | "assistant"; contenu: string }) => ({
        id: m.id,
        role: m.role,
        contenu: m.contenu,
      }))
    );
    setConversationId(id);
  }, []);

  const nouvelleConversation = useCallback(() => {
    setConversationId(undefined);
    setMessages([]);
    setErreur(null);
  }, []);

  const envoyerMessage = useCallback(
    async (texte: string) => {
      const contenu = texte.trim();
      if (!contenu || enCours) return;

      setErreur(null);
      const idUtilisateur = `u-${Date.now()}`;
      const idAssistant = `a-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: idUtilisateur, role: "user", contenu },
        { id: idAssistant, role: "assistant", contenu: "", outilEnCours: undefined },
      ]);
      setEnCours(true);

      try {
        const reponse = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: contenu, conversationId }),
        });

        if (!reponse.ok || !reponse.body) {
          const corps = await reponse.json().catch(() => null);
          throw new Error(corps?.erreur || "L'assistant est indisponible pour le moment.");
        }

        const lecteur = reponse.body.getReader();
        const decodeur = new TextDecoder();
        let tampon = "";

        for (;;) {
          const { done, value } = await lecteur.read();
          if (done) break;
          tampon += decodeur.decode(value, { stream: true });

          const lignes = tampon.split("\n");
          tampon = lignes.pop() ?? "";

          for (const ligne of lignes) {
            if (!ligne.trim()) continue;
            const evenement = JSON.parse(ligne);

            if (evenement.type === "outil") {
              setMessages((prev) =>
                prev.map((m) => (m.id === idAssistant ? { ...m, outilEnCours: evenement.nom } : m))
              );
            } else if (evenement.type === "message") {
              setMessages((prev) =>
                prev.map((m) => (m.id === idAssistant ? { ...m, contenu: evenement.contenu, outilEnCours: undefined } : m))
              );
              if (evenement.conversationId) setConversationId(evenement.conversationId);
            } else if (evenement.type === "erreur") {
              throw new Error(evenement.message);
            }
          }
        }
      } catch (e) {
        setErreur(e instanceof Error ? e.message : "Erreur inattendue.");
        setMessages((prev) => prev.filter((m) => m.id !== idAssistant));
      } finally {
        setEnCours(false);
      }
    },
    [conversationId, enCours]
  );

  return { messages, enCours, erreur, conversationId, envoyerMessage, nouvelleConversation, chargerHistorique };
}
