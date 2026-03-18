"use client";

import { useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL;

type Exam = {
  id: number;
  status: string;
  discord_username: string | null;
  steam_link: string | null;
  created_at: string;
  submitted_at: string | null;
  answers: { question_id: number; answer_text: string; time_ms: number | null; is_suspicious: boolean }[];
  logs: { type: string; count: number }[];
};

export default function AdminPage() {
  const [exams, setExams] = useState<Exam[]>([]);

  useEffect(() => {
    fetch(`${apiUrl}/admin/exams`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setExams(data.exams || []));
  }, []);

  async function updateStatus(id: number, status: string) {
    await fetch(`${apiUrl}/admin/exams/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status })
    });

    setExams((prev) => prev.map((exam) => (exam.id === id ? { ...exam, status } : exam)));
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <div className="h-12 w-12 rounded-2xl bg-soft border border-line flex items-center justify-center">
            <img src="/genesis-logo.png" alt="Genesis Community" className="h-9 w-9 object-contain" />
          </div>
          <h1 className="text-3xl font-display">Panel de administracion</h1>
        </div>
        <div className="space-y-6">
          {exams.map((exam) => (
            <div key={exam.id} className="panel p-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg">{exam.discord_username || "Usuario sin alias"}</h2>
                  <p className="text-sm text-muted">Steam: {exam.steam_link || "N/A"}</p>
                  <p className="text-xs text-muted">Estado: {exam.status}</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => updateStatus(exam.id, "approved")}
                    className="rounded-lg bg-accent text-white px-4 py-2 text-sm font-semibold"
                  >
                    Aprobar
                  </button>
                  <button
                    onClick={() => updateStatus(exam.id, "rejected")}
                    className="rounded-lg border border-line px-4 py-2 text-sm text-text"
                  >
                    Rechazar
                  </button>
                </div>
              </div>
              <div className="mt-4 grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h3 className="text-sm uppercase text-muted">Respuestas</h3>
                  <ul className="text-sm text-text space-y-2">
                    {exam.answers.map((ans, idx) => (
                      <li key={idx} className="rounded-lg bg-ink/30 border border-line px-3 py-2">
                        {ans.answer_text}
                        {ans.is_suspicious && (
                          <span className="ml-2 text-xs text-accent">Sospechoso</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm uppercase text-muted mb-2">Logs anti-cheat</h3>
                  <ul className="text-sm text-text space-y-2">
                    {exam.logs.map((log, idx) => (
                      <li key={idx} className="rounded-lg bg-ink/30 border border-line px-3 py-2">
                        {log.type}: {log.count}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
