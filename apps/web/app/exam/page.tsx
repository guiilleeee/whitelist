"use client";

import { useEffect, useMemo, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL;

type Question = {
  id: number;
  question: string;
  type: "multiple" | "open";
  options?: string[];
};

type Answer = {
  questionId: number;
  answer: string;
  timeMs: number;
};

type Faction = "SAMS" | "SAPD" | "SAFD" | "ilegal" | "militares" | "civil" | "";
type SocialClass = "alta" | "media" | "baja" | "";

type Profile = {
  discordName: string;
  steamLink: string;
  isAdult: boolean | null;
  discordExperience: string;
  applicationReason: "primera_vez" | "segundo_slot" | "wipe" | "ck" | "";

  characterName: string;
  birthYear: string;
  faction: Faction;
  socialClass: SocialClass;
  characterStory: string;
  characterGoal: string;
};

const FACTIONS: Faction[] = ["SAMS", "SAPD", "SAFD", "ilegal", "militares", "civil"];
const SOCIAL_CLASSES: SocialClass[] = ["alta", "media", "baja"];

function countNonEmptyLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean).length;
}

function countWords(text: string) {
  // Keep this deliberately simple (no Unicode property escapes) to avoid browser incompatibilities.
  const cleaned = text
    .replace(/\u00A0/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[.,;:!?()[\]{}"“”'’`´/\\|<>+=*_~@#$%^&-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(" ").filter(Boolean).length;
}

function normalizeForCompare(text: string) {
  return String(text || "")
    .toLowerCase()
    .replace(/\u00A0/g, " ")
    .replace(/[.,;:!?()[\]{}"“”'’`´/\\|<>+=*_~@#$%^&-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textsAreTooSimilar(a: string, b: string) {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  // If one contains the other and both are substantial, treat as the same content.
  if ((na.includes(nb) || nb.includes(na)) && Math.min(na.length, nb.length) > 300) return true;

  // Token overlap heuristic (cheap similarity check, good enough to catch copy/paste).
  const wa = na.split(" ").filter(Boolean);
  const wb = nb.split(" ").filter(Boolean);
  if (wa.length < 40 || wb.length < 40) return false;

  const sa = new Set(wa);
  const sb = new Set(wb);
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;

  const minSize = Math.min(sa.size, sb.size) || 1;
  const overlap = inter / minSize;
  return overlap >= 0.9;
}

function looksSplitByTimeHorizon(text: string) {
  const t = text.toLowerCase();
  // Disallow goals broken into short/medium/long term sections.
  return (
    /corto\s+plazo/.test(t) ||
    /medio\s+plazo/.test(t) ||
    /largo\s+plazo/.test(t) ||
    /short\s*term/.test(t) ||
    /long\s*term/.test(t)
  );
}

function goalLooksInvalid(goal: string) {
  const g = goal.toLowerCase();
  const banned = ["banda", "crear una banda", "crear banda", "pertenecer a una banda", "pertenecer banda"];
  return banned.some((b) => g.includes(b));
}

function formatDateValue(date: Date | null) {
  if (!date) return "--/--/----";
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export default function ExamPage() {
  const [user, setUser] = useState<any>(null);
  const [phase, setPhase] = useState<"step1" | "step2" | "exam" | "done">("step1");
  const [blockedOverlay, setBlockedOverlay] = useState(false);
  const [needsReset, setNeedsReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [examId, setExamId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile>({
    discordName: "",
    steamLink: "",
    isAdult: null,
    discordExperience: "",
    applicationReason: "",

    characterName: "",
    birthYear: "",
    faction: "",
    socialClass: "",
    characterStory: "",
    characterGoal: ""
  });

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [questionStart, setQuestionStart] = useState<number | null>(null);

  const [tabSwitches, setTabSwitches] = useState(0);
  const [fastAnswers, setFastAnswers] = useState<number[]>([]);
  const [copyPasteBlocks, setCopyPasteBlocks] = useState(0);
  const [rightClickBlocks, setRightClickBlocks] = useState(0);
  const [tabSwitchDetails, setTabSwitchDetails] = useState<{ at: number; type: string }[]>([]);
  const [copyPasteDetails, setCopyPasteDetails] = useState<{ at: number; type: string }[]>([]);
  const [rightClickDetails, setRightClickDetails] = useState<{ at: number }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ticketLink, setTicketLink] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<Date | null>(null);

  const currentQuestion = questions[currentIndex];

  const storyWords = useMemo(() => countWords(profile.characterStory), [profile.characterStory]);
  const goalWords = useMemo(() => countWords(profile.characterGoal), [profile.characterGoal]);
  const progress = useMemo(() => {
    if (!questions.length) return 0;
    return Math.round(((currentIndex + 1) / questions.length) * 100);
  }, [currentIndex, questions.length]);
  const todayLabel = useMemo(() => formatDateValue(new Date()), []);
  const submittedLabel = useMemo(() => formatDateValue(submittedAt), [submittedAt]);

  useEffect(() => {
    fetch(`${apiUrl}/me`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        setUser(data.user);
        if (data?.user?.username) {
          setProfile((prev) => ({
            ...prev,
            discordName: data.user.username
          }));
        }
      })
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden" && phase === "exam") {
        setTabSwitches((prev) => prev + 1);
        setTabSwitchDetails((prev) => [...prev, { at: Date.now(), type: "hidden" }]);
        setBlockedOverlay(true);
        setNeedsReset(true);
      }
      if (document.visibilityState === "visible" && phase === "exam" && needsReset) {
        setTabSwitchDetails((prev) => [...prev, { at: Date.now(), type: "visible" }]);
        // When the user comes back, restart the random questions (keep profile).
        resetQuestions();
      }
    }

    function onCopyPaste(e: Event) {
      const target = e.target as HTMLElement | null;
      const allowPaste =
        target &&
        (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
        target.dataset.allowPaste === "true";

      if (allowPaste) return;
      if (phase !== "exam") return;

      e.preventDefault();
      setCopyPasteBlocks((prev) => prev + 1);
      setCopyPasteDetails((prev) => [...prev, { at: Date.now(), type: e.type }]);
    }

    function onRightClick(e: MouseEvent) {
      if (phase !== "exam") return;
      e.preventDefault();
      setRightClickBlocks((prev) => prev + 1);
      setRightClickDetails((prev) => [...prev, { at: Date.now() }]);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (phase !== "exam") return;
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      // Best-effort: prevent common navigation/devtools shortcuts during the exam.
      const blocked =
        (ctrl && (key === "w" || key === "r" || key === "l")) ||
        key === "f5" ||
        (e.altKey && (key === "arrowleft" || key === "arrowright")) ||
        (ctrl && e.shiftKey && (key === "i" || key === "j" || key === "c"));
      if (blocked) {
        e.preventDefault();
        setRightClickBlocks((prev) => prev + 1);
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("copy", onCopyPaste);
    document.addEventListener("paste", onCopyPaste);
    document.addEventListener("contextmenu", onRightClick);
    window.addEventListener("keydown", onKeyDown, { capture: true });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("copy", onCopyPaste);
      document.removeEventListener("paste", onCopyPaste);
      document.removeEventListener("contextmenu", onRightClick);
      window.removeEventListener("keydown", onKeyDown, { capture: true } as any);
    };
  }, [phase, needsReset, examId]);

  useEffect(() => {
    if (phase !== "exam") return;

    const confirmText = "Estas realizando el test. Si sales, se perdera el progreso.";

    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = confirmText;
      return confirmText;
    };

    const onPopState = () => {
      history.pushState(null, "", window.location.href);
      window.confirm(confirmText);
    };

    history.pushState(null, "", window.location.href);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", onPopState);
    };
  }, [phase]);

  function resetAll() {
    setPhase("step1");
    setExamId(null);
    setQuestions([]);
    setCurrentIndex(0);
    setAnswers([]);
    setCurrentAnswer("");
    setStatus(null);
    setStartedAt(null);
    setQuestionStart(null);
    setTabSwitches(0);
    setFastAnswers([]);
    setCopyPasteBlocks(0);
    setRightClickBlocks(0);
    setTabSwitchDetails([]);
    setCopyPasteDetails([]);
    setRightClickDetails([]);
    setTicketLink(null);
    setSubmittedAt(null);
  }

  function abandon() {
    const ok = window.confirm("Seguro que quieres abandonar el test? Se perdera el progreso.");
    if (!ok) return;
    resetAll();
    window.location.href = "/";
  }

  function validateStep1() {
    if (!profile.discordName.trim()) return "Debes indicar tu nombre de Discord.";
    if (!profile.steamLink.trim()) return "Debes indicar el link de Steam.";
    if (!/^https?:\/\//i.test(profile.steamLink.trim())) return "El link de Steam debe empezar por http/https.";
    if (!profile.steamLink.includes("steamcommunity.com")) return "El link de Steam debe ser de steamcommunity.com.";
    if (profile.isAdult === null) return "Debes indicar si eres mayor de edad.";
    if (!profile.discordExperience.trim()) return "Debes indicar tu experiencia previa.";
    if (!profile.applicationReason) return "Debes indicar el motivo de la ficha.";
    return null;
  }

  function validateStep2() {
    if (!profile.characterName.trim()) return "Debes indicar el nombre del PJ.";
    if (!profile.birthYear.trim()) return "Debes indicar la edad de nacimiento (ej: 1998).";
    const birth = Number(profile.birthYear);
    if (!Number.isFinite(birth) || birth < 1900 || birth > new Date().getFullYear()) {
      return "La edad de nacimiento debe ser un ano valido (ej: 1998).";
    }
    const age = new Date().getFullYear() - birth;
    if (age < 18) return "Tu PJ no puede ser menor de edad (minimo 18).";
    if (!profile.faction) return "Debes seleccionar una faccion.";
    if (!profile.socialClass) return "Debes seleccionar una clase social.";
    const storyWords = countWords(profile.characterStory);
    if (storyWords < 170) return `La historia debe tener minimo 170 palabras (actual: ${storyWords}).`;
    if (storyWords > 500) return `La historia no puede superar 500 palabras (actual: ${storyWords}).`;

    const goalWords = countWords(profile.characterGoal);
    if (goalWords < 140) return `El objetivo debe tener minimo 140 palabras (actual: ${goalWords}).`;
    if (goalWords > 500) return `El objetivo no puede superar 500 palabras (actual: ${goalWords}).`;
    if (looksSplitByTimeHorizon(profile.characterGoal)) {
      return "El objetivo no puede estar dividido por corto/medio/largo plazo. Escribelo como un unico objetivo bien justificado.";
    }
    if (goalLooksInvalid(profile.characterGoal)) return "El objetivo no puede ser pertenecer/crear una banda.";
    if (textsAreTooSimilar(profile.characterStory, profile.characterGoal)) {
      return "La historia y el objetivo no pueden ser el mismo contenido (ni una copia/pegado).";
    }
    return null;
  }

  async function startExam() {
    if (!apiUrl) {
      setStatus("API_URL no configurada. Revisa apps/web/.env");
      return;
    }

    const v1 = validateStep1();
    if (v1) {
      setStatus(v1);
      setPhase("step1");
      return;
    }

    const v2 = validateStep2();
    if (v2) {
      setStatus(v2);
      setPhase("step2");
      return;
    }

    const ok = window.confirm(
      "Al iniciar el examen, se activara un bloqueo de salida (aviso al abandonar) y se registraran logs anti-cheat. Continuar?"
    );
    if (!ok) return;

    // Best-effort attempt: go fullscreen to discourage tab switching.
    try {
      if (document.fullscreenEnabled && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Ignore if browser denies fullscreen.
    }

    setStatus("Iniciando examen...");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(`${apiUrl}/exam/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal
      });

      clearTimeout(timeout);

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.error === "not_enough_questions") {
          setStatus("No hay suficientes preguntas nuevas disponibles para tu cuenta.");
        } else {
          setStatus(data?.error ? `Error: ${data.error}` : "No se pudo iniciar el examen.");
        }
        return;
      }

      setExamId(data.examId);
      setQuestions(data.questions);
      setCurrentIndex(0);
      setAnswers([]);
      setCurrentAnswer("");
      setStartedAt(Date.now());
      setQuestionStart(Date.now());
      setPhase("exam");
      setBlockedOverlay(false);
      setNeedsReset(false);
      setIsResetting(false);
      setStatus(null);
    } catch (err: any) {
      clearTimeout(timeout);
      if (err?.name === "AbortError") {
        setStatus("La API no responde. Revisa http://localhost:4000/health");
      } else {
        setStatus("No se pudo conectar con la API. Revisa que este encendida en http://localhost:4000");
      }
    }
  }

  async function resetQuestions() {
    if (!apiUrl || !examId) return;
    if (isResetting) return;

    setIsResetting(true);
    setResetError(null);
    try {
      const res = await fetch(`${apiUrl}/exam/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ examId })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetError(data?.error ? `Error: ${data.error}` : "No se pudo reiniciar el examen.");
        setIsResetting(false);
        return;
      }

      setQuestions(data.questions || []);
      setCurrentIndex(0);
      setAnswers([]);
      setCurrentAnswer("");
      setQuestionStart(Date.now());
      setFastAnswers([]);
      setCopyPasteBlocks(0);
      setRightClickBlocks(0);
      setTabSwitchDetails([]);
      setCopyPasteDetails([]);
      setRightClickDetails([]);
      setNeedsReset(false);
      setIsResetting(false);
    } catch {
      setResetError("No se pudo reiniciar el examen. Revisa la API.");
      setIsResetting(false);
    }
  }

  function recordAnswer() {
    if (!currentQuestion) return answers;

    const timeMs = Date.now() - (questionStart || Date.now());
    if (timeMs < 10000) setFastAnswers((prev) => [...prev, currentQuestion.id]);

    const existing = answers.filter((a) => a.questionId !== currentQuestion.id);
    const nextAnswers = [...existing, { questionId: currentQuestion.id, answer: currentAnswer, timeMs }];
    setAnswers(nextAnswers);
    return nextAnswers;
  }

  function handleNext() {
    recordAnswer();
    setCurrentAnswer("");
    setCurrentIndex((prev) => prev + 1);
    setQuestionStart(Date.now());
  }

  function handlePrev() {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
    const prevQuestion = questions[currentIndex - 1];
    const prevAnswer = prevQuestion ? answers.find((a) => a.questionId === prevQuestion.id) : null;
    setCurrentAnswer(prevAnswer?.answer || "");
    setQuestionStart(Date.now());
  }

  async function handleSubmit() {
    if (!examId) return;
    if (isSubmitting) return;
    setIsSubmitting(true);
    setStatus("Enviando formulario...");
    const finalAnswers = recordAnswer();

    try {
      const res = await fetch(`${apiUrl}/exam/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          examId,
          profile,
          answers: finalAnswers,
          antiCheat: {
            tabSwitches,
            fastAnswers,
            copyPasteBlocks,
            rightClickBlocks,
            tabSwitchDetails,
            copyPasteDetails,
            rightClickDetails,
            startedAt,
            finishedAt: Date.now()
          }
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.error === "already_submitted") {
          setStatus("Este formulario ya fue enviado. Espera la revision del staff.");
        } else {
          setStatus(data?.error ? `Error: ${data.error}` : "No se pudo enviar el formulario.");
        }
        setIsSubmitting(false);
        return;
      }

      setPhase("done");
      setTicketLink(data?.ticketLink || null);
      setSubmittedAt(new Date());
      setExamId(null);
      setQuestions([]);
      setStatus(null);
    } catch {
      setStatus("No se pudo conectar con la API para enviar el formulario.");
      setIsSubmitting(false);
    }
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md w-full glass glow-border p-8 text-center">
          <h1 className="text-2xl font-display mb-4">Debes iniciar sesion</h1>
          <a
            href={`${apiUrl}/auth/discord`}
            className="inline-flex items-center justify-center rounded-xl bg-accent text-white font-semibold px-4 py-2 btn-soft"
          >
            Iniciar con Discord
          </a>
          <p className="text-xs text-muted mt-4">Si ya iniciaste sesion, recarga la pagina.</p>
        </div>
      </main>
    );
  }

  if (phase === "done") {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full glass glow-border p-8 text-center">
        <h1 className="text-2xl font-display mb-3 gradient-text">Whitelist enviada</h1>
        <p className="text-xs text-muted">Fecha de solicitud: {submittedLabel}</p>
        <p className="text-sm text-muted mt-2">El staff te responderá por el ticket de Discord que hemos generado para ti.</p>
        {ticketLink ? (
          <a
            href={ticketLink}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-accent text-white px-4 py-2 font-semibold transition btn-soft"
          >
            Ir al ticket de Discord
          </a>
        ) : (
          <a href="/" className="text-xs text-muted mt-4 inline-flex">
            Volver al inicio
          </a>
        )}
        <div className="mt-3">
          <a href="/" className="text-xs text-muted inline-flex">
            Volver al inicio
          </a>
        </div>
      </div>
      </main>
    );
  }

  if (phase !== "exam") {
    const stepTitle = phase === "step1" ? "Datos de cuenta" : "Personaje";
    const stepHint =
      phase === "step1"
        ? "Nombre de Discord, Steam publico, mayor de edad, y experiencia."
        : "Historia minimo 170 palabras. Objetivo minimo 140 palabras (especifico, justificado y NO banda).";

    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-10">
        <div className="max-w-2xl w-full glass glow-border p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-12 w-12 rounded-2xl bg-soft border border-line flex items-center justify-center">
              <img src="/genesis-logo.png" alt="Genesis Community" className="h-9 w-9 object-contain" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-muted uppercase tracking-[0.3em]">Genesis Community</div>
              <h1 className="text-2xl font-display gradient-text">Registro y examen</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs mb-6">
            <span className={`px-3 py-1 rounded-full border ${phase === "step1" ? "border-accent text-text" : "border-line text-muted"}`}>
              1
            </span>
            <span className={`px-3 py-1 rounded-full border ${phase === "step2" ? "border-accent text-text" : "border-line text-muted"}`}>
              2
            </span>
            <span className="px-3 py-1 rounded-full border border-line text-muted">Test</span>
          </div>
          <div className="text-xs text-muted mb-4">Fecha actual: {todayLabel}</div>

          <h2 className="text-lg font-display">{stepTitle}</h2>
          <p className="text-sm text-muted mt-2">{stepHint}</p>

          {phase === "step1" ? (
            <div className="mt-6 grid md:grid-cols-2 gap-4">
              <input
                className="w-full rounded-lg bg-surface/60 border border-line px-4 py-3 text-sm text-text"
                placeholder="Nombre de Discord (se rellena automaticamente)"
                value={profile.discordName}
                readOnly
              />
              <input
                className="w-full rounded-lg bg-surface/60 border border-line px-4 py-3 text-sm text-text"
                placeholder="Link de Steam (perfil publico)"
                value={profile.steamLink}
                onChange={(e) => setProfile({ ...profile, steamLink: e.target.value })}
                data-allow-paste="true"
              />
              <select
                className="w-full md:col-span-2 rounded-lg bg-surface/60 border border-line px-4 py-3 text-sm text-text"
                value={profile.applicationReason}
                onChange={(e) => setProfile({ ...profile, applicationReason: e.target.value as any })}
              >
                <option value="">Motivo de la ficha</option>
                <option value="primera_vez">Primera vez en Genesis</option>
                <option value="segundo_slot">Segundo slot de PJ</option>
                <option value="wipe">WIPE</option>
                <option value="ck">CK</option>
              </select>
              <div className="md:col-span-2 flex items-center justify-between gap-3 rounded-lg bg-surface/60 border border-line px-4 py-3">
                <div className="text-sm text-text">Eres mayor de edad?</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setProfile({ ...profile, isAdult: true })}
                    className={`px-3 py-1 rounded-full border ${profile.isAdult === true ? "border-accent text-text" : "border-line text-muted"}`}
                  >
                    Si
                  </button>
                  <button
                    type="button"
                    onClick={() => setProfile({ ...profile, isAdult: false })}
                    className={`px-3 py-1 rounded-full border ${profile.isAdult === false ? "border-accent text-text" : "border-line text-muted"}`}
                  >
                    No
                  </button>
                </div>
              </div>
              <textarea
                className="w-full md:col-span-2 min-h-[120px] rounded-lg bg-surface/60 border border-line px-4 py-3 text-sm text-text"
                placeholder="Experiencia previa en servidores de Discord (roleplay)"
                value={profile.discordExperience}
                onChange={(e) => setProfile({ ...profile, discordExperience: e.target.value })}
              />
            </div>
          ) : (
            <div className="mt-6 grid md:grid-cols-2 gap-4">
              <input
                className="w-full rounded-lg bg-surface/60 border border-line px-4 py-3 text-sm text-text"
                placeholder="Nombre del PJ"
                value={profile.characterName}
                onChange={(e) => setProfile({ ...profile, characterName: e.target.value })}
              />
              <input
                className="w-full rounded-lg bg-surface/60 border border-line px-4 py-3 text-sm text-text"
                placeholder="Edad de nacimiento (ej: 1998)"
                value={profile.birthYear}
                onChange={(e) => setProfile({ ...profile, birthYear: e.target.value })}
              />
              <select
                className="w-full rounded-lg bg-surface/60 border border-line px-4 py-3 text-sm text-text"
                value={profile.faction}
                onChange={(e) => setProfile({ ...profile, faction: e.target.value as Faction })}
              >
                <option value="">Faccion</option>
                {FACTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f.toUpperCase()}
                  </option>
                ))}
              </select>
              <select
                className="w-full rounded-lg bg-surface/60 border border-line px-4 py-3 text-sm text-text"
                value={profile.socialClass}
                onChange={(e) => setProfile({ ...profile, socialClass: e.target.value as SocialClass })}
              >
                <option value="">Clase social</option>
                {SOCIAL_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
              <textarea
                className="w-full md:col-span-2 min-h-[170px] rounded-lg bg-surface/60 border border-line px-4 py-3 text-sm text-text"
                placeholder="Historia del personaje (170-500 palabras)"
                value={profile.characterStory}
                onChange={(e) => setProfile({ ...profile, characterStory: e.target.value })}
              />
              <div className="md:col-span-2 flex items-center justify-end text-xs text-muted">
                <span>Palabras: {storyWords} (170-500)</span>
              </div>
              <textarea
                className="w-full md:col-span-2 min-h-[140px] rounded-lg bg-surface/60 border border-line px-4 py-3 text-sm text-text"
                placeholder="Objetivo del personaje (140-500 palabras, especifico y justificado; NO banda)"
                value={profile.characterGoal}
                onChange={(e) => setProfile({ ...profile, characterGoal: e.target.value })}
              />
              <div className="md:col-span-2 flex items-center justify-end text-xs text-muted">
                <span>Palabras: {goalWords} (140-500)</span>
              </div>
              <div className="md:col-span-2 text-xs text-muted">
                El objetivo no puede ser pertenecer a una banda ni crear una banda. Debe ser especifico y justificado con motivos y caminos.
              </div>
            </div>
          )}

          {status && (
            <div className="rounded-lg border border-line bg-soft px-4 py-2 text-xs text-text mt-6">
              {status}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3">
            <a href="/" className="text-xs text-muted">
              Volver
            </a>
            {phase === "step1" ? (
              <button
                type="button"
                onClick={() => {
                  const v = validateStep1();
                  if (v) {
                    setStatus(v);
                    return;
                  }
                  setStatus(null);
                  setPhase("step2");
                }}
                className="rounded-xl bg-accent text-white font-semibold px-5 py-2 btn-soft"
              >
                Continuar
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStatus(null);
                    setPhase("step1");
                  }}
                  className="rounded-xl border border-line text-text px-5 py-2"
                >
                  Atras
                </button>
                <button type="button" onClick={startExam} className="rounded-xl bg-accent text-white font-semibold px-5 py-2 btn-soft">
                  Empezar test
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (!currentQuestion) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md w-full glass glow-border p-8 text-center">
          <h1 className="text-2xl font-display mb-3">Cargando preguntas...</h1>
          <p className="text-muted">Si tarda demasiado, revisa la API.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 pb-28 relative overflow-hidden">
      <div className="absolute -top-32 right-0 h-64 w-64 rounded-full bg-accent/20 blur-3xl animate-float" />
      <div className="absolute -bottom-40 left-0 h-72 w-72 rounded-full bg-glow/20 blur-3xl animate-float" />
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-soft border border-line flex items-center justify-center">
              <img src="/genesis-logo.png" alt="Genesis Community" className="h-9 w-9 object-contain" />
            </div>
            <div>
              <h1 className="text-2xl font-display gradient-text">Examen de whitelist</h1>
              <p className="text-sm text-muted">
                Pregunta {currentIndex + 1} de {questions.length}
              </p>
            </div>
          </div>
          <div className="text-sm text-muted">{progress}%</div>
        </div>

        <div className="h-2 bg-line/60 rounded-full overflow-hidden mb-8">
          <div className="h-full bg-gradient-to-r from-accent via-accent2 to-neon" style={{ width: `${progress}%` }} />
        </div>

        <div className="glass glow-border p-8 animate-fadeInUp">
          <h2 className="text-xl font-display mb-4">{currentQuestion.question}</h2>

          {currentQuestion.type === "multiple" ? (
            <div className="space-y-3">
              {currentQuestion.options?.map((opt) => (
                <label
                  key={opt}
                  className="flex items-center gap-3 rounded-lg border border-line bg-surface/60 px-4 py-3 cursor-pointer hover:border-accent/60 transition"
                >
                  <input
                    type="radio"
                    name="answer"
                    className="accent-accent"
                    checked={currentAnswer === opt}
                    onChange={() => setCurrentAnswer(opt)}
                  />
                  <span className="text-text">{opt}</span>
                </label>
              ))}
            </div>
          ) : (
            <textarea
              className="w-full min-h-[170px] rounded-lg bg-ink/30 border border-line px-4 py-3 text-text"
              value={currentAnswer}
              onChange={(e) => setCurrentAnswer(e.target.value)}
              placeholder="Escribe tu respuesta"
            />
          )}

          <div className="flex items-center justify-between mt-6">
            <button
              onClick={handlePrev}
              disabled={currentIndex === 0}
              className="rounded-xl border border-line px-4 py-2 text-sm text-muted disabled:opacity-40"
            >
              Anterior
            </button>
            {currentIndex < questions.length - 1 ? (
            <button onClick={handleNext} className="rounded-xl bg-accent text-white font-semibold px-4 py-2 btn-soft">
              Siguiente
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
                className="rounded-xl bg-accent text-white font-semibold px-4 py-2 disabled:opacity-60 btn-soft"
              >
                {isSubmitting ? "Enviando formulario..." : "Enviar formulario"}
              </button>
            )}
          </div>
        </div>
      </div>

      {blockedOverlay && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center px-6">
          <div className="max-w-md w-full glass glow-border p-6">
            <h2 className="text-lg font-display">Atencion</h2>
            <p className="text-sm text-muted mt-2">
              Hemos detectado un cambio de pestana. Por seguridad, el test se reiniciara con nuevas preguntas.
            </p>
            {resetError && (
              <div className="mt-3 rounded-lg border border-line bg-ink/30 px-3 py-2 text-xs text-text">
                {resetError}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                if (needsReset) {
                  resetQuestions();
                } else {
                  setBlockedOverlay(false);
                }
              }}
              className="mt-5 w-full rounded-xl bg-accent text-white font-semibold px-4 py-2"
              disabled={isResetting}
            >
              {isResetting ? "Reiniciando..." : needsReset ? "Reiniciar preguntas" : "Continuar"}
            </button>
          </div>
        </div>
      )}

      <div className="fixed left-0 right-0 bottom-4 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="glass glow-border px-4 py-3 flex items-center justify-between">
            <div className="text-xs text-muted">
              No abandones la pestana. Cambios detectados: {tabSwitches}. Copiar/pegar bloqueado: {copyPasteBlocks}.
            </div>
            <button type="button" onClick={abandon} className="rounded-xl border border-line px-4 py-2 text-sm text-text">
              Abandonar test
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
