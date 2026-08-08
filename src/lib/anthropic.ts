// Client Anthropic — SERVEUR UNIQUEMENT (ANTHROPIC_API_KEY n'est jamais exposée
// au navigateur). Importé uniquement depuis src/app/api/chat/route.ts.
import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const MODELE_CHAT = "claude-opus-5";
