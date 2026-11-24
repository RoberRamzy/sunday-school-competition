"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, errorText, json, type Grade, type Translate } from "../api";
import { difficultyText, questionType, type BankQuestion, type Difficulty, type QuestionType } from "../competition";
import { Icon } from "./ui-icon";

export const questionTypes = ["MCQ", "SORTING"] as const;
export const difficulties = ["EASY", "MEDIUM", "HARD"] as const;

export function QuestionBank({ t }: { t: Translate }) {
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [gradeId, setGradeId] = useState("");
  const [filterType, setFilterType] = useState<QuestionType | "">("");
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [tag, setTag] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<BankQuestion | "new" | null>(null);
  const [archiving, setArchiving] = useState<BankQuestion | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [rows, gradeRows] = await Promise.all([api<BankQuestion[]>("/admin/questions"), api<Grade[]>("/admin/grades")]);
      setQuestions(rows);
      setGrades(gradeRows);
      setGradeId((current) => gradeRows.some((grade) => grade.id === current) ? current : gradeRows[0]?.id || "");
      setError(null);
    } catch (error) {
      setError(error);
    } finally {
      setReady(true);
    }
  }
  useEffect(() => { void load(); }, []);

  async function archive() {
    if (!archiving) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/questions/${archiving.id}`, { method: "DELETE" });
      setArchiving(null);
      await load();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  const visible = questions.filter((question) =>
    question.gradeId === gradeId && (includeArchived || !question.archived) &&
    (!filterType || question.type === filterType) && (!difficulty || question.difficulty === difficulty) &&
    (!tag.trim() || question.tags?.some((value) => value.toLowerCase().includes(tag.trim().toLowerCase()))));
  return <section>
    <h1>{t("Question bank", "بنك الأسئلة")}</h1>
    <p className="section-description subtle">{t("Manage multiple-choice and sorting questions by grade.", "أدر أسئلة الاختيار من متعدد والترتيب حسب الصف.")}</p>
    {error ? <p role="alert" className="notice error">{errorText(error, t)}{" "}<button type="button" className="link-button" onClick={load}>{t("Reload", "إعادة التحميل")}</button></p> : null}
    {!ready ? <p role="status">{t("Loading questions…", "جارٍ تحميل الأسئلة…")}</p> : <>
      <div className="filter-row">
        <label>{t("Grade", "الصف الدراسي")}<select value={gradeId} disabled={busy || !!editing} onChange={(event) => { setGradeId(event.target.value); setArchiving(null); }}>
          {grades.length === 0 && <option value="">{t("No grades", "لا توجد صفوف")}</option>}
          {grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}
        </select></label>
        <label>{t("Type", "النوع")}<select value={filterType} onChange={(event) => setFilterType(event.target.value as QuestionType | "")}>
          <option value="">{t("All types", "كل الأنواع")}</option>
          {questionTypes.map((type) => <option key={type} value={type}>{questionType(type, t)}</option>)}
        </select></label>
        <label>{t("Difficulty", "الصعوبة")}<select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty | "")}>
          <option value="">{t("All difficulty levels", "كل مستويات الصعوبة")}</option>
          {difficulties.map((value) => <option key={value} value={value}>{difficultyText(value, t)}</option>)}
        </select></label>
        <label>{t("Search tags", "البحث في الوسوم")}<input type="search" value={tag} onChange={(event) => setTag(event.target.value)}/></label>
        <button className="button primary" disabled={busy || !gradeId} type="button" onClick={() => { setArchiving(null); setEditing("new"); }}><Icon name="plus" size={18}/>{t("Add question", "إضافة سؤال")}</button>
      </div>
      <label className="field-check"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)}/>{t("Include archived", "إظهار المؤرشفة")}</label>
      {editing && <QuestionEditor key={editing === "new" ? "new" : editing.id} question={editing === "new" ? null : editing} gradeId={gradeId} t={t} onCancel={() => setEditing(null)} onSave={() => { setEditing(null); void load(); }}/>}
      {archiving && <div className="panel form-stack">
        <h2>{t("Archive this question?", "أرشفة هذا السؤال؟")}</h2>
        <p className="subtle">{t("It will be removed from draft question choices. Existing frozen competitions retain it.", "لن يظهر ضمن خيارات المسودات. تحتفظ به المسابقات المثبتة بالفعل.")}</p>
        <div className="record-actions">
          <button className="button primary" type="button" disabled={busy} onClick={archive}>{t("Confirm archive", "تأكيد الأرشفة")}</button>
          <button className="button" type="button" disabled={busy} onClick={() => setArchiving(null)}>{t("Cancel", "إلغاء")}</button>
        </div>
      </div>}
      {visible.length ? <div className="table-wrap panel-table" role="region" tabIndex={0} aria-label={t("Questions", "الأسئلة")}>
        <table className="roster-table data-table">
          <thead><tr><th scope="col">{t("Question", "السؤال")}</th><th scope="col">{t("Type", "النوع")}</th><th scope="col">{t("Difficulty", "الصعوبة")}</th><th scope="col">{t("Points", "النقاط")}</th><th scope="col">{t("Actions", "الإجراءات")}</th></tr></thead>
          <tbody>{visible.map((question) => <tr key={question.id}>
            <td dir="auto">{question.text}{question.archived && <small className="status question-archived">{t("Archived", "مؤرشف")}</small>}</td>
            <td>{questionType(question.type, t)}</td><td>{difficultyText(question.difficulty, t)}</td><td>{question.points}</td>
            <td><div className="record-actions">
              <button className="link-button" type="button" disabled={busy} onClick={() => { setEditing(question); setArchiving(null); }}>{question.archived ? t("View", "عرض") : t("Edit", "تعديل")}</button>
              {!question.archived && <button className="link-button" type="button" disabled={busy} onClick={() => { setEditing(null); setArchiving(question); }}>{t("Archive", "أرشفة")}</button>}
            </div></td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="panel subtle">{t("No questions match these filters.", "لا توجد أسئلة مطابقة للمرشحات.")}</p>}
    </>}
  </section>;
}

function QuestionEditor({ question, gradeId, t, onSave, onCancel }: {
  question: BankQuestion | null; gradeId: string; t: Translate; onSave: () => void; onCancel: () => void;
}) {
  const [type, setType] = useState<QuestionType>(question?.type ?? "MCQ");
  const [items, setItems] = useState(() => {
    if (!question) return [{ id: crypto.randomUUID(), text: "" }, { id: crypto.randomUUID(), text: "" }];
    if (question.type === "SORTING") return question.correctOrder.flatMap((id) => question.items.filter((item) => item.id === id));
    return question.items;
  });
  const [correct, setCorrect] = useState(question?.correctOrder[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const readOnly = question?.archived === true;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api(question ? `/admin/questions/${question.id}` : "/admin/questions", json(question ? "PATCH" : "POST", {
        gradeId,
        type,
        difficulty: form.get("difficulty"),
        text: String(form.get("text")).trim(),
        points: Number(form.get("points")),
        explanation: String(form.get("explanation")).trim(),
        imageUrl: String(form.get("imageUrl")).trim() || null,
        tags: [...new Set(String(form.get("tags")).split(/[,،]/).map((tag) => tag.trim()).filter(Boolean))],
        items: items.map((item) => ({ ...item, text: item.text.trim() })),
        correctOrder: type === "MCQ" ? [correct] : items.map(({ id }) => id),
        sortingMode: type === "SORTING" ? form.get("sortingMode") : "PARTIAL",
      }));
      onSave();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, to: number) {
    const next = [...items];
    [next[index], next[to]] = [next[to], next[index]];
    setItems(next);
  }

  return <form className="panel form-stack" onSubmit={submit}>
    <h2>{readOnly ? t("Archived question", "سؤال مؤرشف") : question ? t("Edit question", "تعديل السؤال") : t("Add question", "إضافة سؤال")}</h2>
    <fieldset className="form-stack" disabled={busy || readOnly}>
      <label>{t("Question text", "نص السؤال")}<textarea required name="text" rows={3} maxLength={4000} defaultValue={question?.text} dir="auto"/></label>
      <div className="form-grid">
        <label>{t("Type", "النوع")}<select value={type} onChange={(event) => setType(event.target.value as QuestionType)}>{questionTypes.map((type) => <option value={type} key={type}>{questionType(type, t)}</option>)}</select></label>
        <label>{t("Difficulty", "الصعوبة")}<select name="difficulty" defaultValue={question?.difficulty ?? "MEDIUM"}>{difficulties.map((value) => <option key={value} value={value}>{difficultyText(value, t)}</option>)}</select></label>
        <label>{t("Points", "النقاط")}<input name="points" type="number" min={1} max={1000} step={1} required defaultValue={question?.points ?? 1}/></label>
        {type === "SORTING" && <label>{t("Scoring", "احتساب الدرجات")}<select name="sortingMode" defaultValue={question?.sortingMode ?? "PARTIAL"}><option value="PARTIAL">{t("Points per correct position", "نقاط لكل موضع صحيح")}</option><option value="EXACT">{t("Exact order only", "الترتيب المطابق فقط")}</option></select></label>}
      </div>
      <details className="question-details">
        <summary>{t("Image, explanation, and tags", "الصورة والشرح والوسوم")}</summary>
        <div className="form-stack">
          <label>{t("Image URL (HTTPS)", "رابط الصورة (HTTPS)")}<input name="imageUrl" type="url" pattern="https://.+" dir="ltr" defaultValue={question?.imageUrl ?? ""}/></label>
          <label>{t("Explanation for staff", "شرح للخدام")}<textarea name="explanation" rows={2} maxLength={4000} defaultValue={question?.explanation ?? ""} dir="auto"/></label>
          <label>{t("Tags separated by commas", "الوسوم مفصولة بفواصل")}<input name="tags" defaultValue={question?.tags?.join(", ") ?? ""} dir="auto"/></label>
        </div>
      </details>
      <fieldset className="form-stack">
        <legend>{type === "MCQ" ? t("Answer choices", "خيارات الإجابة") : t("Items in correct order", "العناصر بالترتيب الصحيح")}</legend>
        <p className="note">{type === "MCQ" ? t("Select the radio button beside the correct choice.", "حدد زر الاختيار بجوار الإجابة الصحيحة.") : t("Students will see these items in a different order.", "سيرى الطلاب العناصر بترتيب مختلف.")}</p>
        {items.map((item, index) => <div className="bank-item" key={item.id}>
          {type === "MCQ" ? <label className="check-box"><input type="radio" aria-label={t(`Choice ${index + 1} is correct`, `الخيار ${index + 1} صحيح`)} name="correct" required checked={correct === item.id} onChange={() => setCorrect(item.id)}/></label> : <span className="sort-position">{index + 1}</span>}
          <input aria-label={t(`Answer item ${index + 1}`, `العنصر ${index + 1}`)} required maxLength={4000} dir="auto" value={item.text} onChange={(event) => {
            setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, text: event.target.value } : candidate));
          }}/>
          {type === "SORTING" && <div className="sort-moves">
            <button className="button" type="button" disabled={index === 0} aria-label={t(`Move item ${index + 1} up`, `حرّك العنصر ${index + 1} لأعلى`)} onClick={() => move(index, index - 1)}><Icon name="up" size={17}/></button>
            <button className="button" type="button" disabled={index === items.length - 1} aria-label={t(`Move item ${index + 1} down`, `حرّك العنصر ${index + 1} لأسفل`)} onClick={() => move(index, index + 1)}><Icon name="down" size={17}/></button>
          </div>}
          {!readOnly && items.length > 2 && <button className="link-button" type="button" aria-label={t(`Remove item ${index + 1}`, `احذف العنصر ${index + 1}`)} onClick={() => { setItems((current) => current.filter(({ id }) => id !== item.id)); if (correct === item.id) setCorrect(""); }}>{t("Remove", "حذف")}</button>}
        </div>)}
        {!readOnly && <div><button className="button" type="button" disabled={items.length >= 30} onClick={() => setItems((current) => [...current, { id: crypto.randomUUID(), text: "" }])}><Icon name="plus" size={17}/>{t("Add item", "إضافة عنصر")}</button></div>}
      </fieldset>
    </fieldset>
    {error ? <p role="alert" className="notice error">{errorText(error, t)}</p> : null}
    <div className="record-actions">
      {!readOnly && <button className="button primary" disabled={busy}>{t("Save question", "حفظ السؤال")}</button>}
      <button className="button" type="button" disabled={busy} onClick={onCancel}>{readOnly ? t("Close preview", "إغلاق المعاينة") : t("Cancel", "إلغاء")}</button>
    </div>
  </form>;
}
