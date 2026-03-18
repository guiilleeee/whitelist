"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

const apiUrl = process.env.NEXT_PUBLIC_API_URL;

type ReviewAnswer = {
  question_id: number;
  question: string;
  type: "multiple" | "open";
  answer_text: string;
  time_ms: number | null;
  is_suspicious: boolean;
};

type ReviewLog = {
  type: string;
  count: number;
  details: any;
};

export default function ReviewPage() {
  const params = useParams();
  const id = String((params as any)?.id || "");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exam, setExam] = useState<any>(null);
  const [answers, setAnswers] = useState<ReviewAnswer[]>([]);
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  const [decisionStatus, setDecisionStatus] = useState<"idle" | "saving" | "saved">("idle");

  const tabSwitch = useMemo(() => logs.find((l) => l.type === "tab_switch")?.count ?? null, [logs]);
  const fast = useMemo(() => logs.find((l) => l.type === "fast_answer")?.count ?? null, [logs]);

  useEffect(() => {
    if (!apiUrl) {
      setError("API_URL no configurada. Revisa apps/web/.env");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`${apiUrl}/review/${encodeURIComponent(id)}`, { credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `http_${res.status}`);
        return data;
      })
      .then((data) => {
        setExam(data.exam);
        setAnswers(Array.isArray(data.answers) ? data.answers : []);
        setLogs(Array.isArray(data.logs) ? data.logs : []);
        setLoading(false);
      })
      .catch((e: any) => {
        setError(String(e?.message || "No se pudo cargar el panel."));
        setLoading(false);
      });
  }, [id]);

  async function decide(status: "approved" | "rejected") {
    if (!apiUrl) return;
    if (decisionStatus === "saving") return;
    setDecisionStatus("saving");
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/review/${encodeURIComponent(id)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `http_${res.status}`);
      setDecisionStatus("saved");
      setExam((prev: any) => ({ ...(prev || {}), status }));
    } catch (e: any) {
      setDecisionStatus("idle");
      setError(String(e?.message || "No se pudo guardar la decision."));
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-xl w-full panel p-8">
          <h1 className="text-2xl font-display">Cargando revision...</h1>
          <p className="text-muted mt-2">Espera un momento.</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-xl w-full panel p-8">
          <h1 className="text-2xl font-display">No se pudo abrir el panel</h1>
          <p className="text-muted mt-2">Error: {error}</p>
          <a href="/" className="text-xs text-muted mt-6 inline-flex">
            Volver al inicio
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 pb-24">
      <div className="max-w-4xl mx-auto">
        <div className="panel p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs text-muted uppercase tracking-[0.3em]">Genesis Community</div>
              <h1 className="text-2xl font-display">Revision de whitelist</h1>
              <p className="text-sm text-muted mt-2">
                Examen <span className="text-text font-semibold">#{id}</span> · Estado:{" "}
                <span className="text-text font-semibold">{String(exam?.status || "N/A")}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => decide("approved")}
                className="rounded-xl bg-emerald-500/90 text-white font-semibold px-5 py-2 disabled:opacity-60"
                disabled={decisionStatus === "saving"}
              >
                Aceptada
              </button>
              <button
                type="button"
                onClick={() => decide("rejected")}
                className="rounded-xl bg-red-500/90 text-white font-semibold px-5 py-2 disabled:opacity-60"
                disabled={decisionStatus === "saving"}
              >
                Rechazada
              </button>
            </div>
          </div>

          {decisionStatus === "saved" && (
            <div className="mt-4 rounded-lg border border-line bg-soft px-4 py-2 text-xs text-text">
              Decision guardada.
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-lg border border-line bg-soft px-4 py-2 text-xs text-text">
              {error}
            </div>
          )}

          <div className="mt-6 grid md:grid-cols-3 gap-4">
            <div className="rounded-lg border border-line bg-ink/20 p-4">
              <div className="text-xs text-muted">Discord (manual)</div>
              <div className="text-sm text-text mt-1 break-words">{exam?.discord_username || "N/A"}</div>
            </div>
            <div className="rounded-lg border border-line bg-ink/20 p-4">
              <div className="text-xs text-muted">Steam</div>
              <div className="text-sm text-text mt-1 break-words">{exam?.steam_link || "N/A"}</div>
            </div>
            <div className="rounded-lg border border-line bg-ink/20 p-4">
              <div className="text-xs text-muted">Anti-cheat</div>
              <div className="text-sm text-text mt-1">
                Pestanas: {tabSwitch === null ? "N/A" : tabSwitch} · &lt;10s: {fast === null ? "N/A" : fast}
              </div>
            </div>
          </div>

          <div className="mt-8">
            <h2 className="text-lg font-display">Respuestas</h2>
            <div className="mt-4 space-y-4">
              {answers.map((a, idx) => (
                <div key={`${a.question_id}-${idx}`} className="rounded-xl border border-line bg-ink/15 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="text-sm text-text font-semibold">
                      {idx + 1}. {a.question}
                    </div>
                    <div className="text-xs text-muted whitespace-nowrap">
                      {a.time_ms ? `${Math.round(a.time_ms / 1000)}s` : "N/A"} {a.is_suspicious ? "· sospechoso" : ""}
                    </div>
                  </div>
                  <div className="text-sm text-text mt-3 whitespace-pre-wrap">{a.answer_text || "(sin respuesta)"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

