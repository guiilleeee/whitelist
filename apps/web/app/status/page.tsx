"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function StatusContent() {
  const params = useSearchParams();
  const error = params.get("error");

  const messages = {
    discord_too_new: "Tu cuenta de Discord no cumple los 6 meses de antiguedad.",
    blacklisted: "Tu cuenta no puede acceder al proceso de whitelist.",
    oauth_failed: "No se pudo completar el login con Discord.",
    missing_code: "Falta el codigo de autorizacion.",
    server_error: "Ocurrio un error interno. Intenta nuevamente."
  } as const;

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full glass glow-border p-8 text-center animate-fadeInUp">
        <div className="flex items-center justify-center mb-4">
          <div className="h-12 w-12 rounded-2xl bg-soft border border-line flex items-center justify-center">
            <img src="/genesis-logo.png" alt="Genesis Community" className="h-9 w-9 object-contain" />
          </div>
        </div>
        <h1 className="text-2xl font-display mb-4 gradient-text">Acceso bloqueado</h1>
        <p className="text-muted mb-6">
          {messages[error as keyof typeof messages] || "No fue posible continuar."}
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-xl border border-line px-4 py-2 text-text btn-soft"
        >
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}

export default function StatusPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-muted">Cargando...</div>}>
      <StatusContent />
    </Suspense>
  );
}
