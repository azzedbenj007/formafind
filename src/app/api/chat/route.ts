import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { anthropic, MODELE_CHAT } from "@/lib/anthropic";
import { OUTILS_GMAO } from "@/lib/chat/tools";
import { executerOutil } from "@/lib/chat/handlers";
import { SYSTEM_PROMPT } from "@/lib/chat/system-prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

const NOMBRE_MAX_TOURS = 6;

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erreur: "Non authentifié" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const messageUtilisateur = typeof body?.message === "string" ? body.message.trim() : "";
  if (!messageUtilisateur) return NextResponse.json({ erreur: "Message vide" }, { status: 400 });

  let conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;

  if (!conversationId) {
    const { data: nouvelle, error } = await supabase
      .from("conversations")
      .insert({ profile_id: user.id, titre: messageUtilisateur.slice(0, 80) })
      .select("id")
      .single();
    if (error || !nouvelle) return NextResponse.json({ erreur: "Impossible de créer la conversation." }, { status: 500 });
    conversationId = nouvelle.id;
  }

  const [{ data: profil }, { data: historique }] = await Promise.all([
    supabase.from("profiles").select("nom_complet, role").eq("id", user.id).single(),
    supabase
      .from("messages_chat")
      .select("role, contenu")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(20),
  ]);

  const messages: Anthropic.MessageParam[] = (historique ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.contenu,
  }));

  const contexte = `${messageUtilisateur}\n\n[Contexte système — ne pas afficher à l'utilisateur : nous sommes le ${new Date().toLocaleDateString(
    "fr-FR"
  )}, utilisateur connecté : ${profil?.nom_complet ?? "inconnu"} (rôle : ${profil?.role ?? "inconnu"}).]`;
  messages.push({ role: "user", content: contexte });

  const encoder = new TextEncoder();
  const outilsUtilises: { nom: string; arguments?: unknown }[] = [];
  const idConversation = conversationId;

  const stream = new ReadableStream({
    async start(controller) {
      function envoyer(evenement: Record<string, unknown>) {
        controller.enqueue(encoder.encode(JSON.stringify(evenement) + "\n"));
      }

      let texteFinal = "";
      let tokensEntree = 0;
      let tokensSortie = 0;

      try {
        for (let tour = 0; tour < NOMBRE_MAX_TOURS; tour++) {
          const reponse = await anthropic.messages.create({
            model: MODELE_CHAT,
            max_tokens: 2048,
            system: SYSTEM_PROMPT,
            tools: OUTILS_GMAO,
            messages,
          });

          tokensEntree += reponse.usage.input_tokens;
          tokensSortie += reponse.usage.output_tokens;

          const blocsTexte = reponse.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
          if (blocsTexte.length > 0) texteFinal = blocsTexte.map((b) => b.text).join("\n");

          const blocsOutils = reponse.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

          if (reponse.stop_reason !== "tool_use" || blocsOutils.length === 0) break;

          messages.push({ role: "assistant", content: reponse.content });

          const resultatsOutils = await Promise.all(
            blocsOutils.map(async (bloc) => {
              envoyer({ type: "outil", nom: bloc.name });
              outilsUtilises.push({ nom: bloc.name, arguments: bloc.input });
              const resultat = await executerOutil(bloc.name, (bloc.input ?? {}) as Record<string, unknown>, supabase);
              return { type: "tool_result" as const, tool_use_id: bloc.id, content: resultat };
            })
          );

          messages.push({ role: "user", content: resultatsOutils });
        }

        if (!texteFinal) texteFinal = "Désolé, je n'ai pas pu formuler de réponse. Reformulez votre question.";

        await supabase.from("messages_chat").insert([
          { conversation_id: idConversation, role: "user", contenu: messageUtilisateur },
          {
            conversation_id: idConversation,
            role: "assistant",
            contenu: texteFinal,
            outils_utilises: outilsUtilises,
            tokens_entree: tokensEntree,
            tokens_sortie: tokensSortie,
          },
        ]);
        await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", idConversation);

        envoyer({ type: "message", contenu: texteFinal, conversationId: idConversation, outilsUtilises });
      } catch (e) {
        envoyer({ type: "erreur", message: e instanceof Error ? e.message : "Erreur inattendue de l'assistant." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
