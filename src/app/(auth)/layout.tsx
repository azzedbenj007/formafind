import { Stethoscope } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-600 text-white">
            <Stethoscope className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">GMAO Hospitalière</h1>
          <p className="text-sm text-gray-500">Gestion de la maintenance biomédicale et technique</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
