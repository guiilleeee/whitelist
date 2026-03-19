"use client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL;

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-12 flex items-center justify-center relative overflow-hidden">
      <div className="absolute -top-24 right-10 h-48 w-48 rounded-full bg-accent/20 blur-3xl animate-float" />
      <div className="absolute -bottom-24 left-10 h-56 w-56 rounded-full bg-glow/20 blur-3xl animate-float" />

      <div className="w-full max-w-2xl glass glow-border p-10 md:p-12 animate-fadeInUp">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-soft border border-line flex items-center justify-center">
            <img src="/genesis-logo.png" alt="Genesis Community" className="h-10 w-10 object-contain" />
          </div>
          <div>
            <div className="chip">Genesis Community</div>
            <h1 className="text-3xl md:text-4xl font-display mt-3 leading-tight">
              Whitelist <span className="gradient-text">Oficial</span>
            </h1>
            <p className="text-sm text-muted mt-2">
              Acceso con Discord.
            </p>
          </div>
        </div>

        <div className="mt-10">
          <a
            href={`${apiUrl}/auth/discord`}
            className="w-full inline-flex items-center justify-center rounded-xl bg-accent text-white font-semibold px-6 py-3 shadow-glow transition btn-soft"
          >
            Iniciar sesion con Discord
          </a>
        </div>

        <div className="mt-6 flex flex-wrap gap-2 text-xs text-muted">
          <span className="chip">Anti-cheat activo</span>
          <span className="chip">Revision staff</span>
          <span className="chip">Proceso seguro</span>
        </div>
      </div>
    </main>
  );
}
