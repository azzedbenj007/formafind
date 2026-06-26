// Layout racine de l'application Next.js
import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: {
    default: "FormaFind - La marketplace de la formation",
    template: "%s | FormaFind",
  },
  description:
    "Trouvez et comparez facilement les meilleures formations professionnelles : informatique, langues, commerce et plus. Avis vérifiés, prix transparents.",
  keywords: ["formation professionnelle", "école", "cours", "certification", "reconversion"],
  openGraph: {
    type: "website",
    siteName: "FormaFind",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>
        <Navbar />
        <main className="min-h-[calc(100vh-64px)]">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
