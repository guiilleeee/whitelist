"use client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL;

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-12 flex items-center justify-center">
      <div className="w-full max-w-xl panel p-8 md:p-10">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-soft border border-line flex items-center justify-center">
            <img src="/genesis-logo.png" alt="Genesis Community" className="h-10 w-10 object-contain" />
          </div>
          <div>
            <div className="chip">Genesis Community</div>
            <h1 className="text-2xl md:text-3xl font-display mt-3 leading-tight">
              Whitelist
            </h1>
            <p className="text-sm text-muted mt-2">
              Acceso con Discord.
            </p>
          </div>
        </div>

        <div className="mt-8">
          <a
            href={`${apiUrl}/auth/discord`}
            className="w-full inline-flex items-center justify-center rounded-xl bg-accent text-white font-semibold px-6 py-3 shadow-glow transition"
          >
            Iniciar sesion con Discord
          </a>
        </div>
      </div>
    </main>
  );
}
