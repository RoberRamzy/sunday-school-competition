"use client";

import { useState, type FormEvent } from "react";
import { api, errorText, json, type Grade, type Translate } from "../api";
import { difficultyText, questionType, type CompetitionQuestion, type StaffCompetition } from "../competition";
import { QuestionEditor } from "./question-editor";

function asLocal(value?: string) {
  if (!value) return undefined;
  const time = new Date(value);
  const local = new Date(time.getTime() - time.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function CompetitionEditor({ competition, grades, t, onSave, onCancel }: {
  competition: StaffCompetition | null; grades: Grade[]; t: Translate;
  onSave: (competition: StaffCompetition) => void; onCancel: () => void;
}) {
  const [selected, setSelected] = useState(competition?.grades.map(row => row.gradeId) ?? []);
  const [questions, setQuestions] = useState(competition?.questions ?? []);
  const [editing, setEditing] = useState<CompetitionQuestion | "new" | null>(null);
  const needsConversion = Boolean(competition?.legacyDraftSets);
  const [legacyGrade, setLegacyGrade] = useState("");
  const [converted, setConverted] = useState(!needsConversion);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  function move(index: number, to: number) {
    const next = [...questions];
    [next[index], next[to]] = [next[to], next[index]];
    setQuestions(next);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || editing || !converted) return;
    setError(null);
    setInvalid(false);
    const form = new FormData(event.currentTarget);
    const opens = new Date(String(form.get("opensAt")));
    const closes = new Date(String(form.get("closesAt")));
    if (opens >= closes || selected.length === 0) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    try {
      const data = {
        title: String(form.get("title")).trim(),
        instructions: String(form.get("instructions")).trim(),
        description: String(form.get("description")).trim(),
        tiePolicy: form.get("tiePolicy"),
        opensAt: opens.toISOString(),
        closesAt: closes.toISOString(),
        durationMinutes: Number(form.get("durationMinutes")),
        gradeIds: selected,
        questions,
      };
      const saved = await api<StaffCompetition>(competition ? `/admin/competitions/${competition.id}` : "/admin/competitions", json(competition ? "PATCH" : "POST", data));
      onSave(saved);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  return <div className="form-stack">
    <form id="competition-draft" className="panel form-stack" onSubmit={save}>
    <h2>{competition ? t("Edit draft", "تعديل المسودة") : t("Create competition", "إنشاء مسابقة")}</h2>
    <label>{t("Title", "العنوان")}<input name="title" dir="auto" defaultValue={competition?.title} disabled={busy} required maxLength={160}/></label>
    <label>{t("Description", "الوصف")}<textarea name="description" dir="auto" rows={2} maxLength={4000} defaultValue={competition?.description ?? ""} disabled={busy}/></label>
    <label>{t("Student instructions", "تعليمات الطلاب")}<textarea name="instructions" dir="auto" rows={3} maxLength={8000} defaultValue={competition?.instructions} disabled={busy}/></label>
    <div className="form-grid">
      <label>{t("Opening time", "وقت الفتح")}<input type="datetime-local" name="opensAt" defaultValue={asLocal(competition?.opensAt)} disabled={busy} required/></label>
      <label>{t("Closing time", "وقت الإغلاق")}<input type="datetime-local" name="closesAt" defaultValue={asLocal(competition?.closesAt)} disabled={busy} required/></label>
      <label>{t("Duration in minutes", "المدة بالدقائق")}<input type="number" name="durationMinutes" min="1" max="1440" defaultValue={competition?.durationMinutes ?? 30} disabled={busy} required/></label>
      <label>{t("Tie policy", "سياسة التعادل")}<select name="tiePolicy" defaultValue={competition?.tiePolicy ?? "SCORE_THEN_TIME"} disabled={busy}>
        <option value="SCORE_THEN_TIME">{t("Score, then shortest elapsed time", "النتيجة، ثم أقصر مدة")}</option>
        <option value="SCORE_ONLY">{t("Equal scores share rank", "النتائج المتساوية تشترك في الترتيب")}</option>
      </select></label>
      <p className="note">{t("Times use your device’s local time zone.", "تُعرض الأوقات بحسب المنطقة الزمنية لجهازك.")}</p>
    </div>
    <fieldset className="form-stack" disabled={busy}>
      <legend>{t("Eligible grades", "الصفوف المؤهلة")}</legend>
      <div className="grade-choices">{grades.map((grade) => <label key={grade.id} className="field-check">
        <input type="checkbox" checked={selected.includes(grade.id)} onChange={(event) => {
          const checked = event.target.checked;
          setInvalid(false);
          setSelected((current) => checked ? [...current, grade.id] : current.filter(id => id !== grade.id));
        }}/>
        <bdi>{grade.name}</bdi>
      </label>)}</div>
    </fieldset>
    </form>
    <section className="panel form-stack" aria-labelledby="draft-questions">
      <h2 id="draft-questions">{t("Questions", "الأسئلة")}</h2>
      <p className="note">{t("All eligible grades receive these questions.", "تتلقى جميع الصفوف المؤهلة هذه الأسئلة.")}</p>
      {!converted ? <div className="form-stack">
        <p>{t("Choose a previous grade set to copy into this draft.", "اختر مجموعة أسئلة صف سابق لنسخها إلى هذه المسودة.")}</p>
        <label>{t("Grade set to copy", "مجموعة الصف المراد نسخها")}<select value={legacyGrade} onChange={e => setLegacyGrade(e.target.value)}>
          <option value="">{t("Choose a grade", "اختر الصف")}</option>
          {competition?.legacyDraftSets?.map(set => <option key={set.gradeId} value={set.gradeId}>{grades.find(grade => grade.id === set.gradeId)?.name}</option>)}
        </select></label>
        <button type="button" className="button" disabled={!legacyGrade} onClick={() => {
          const source = competition?.legacyDraftSets?.find(set => set.gradeId === legacyGrade);
          if (!source) return;
          setQuestions(source.questions.map(q => ({ ...q, id: crypto.randomUUID() })));
          setConverted(true);
        }}>{t("Copy questions", "نسخ الأسئلة")}</button>
      </div> : <>
        <p>{t(`${questions.length} questions · ${questions.reduce((total, question) => total + question.points, 0)} points`,
          `${questions.length} سؤال · ${questions.reduce((total, question) => total + question.points, 0)} نقطة`)}</p>
        {questions.length > 0 && <ol className="form-stack">{questions.map((question, index) => <li key={question.id}>
          <p dir="auto"><strong>{question.text}</strong></p>
          <p className="note">{questionType(question.type, t)} · {difficultyText(question.difficulty, t)} · {question.points}</p>
          <div className="record-actions">
            <button className="button" type="button" disabled={busy || !!editing || index === 0} onClick={() => move(index, index - 1)}>{t("Move up", "حرّك لأعلى")}</button>
            <button className="button" type="button" disabled={busy || !!editing || index === questions.length - 1} onClick={() => move(index, index + 1)}>{t("Move down", "حرّك لأسفل")}</button>
            <button className="button" type="button" disabled={busy || !!editing} onClick={() => setEditing(question)}>{t("Edit", "تعديل")}</button>
            <button className="link-button" type="button" disabled={busy || !!editing} onClick={() => setQuestions(list => list.filter(row => row.id !== question.id))}>{t("Remove", "إزالة")}</button>
          </div>
        </li>)}</ol>}
        {!editing && <div><button type="button" className="button" disabled={busy || questions.length >= 100} onClick={() => setEditing("new")}>{t("Add question", "إضافة سؤال")}</button></div>}
      </>}
    </section>
    {editing && <QuestionEditor key={editing === "new" ? "new" : editing.id} t={t} question={editing === "new" ? null : editing}
      onCancel={() => setEditing(null)} onSave={question => {
        setQuestions(list => editing === "new" ? [...list, question] : list.map(row => row.id === question.id ? question : row));
        setEditing(null);
      }}/>}
    {invalid && <p className="notice error" role="alert">{t("Choose at least one grade and set an opening time before closing.", "اختر صفًا واحدًا على الأقل وحدد وقت فتح يسبق وقت الإغلاق.")}</p>}
    {error ? <p className="notice error" role="alert">{errorText(error, t)}</p> : null}
    <div className="record-actions">
      <button className="button primary" type="submit" form="competition-draft" disabled={busy || !!editing || !converted}>{busy ? t("Saving…", "جارٍ الحفظ…") : t("Save draft", "حفظ المسودة")}</button>
      <button className="button" type="button" disabled={busy} onClick={onCancel}>{t("Cancel", "إلغاء")}</button>
    </div>
  </div>;
}
