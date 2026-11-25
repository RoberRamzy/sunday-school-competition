"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, errorText, json, type Grade, type Language, type Principal, type Translate } from "../api";
import { displayDate, statusText, type Attempt, type StudentCompetition } from "../competition";
import { Icon } from "./ui-icon";
import { useQuietQuiz } from "./christmas-effects";

type SaveOperation = { questionId: string; itemIds: string[]; advance: boolean; revision: number };

function completed(competition: StudentCompetition) {
  return competition.attemptStatus === "SUBMITTED" || competition.attemptStatus === "TIMED_OUT";
}

export function Student({ principal, language, t, competitionId }: {
  principal: Principal; language: Language; t: Translate; competitionId?: string;
}) {
  const router = useRouter();
  const [competitions, setCompetitions] = useState<StudentCompetition[] | null>(null);
  const [grade, setGrade] = useState("");
  const [selected, setSelected] = useState<StudentCompetition | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [overallPublic, setOverallPublic] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      if (competitionId) setSelected(await api<StudentCompetition>(`/student/competitions/${competitionId}`));
      else setCompetitions(await api<StudentCompetition[]>("/student/competitions"));
    } catch (error) {
      setError(error);
    }
  }, [competitionId]);

  useEffect(() => {
    void refresh();
    const controller = new AbortController();
    api<Grade[]>("/auth/grades", { signal: controller.signal }).then((grades) => {
      setGrade(grades.find((item) => item.id === principal.gradeId)?.name ?? "");
    }).catch(() => {});
    if (!competitionId) api<{ published: boolean }>("/leaderboards/all/visibility", { signal: controller.signal })
      .then(({ published }) => setOverallPublic(published)).catch(() => {});
    return () => controller.abort();
  }, [competitionId, principal.gradeId, refresh]);

  async function open(competition: StudentCompetition) {
    setBusy(true);
    setError(null);
    try {
      if (competition.attemptId && competition.attemptStatus === "IN_PROGRESS") {
        setAttempt(await api<Attempt>(`/student/attempts/${competition.attemptId}`));
      } else {
        setSelected(await api<StudentCompetition>(`/student/competitions/${competition.id}`));
      }
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      setAttempt(await api<Attempt>(`/competitions/${selected.id}/start`, json("POST")));
      setSelected(null);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  if (attempt) return <Quiz key={attempt.id} firstState={attempt} t={t} language={language} onExit={() => {
    if (competitionId) router.push("/");
    else { setAttempt(null); void refresh(); }
  }}/>;

  return <main id="main-content" className="student-shell student-competitions">
    <div className="student-heading">
      <h1>{t("My competitions", "مسابقاتي")}</h1>
      <span className="student-season-decoration" aria-hidden="true">
        <Icon name="evergreen" size={35}/>
        <span className="season-lights"><i/><i/><i/><i/><i/><i/><i/></span>
      </span>
    </div>
    <p className="subtle">{t("Welcome,", "مرحبًا،")} <bdi>{principal.displayName}</bdi>{grade && <> · <bdi>{grade}</bdi></>}</p>
    {!competitionId && overallPublic && <Link className="link-button" href="/leaderboards/all" prefetch={false}>{t("Across-competition leaderboard", "لوحة ترتيب جميع المسابقات")}</Link>}
    {error ? <p className="notice error section-description" role="alert">{errorText(error, t)}{" "}{competitions === null && <button className="link-button" type="button" onClick={refresh}>{t("Try again", "حاول مجددًا")}</button>}</p> : null}
    {selected ? <section className="panel student-detail">
      <div className="card-heading"><h2 dir="auto">{selected.title}</h2><span className="status">{statusText(selected.attemptStatus ?? selected.status, t)}</span></div>
      <CompetitionDates competition={selected} language={language} t={t}/>
      {selected.description && <p dir="auto">{selected.description}</p>}
      <p className="preserve-lines" dir="auto">{selected.instructions}</p>
      {selected.status === "ACTIVE" && !completed(selected) && selected.attemptStatus !== "IN_PROGRESS" && <p className="subtle">{t("You have one attempt. When you go to the next question, your previous answer is locked. Your attempt ends at the time limit or when the competition closes, whichever comes first.", "لديك محاولة واحدة. عند الانتقال إلى السؤال التالي يُقفل جوابك السابق. تنتهي المحاولة عند انتهاء الوقت المحدد أو إغلاق المسابقة، أيهما أقرب.")}</p>}
      <CompetitionResult competition={selected} t={t}/>
      <div className="record-actions">
        {selected.attemptStatus === "IN_PROGRESS" ? <button type="button" className="button primary" onClick={() => open(selected)} disabled={busy}>{t("Continue attempt", "متابعة المحاولة")}</button>
          : selected.status === "ACTIVE" && !completed(selected) && <button type="button" className="button primary" onClick={start} disabled={busy}>{t("Confirm and start", "تأكيد وبدء")}</button>}
        {competitionId ? <Link className="button" href="/">{t("Back to competitions", "العودة إلى المسابقات")}</Link>
          : <button type="button" className="button" disabled={busy} onClick={() => setSelected(null)}>{t("Back to competitions", "العودة إلى المسابقات")}</button>}
      </div>
    </section>
    : competitionId ? error ? <Link className="button" href="/">{t("Back to competitions", "العودة إلى المسابقات")}</Link>
      : <p role="status" className="panel">{t("Loading competition…", "جارٍ تحميل المسابقة…")}</p>
    : competitions === null ? !error && <p role="status" className="panel">{t("Loading competitions…", "جارٍ تحميل المسابقات…")}</p>
    : competitions.length === 0 ? <p className="panel subtle">{t("There are no competitions for your grade yet.", "لا توجد مسابقات لصفك بعد.")}</p>
    : <div className="competition-list">{competitions.map((competition) => {
      const inProgress = competition.attemptStatus === "IN_PROGRESS";
      const canStart = competition.status === "ACTIVE";
      return <article className="panel competition-card" key={competition.id}>
        <div className="card-heading"><h2 dir="auto">{competition.title}</h2><span className="status" data-status={canStart ? "ACTIVE" : competition.status}>{statusText(competition.attemptStatus ?? competition.status, t)}</span></div>
        {competition.description && <p className="subtle" dir="auto">{competition.description}</p>}
        <CompetitionDates competition={competition} language={language} t={t}/>
        <CompetitionResult competition={competition} t={t}/>
        {(inProgress || (canStart && !completed(competition))) && <div><button type="button" className="button primary" disabled={busy} onClick={() => open(competition)}>{inProgress ? t("Continue attempt", "متابعة المحاولة") : t("View instructions", "عرض التعليمات")}<span className="directional"><Icon name="arrow" size={17}/></span></button></div>}
      </article>;
    })}</div>}
  </main>;
}

function CompetitionResult({ competition, t }: { competition: StudentCompetition; t: Translate }) {
  return <>
    {competition.result ? <p className="notice success">{t(`Score ${competition.result.score} / ${competition.result.maxScore} · Rank ${competition.result.rank}`, `النتيجة ${competition.result.score} / ${competition.result.maxScore} · الترتيب ${competition.result.rank}`)}</p>
      : completed(competition) && <p className="note">{t("Results will appear here when they are published.", "ستظهر النتائج هنا بعد نشرها.")}</p>}
    {completed(competition) && competition.leaderboardPublished && <div><Link className="link-button" href={`/leaderboards/${competition.id}`} prefetch={false}>{t("Competition leaderboard", "لوحة ترتيب المسابقة")}</Link></div>}
  </>;
}

function CompetitionDates({ competition, language, t }: { competition: StudentCompetition; language: Language; t: Translate }) {
  return <div className="competition-facts">
    <span><Icon name="calendar" size={17}/>{t("Opens", "تبدأ")} <bdi>{displayDate(competition.opensAt, language)}</bdi></span>
    <span><Icon name="calendar" size={17}/>{t("Closes", "تنتهي")} <bdi>{displayDate(competition.closesAt, language)}</bdi></span>
    <span><Icon name="clock" size={17}/>{t(`${competition.durationMinutes} min · ${competition.questionCount} questions`, `${competition.durationMinutes} دقيقة · ${competition.questionCount} سؤال`)}</span>
  </div>;
}

function answerIds(state: Attempt): string[] {
  return state.savedAnswer ?? (state.question?.type === "SORTING" ? state.question.items.map(({ id }) => id) : []);
}

function secondsLeft(state: Attempt) {
  return state.expiresAt ? Math.max(0, Math.ceil((Date.parse(state.expiresAt) - Date.parse(state.serverTime)) / 1000)) : 0;
}

function Quiz({ firstState, t, language, onExit }: {
  firstState: Attempt; t: Translate; language: Language; onExit: () => void;
}) {
  const [attempt, setAttempt] = useState(firstState);
  const [selected, setSelected] = useState(() => answerIds(firstState));
  const [remaining, setRemaining] = useState(() => secondsLeft(firstState));
  const [sync, setSync] = useState<"idle" | "saving" | "saved" | "pending">("idle");
  const [offline, setOffline] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const request = useRef(false);
  const pending = useRef<SaveOperation | null>(null);
  const deadline = useRef(performance.now() + (firstState.expiresAt ? Date.parse(firstState.expiresAt) - Date.parse(firstState.serverTime) : 0));
  const heading = useRef<HTMLHeadingElement>(null);
  const dragged = useRef<string | null>(null);
  const question = attempt.question;
  useQuietQuiz(attempt.status === "IN_PROGRESS");

  const adopt = useCallback((next: Attempt) => {
    setAttempt(next);
    setSelected(answerIds(next));
    setRemaining(secondsLeft(next));
    deadline.current = performance.now() + (next.expiresAt ? Date.parse(next.expiresAt) - Date.parse(next.serverTime) : 0);
    if (next.status !== "IN_PROGRESS") setConfirm(false);
  }, []);

  const reconcile = useCallback(async () => {
    if (request.current) return;
    request.current = true;
    try {
      const next = await api<Attempt>(`/attempts/${firstState.id}/status`);
      adopt(next);
      if (pending.current && (
        next.status !== "IN_PROGRESS" || next.question?.id !== pending.current.questionId || next.revision >= pending.current.revision
      )) pending.current = null;
      if (pending.current) {
        setSelected(pending.current.itemIds);
        setSync("pending");
      } else {
        setSync(next.savedAnswer ? "saved" : "idle");
      }
      setOffline(false);
      setError(null);
    } catch (error) {
      setError(error);
    } finally {
      request.current = false;
    }
  }, [adopt, firstState.id]);

  const send = useCallback(async (operation: SaveOperation) => {
    if (request.current) return;
    request.current = true;
    pending.current = operation;
    let stale = false;
    setSync("saving");
    setError(null);
    try {
      const next = await api<Attempt>(`/attempts/${firstState.id}/answers`, json("POST", operation));
      pending.current = null;
      adopt(next);
      setSync(next.savedAnswer ? "saved" : "idle");
      setOffline(false);
    } catch (error) {
      setError(error);
      if (error instanceof ApiError && error.status === 409) {
        stale = true;
        pending.current = null;
        setSync("pending");
      } else {
        setSync("pending");
      }
    } finally {
      request.current = false;
    }
    if (stale) await reconcile();
  }, [adopt, firstState.id, reconcile]);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const disconnect = () => setOffline(true);
    const reconnect = async () => {
      await reconcile();
      if (pending.current) await send(pending.current);
    };
    const focus = () => { if (document.visibilityState === "visible") void reconnect(); };
    window.addEventListener("offline", disconnect);
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.removeEventListener("offline", disconnect);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [reconcile, send]);

  useEffect(() => {
    if (attempt.status !== "IN_PROGRESS") return;
    let lastCheck = 0;
    const interval = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
      setRemaining(next);
      if (next === 0 && performance.now() - lastCheck > 2500) {
        lastCheck = performance.now();
        void reconcile();
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [attempt.status, reconcile]);

  useEffect(() => { heading.current?.focus(); }, [attempt.index, attempt.status]);

  function answer(ids: string[], advance = false) {
    if (!question || pending.current || request.current || remaining <= 0) return;
    setSelected(ids);
    void send({ questionId: question.id, itemIds: ids, advance, revision: (attempt.revision ?? 0) + 1 });
  }

  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= selected.length) return;
    const next = [...selected];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    answer(next);
  }

  async function submit() {
    if (request.current || pending.current || remaining <= 0) return;
    request.current = true;
    setSync("saving");
    setError(null);
    try {
      adopt(await api<Attempt>(`/attempts/${attempt.id}/submit`, json("POST")));
      setSync("idle");
    } catch (error) {
      setSync("idle");
      setError(error);
    } finally {
      request.current = false;
    }
  }

  const timer = `${Math.floor(remaining / 60).toString().padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`;
  const disabled = offline || sync === "saving" || sync === "pending" || remaining === 0;
  const final = attempt.index + 1 >= attempt.total;

  if (attempt.status !== "IN_PROGRESS") return <main id="main-content" className="student-shell quiz-shell">
    <section className="panel quiz-panel">
      <h1 tabIndex={-1} ref={heading}>{statusText(attempt.status, t)}</h1>
      <p className="subtle">{attempt.status === "TIMED_OUT"
        ? t("Time is up. Your saved answers were submitted automatically.", "انتهى الوقت. تم تسليم إجاباتك المحفوظة تلقائيًا.")
        : t("Return to your competitions to check for published results.", "ارجع إلى مسابقاتك للاطلاع على النتائج بعد نشرها.")}</p>
      <button className="button primary" type="button" onClick={onExit}>{t("Back to competitions", "العودة إلى المسابقات")}</button>
    </section>
  </main>;

  return <main id="main-content" className="student-shell quiz-shell">
    <div className="quiz-top">
      <div><strong><span className="season-star"><Icon name="star" size={17}/></span>{question ? t(`Question ${attempt.index + 1} of ${attempt.total}`, `السؤال ${attempt.index + 1} من ${attempt.total}`) : t("Ready to submit", "جاهزة للتسليم")}</strong>
        <progress value={Math.min(attempt.index + 1, attempt.total)} max={attempt.total}/></div>
      <div className="quiz-clock" data-low={remaining <= 60 || undefined}><Icon name="clock" size={19}/><span aria-label={t("Time remaining", "الوقت المتبقي")}><bdi>{timer}</bdi></span></div>
    </div>
    <section className="panel quiz-panel">
      <h1 ref={heading} tabIndex={-1} dir="auto">{question?.text ?? t("Submit your attempt", "سلّم محاولتك")}</h1>
      {question?.imageUrl && <img className="question-image" src={question.imageUrl} alt={t("Illustration for this question", "صورة توضيحية لهذا السؤال")} referrerPolicy="no-referrer" />}
      {question?.type === "MCQ" && <fieldset className="quiz-options" disabled={disabled || confirm}>
        <legend>{t("Choose one answer.", "اختر إجابة واحدة.")}</legend>
        {question.items.map((item) => <label key={item.id}><input type="radio" checked={selected[0] === item.id} name="answer" onChange={() => answer([item.id])}/><span dir="auto">{item.text}</span></label>)}
      </fieldset>}
      {question?.type === "SORTING" && <>
        <p className="subtle">{t("Use the arrows or drag the items into the correct order.", "استخدم الأسهم أو اسحب العناصر إلى ترتيبها الصحيح.")}</p>
        <ol className="sorting-list">
          {selected.map((id, index) => {
            const item = question.items.find((candidate) => candidate.id === id);
            if (!item) return null;
            return <li key={id} draggable={!disabled && !confirm} onDragStart={(event) => {
              dragged.current = id;
              event.dataTransfer.setData("text/plain", id);
              event.dataTransfer.effectAllowed = "move";
            }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
              event.preventDefault();
              if (!disabled && !confirm && dragged.current) move(selected.indexOf(dragged.current), index);
              dragged.current = null;
            }}>
              <span className="sort-position">{index + 1}</span><span dir="auto">{item.text}</span>
              <div className="sort-moves">
                <button type="button" className="button" disabled={disabled || confirm || index === 0} aria-label={t(`Move ${item.text} up`, `حرّك ${item.text} لأعلى`)} onClick={() => move(index, index - 1)}><Icon name="up" size={17}/></button>
                <button type="button" className="button" disabled={disabled || confirm || index === selected.length - 1} aria-label={t(`Move ${item.text} down`, `حرّك ${item.text} لأسفل`)} onClick={() => move(index, index + 1)}><Icon name="down" size={17}/></button>
              </div>
            </li>;
          })}
        </ol>
      </>}
      {remaining > 0 && remaining <= 60 && <p className="timer-warning" role="status">{t("Less than one minute remaining.", "تبقى أقل من دقيقة.")}</p>}
      <p className="note" role="status">{offline ? t("You’re offline. Keep this tab open to reconnect.", "الاتصال منقطع. أبقِ هذه الصفحة مفتوحة لإعادة الاتصال.")
        : remaining === 0 ? t("Checking the deadline with the server…", "جارٍ التحقق من انتهاء الوقت…")
        : sync === "saving" ? t("Saving…", "جارٍ الحفظ…")
        : sync === "pending" ? t("Answer waiting to save.", "الإجابة بانتظار الحفظ.")
        : attempt.savedAnswer ? t("Answer saved.", "تم حفظ الإجابة.") : t("No answer saved yet.", "لم تُحفظ إجابة بعد.")}</p>
      {error ? <p className="notice error" role="alert">{errorText(error, t)}{" "}
        <button className="link-button" type="button" disabled={sync === "saving" || offline} onClick={() => {
          if (pending.current && remaining > 0) void send(pending.current);
          else void reconcile();
        }}>{t("Retry", "إعادة المحاولة")}</button>
      </p> : null}
      {confirm ? <div className="submit-confirm">
        <p>{t("Submit your attempt? Your answers will be final.", "هل تريد تسليم محاولتك؟ ستصبح إجاباتك نهائية.")}</p>
        <div className="record-actions">
          <button className="button primary" type="button" disabled={disabled} onClick={submit}>{t("Confirm submission", "تأكيد التسليم")}</button>
          <button className="button" type="button" disabled={sync === "saving"} onClick={() => setConfirm(false)}>{t("Keep working", "متابعة الإجابة")}</button>
        </div>
      </div> : <div className="record-actions">
        {!final && question && <button className="button primary" type="button" disabled={disabled} onClick={() => answer(attempt.savedAnswer ?? [], true)}>{attempt.savedAnswer ? t("Next question", "السؤال التالي") : t("Skip and continue", "تخطي ومتابعة")}<span className="directional"><Icon name="arrow" size={17}/></span></button>}
        <button className={final ? "button primary" : "button"} type="button" disabled={disabled} onClick={() => setConfirm(true)}>{t("Submit attempt", "تسليم المحاولة")}</button>
        <button className="button" type="button" disabled={sync === "saving" || sync === "pending"} onClick={onExit}>{t("Back to competitions", "العودة إلى المسابقات")}</button>
      </div>}
      {attempt.expiresAt && <p className="note">{t("Your deadline", "موعد انتهائك")} <bdi>{displayDate(attempt.expiresAt, language)}</bdi></p>}
    </section>
  </main>;
}
