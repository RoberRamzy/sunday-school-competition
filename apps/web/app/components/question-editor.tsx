"use client";

import { useState, type FormEvent } from "react";
import type { Translate } from "../api";
import { difficultyText, questionType, type CompetitionQuestion, type Difficulty, type QuestionType } from "../competition";
import { Icon } from "./ui-icon";

const questionTypes: QuestionType[] = ["MCQ", "SORTING"];
const difficulties: Difficulty[] = ["EASY", "MEDIUM", "HARD"];

export function QuestionEditor({ question, t, onSave, onCancel }: {
  question: CompetitionQuestion | null; t: Translate;
  onSave: (question: CompetitionQuestion) => void; onCancel: () => void;
}) {
  const [type, setType] = useState<QuestionType>(question?.type ?? "MCQ");
  const [items, setItems] = useState(() => {
    if (!question) return [{ id: crypto.randomUUID(), text: "" }, { id: crypto.randomUUID(), text: "" }];
    if (question.type === "SORTING") return question.correctOrder.flatMap((id) => question.items.filter((item) => item.id === id));
    return question.items;
  });
  const [correct, setCorrect] = useState(question?.correctOrder[0] ?? "");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      id: question?.id ?? crypto.randomUUID(),
      type,
      difficulty: form.get("difficulty") as Difficulty,
      text: String(form.get("text")).trim(),
      points: Number(form.get("points")),
      explanation: String(form.get("explanation")).trim(),
      imageUrl: String(form.get("imageUrl")).trim() || null,
      tags: [...new Set(String(form.get("tags")).split(/[,،]/).map((tag) => tag.trim()).filter(Boolean))],
      items: items.map((item) => ({ ...item, text: item.text.trim() })),
      correctOrder: type === "MCQ" ? [correct] : items.map(({ id }) => id),
      sortingMode: type === "SORTING" && form.get("sortingMode") === "EXACT" ? "EXACT" : "PARTIAL",
    });
  }

  function move(index: number, to: number) {
    const next = [...items];
    [next[index], next[to]] = [next[to], next[index]];
    setItems(next);
  }

  return <form className="panel form-stack" onSubmit={submit}>
    <h2>{question ? t("Edit question", "تعديل السؤال") : t("Add question", "إضافة سؤال")}</h2>
    <fieldset className="form-stack">
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
          {items.length > 2 && <button className="link-button" type="button" aria-label={t(`Remove item ${index + 1}`, `احذف العنصر ${index + 1}`)} onClick={() => { setItems((current) => current.filter(({ id }) => id !== item.id)); if (correct === item.id) setCorrect(""); }}>{t("Remove", "حذف")}</button>}
        </div>)}
        <div><button className="button" type="button" disabled={items.length >= 30} onClick={() => setItems((current) => [...current, { id: crypto.randomUUID(), text: "" }])}><Icon name="plus" size={17}/>{t("Add item", "إضافة عنصر")}</button></div>
      </fieldset>
    </fieldset>
    <div className="record-actions">
      <button className="button primary">{t("Save question", "حفظ السؤال")}</button>
      <button className="button" type="button" onClick={onCancel}>{t("Cancel", "إلغاء")}</button>
    </div>
  </form>;
}
