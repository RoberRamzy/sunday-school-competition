import type { Language, Translate } from "./api";

export type AttemptStatus = "AWAITING_START" | "IN_PROGRESS" | "SUBMITTED" | "TIMED_OUT" | "INVALIDATED";
export type QuestionType = "MCQ" | "SORTING";
export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type Item = { id: string; text: string };
export type Question = { id: string; type: QuestionType; text: string; items: Item[]; imageUrl?: string | null };
export type Attempt = {
  id: string; competitionId: string; status: AttemptStatus; expiresAt: string | null; serverTime: string;
  index: number; total: number; question: Question | null; savedAnswer: string[] | null; revision: number;
};
export type StudentCompetition = {
  id: string; title: string; description?: string; instructions: string; opensAt: string; closesAt: string; durationMinutes: number;
  questionCount: number; status: string; attemptId: string | null; attemptStatus: AttemptStatus | null;
  leaderboardPublished: boolean;
  result: { score: number; maxScore: number; rank: number } | null;
};
export type CompetitionQuestion = Question & {
  difficulty: Difficulty; points: number; correctOrder: string[];
  sortingMode: "PARTIAL" | "EXACT"; explanation?: string; tags?: string[];
};
export type Blueprint = { type: QuestionType; difficulty: Difficulty; count: number };
export type CompetitionGrade = { gradeId: string; questionIds: string[]; blueprint: Blueprint[] };
export type StaffCompetition = {
  id: string; title: string; description?: string; instructions: string; opensAt: string; closesAt: string; durationMinutes: number;
  sharedQuestions: boolean; questions?: CompetitionQuestion[]; legacyDraftSets?: { gradeId: string; questions: CompetitionQuestion[] }[];
  canManage?: boolean;
  status: string; publishedAt: string | null; grades: CompetitionGrade[]; tiePolicy?: "SCORE_THEN_TIME" | "SCORE_ONLY";
};

export function statusText(value: string | null, t: Translate) {
  switch (value) {
    case "ACTIVE":
    case "OPEN": return t("Open", "مفتوحة");
    case "SCHEDULED":
    case "UPCOMING": return t("Upcoming", "قادمة");
    case "CLOSED": return t("Closed", "مغلقة");
    case "DRAFT": return t("Draft", "مسودة");
    case "ARCHIVED": return t("Archived", "مؤرشفة");
    case "AWAITING_START": return t("Replacement ready", "المحاولة البديلة جاهزة");
    case "IN_PROGRESS": return t("In progress", "قيد التنفيذ");
    case "SUBMITTED": return t("Submitted", "تم التسليم");
    case "TIMED_OUT": return t("Time expired", "انتهى الوقت");
    case "INVALIDATED": return t("Invalidated", "أُلغيت");
    default: return t("Not started", "لم تبدأ");
  }
}

export function questionType(value: QuestionType, t: Translate) {
  return value === "MCQ" ? t("Multiple choice", "اختيار من متعدد") : t("Sorting", "ترتيب");
}

export function difficultyText(value: Difficulty, t: Translate) {
  if (value === "EASY") return t("Easy", "سهل");
  if (value === "MEDIUM") return t("Medium", "متوسط");
  return t("Hard", "صعب");
}

export function displayDate(value: string | null | undefined, language: Language) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
