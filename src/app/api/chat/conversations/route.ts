import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erreur: "Non authentifié" }, { status: 401 });

  const { data, error } = await supabase
    .from("conversations")
    .select("id, titre, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  return NextResponse.json({ conversations: data });
}

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erreur: "Non authentifié" }, { status: 401 });

  const { data, error } = await supabase
    .from("conversations")
    .insert({ profile_id: user.id, titre: null })
    .select("id, titre, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ erreur: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data });
}
