import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erreur: "Non authentifié" }, { status: 401 });

  const { data, error } = await supabase
    .from("messages_chat")
    .select("id, role, contenu, outils_utilises, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  return NextResponse.json({ messages: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erreur: "Non authentifié" }, { status: 401 });

  const { error } = await supabase.from("conversations").delete().eq("id", id);
  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  return NextResponse.json({ succes: true });
}
