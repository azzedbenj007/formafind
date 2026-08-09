import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { AssistantClient } from "@/components/chat/AssistantClient";

export const metadata = { title: "Assistant IA" };

export default async function AssistantPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/connexion");

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Assistant IA</h1>
        <p className="text-sm text-gray-500">Interrogez le parc, les interventions et les contrats en langage naturel.</p>
      </div>
      <AssistantClient profile={profile} />
    </div>
  );
}
