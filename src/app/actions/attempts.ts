"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

// --- Get available exams for student ---

export async function getStudentExams() {
  const session = await auth();
  if (!session || session.user.role !== "student")
    throw new Error("Unauthorized");

  const studentId = session.user.id;
  const schoolId = session.user.schoolId!;

  // Get classes the student is enrolled in
  const enrollments = await db.class_enrollments.findMany({
    where: { student_id: studentId },
    select: { class_id: true },
  });
  const classIds = enrollments.map((e) => e.class_id);

  // Find active exams assigned to student's classes or directly to student
  const exams = await db.exams.findMany({
    where: {
      school_id: schoolId,
      status: "active",
      deleted_at: null,
      OR: [
        { exam_assignments: { some: { class_id: { in: classIds } } } },
        { exam_assignments: { some: { student_id: studentId } } },
      ],
    },
    include: {
      subjects: { select: { name: true, code: true } },
      exam_assignments: {
        where: {
          OR: [
            { class_id: { in: classIds } },
            { student_id: studentId },
          ],
        },
        select: { id: true, token: true, class_id: true },
      },
      exam_attempts: {
        where: { student_id: studentId },
        orderBy: { attempt_number: "desc" },
        select: {
          id: true,
          attempt_number: true,
          status: true,
          started_at: true,
          submitted_at: true,
          score: true,
        },
      },
      _count: { select: { exam_questions: true } },
    },
    orderBy: { created_at: "desc" },
  });

  return exams;
}

// --- Start or resume attempt ---

const StartAttemptInput = z.object({
  examId: z.string().uuid(),
  token: z.string().optional(),
});

export async function startOrResumeAttempt(raw: unknown) {
  const session = await auth();
  if (!session || session.user.role !== "student")
    throw new Error("Unauthorized");

  const studentId = session.user.id;
  const schoolId = session.user.schoolId!;
  const data = StartAttemptInput.parse(raw);

  // Get exam
  const exam = await db.exams.findFirst({
    where: {
      id: data.examId,
      school_id: schoolId,
      status: "active",
      deleted_at: null,
    },
    include: {
      exam_questions: {
        include: {
          questions: {
            include: {
              question_options: { orderBy: { order_index: "asc" } },
            },
          },
        },
        orderBy: { order_index: "asc" },
      },
    },
  });
  if (!exam) throw new Error("Ujian tidak ditemukan atau tidak aktif");

  // Check assignment
  const enrollments = await db.class_enrollments.findMany({
    where: { student_id: studentId },
    select: { class_id: true },
  });
  const classIds = enrollments.map((e) => e.class_id);

  const assignment = await db.exam_assignments.findFirst({
    where: {
      exam_id: exam.id,
      OR: [
        { class_id: { in: classIds } },
        { student_id: studentId },
      ],
    },
  });
  if (!assignment) throw new Error("Anda tidak terdaftar untuk ujian ini");

  // Validate token if required
  if (assignment.token && assignment.token.trim() !== "") {
    if (!data.token || data.token !== assignment.token) {
      throw new Error("Token ujian tidak valid");
    }
  }

  // Check for existing in_progress attempt
  const existingAttempt = await db.exam_attempts.findFirst({
    where: {
      exam_id: exam.id,
      student_id: studentId,
      status: "in_progress",
    },
    include: {
      attempt_answers: true,
    },
  });

  if (existingAttempt) {
    // Resume — check deadline
    const deadline =
      new Date(existingAttempt.started_at).getTime() +
      exam.duration_minutes * 60_000;
    if (Date.now() >= deadline) {
      // Auto-submit expired attempt
      await db.exam_attempts.update({
        where: { id: existingAttempt.id },
        data: {
          status: "auto_submitted",
          submitted_at: new Date(),
          time_spent_seconds: exam.duration_minutes * 60,
        },
      });
      throw new Error("Waktu ujian telah habis");
    }

    return formatAttemptResponse(existingAttempt, exam);
  }

  // Check max attempts
  const attemptCount = await db.exam_attempts.count({
    where: { exam_id: exam.id, student_id: studentId },
  });
  if (attemptCount >= exam.max_attempts) {
    throw new Error("Jumlah percobaan maksimal telah tercapai");
  }

  // Create new attempt
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for") ?? headersList.get("x-real-ip") ?? null;
  const ua = headersList.get("user-agent") ?? null;

  const attempt = await db.exam_attempts.create({
    data: {
      exam_id: exam.id,
      student_id: studentId,
      attempt_number: attemptCount + 1,
      status: "in_progress",
      started_at: new Date(),
      current_index: 0,
      ip_address: ip,
      user_agent: ua,
    },
    include: {
      attempt_answers: true,
    },
  });

  return formatAttemptResponse(attempt, exam);
}

function formatAttemptResponse(
  attempt: {
    id: string;
    started_at: Date;
    current_index: number;
    attempt_answers: {
      question_id: string;
      selected_option_ids: unknown;
      is_flagged: boolean;
      essay_text: string | null;
    }[];
  },
  exam: {
    id: string;
    title: string;
    duration_minutes: number;
    shuffle_questions: boolean;
    shuffle_options: boolean;
    exam_questions: {
      id: string;
      order_index: number;
      points_override: number | unknown;
      questions: {
        id: string;
        content: string;
        type: string;
        difficulty: string;
        default_points: number | unknown;
        question_options: {
          id: string;
          label: string | null;
          content: string;
          order_index: number;
        }[];
      };
    }[];
  }
) {
  const deadline =
    new Date(attempt.started_at).getTime() +
    exam.duration_minutes * 60_000;
  const remainingMs = Math.max(0, deadline - Date.now());

  // Shuffle questions deterministically based on attempt ID
  let orderedQuestions = [...exam.exam_questions];
  if (exam.shuffle_questions) {
    orderedQuestions = seededShuffle(
      orderedQuestions,
      attempt.id
    );
  }

  // Shuffle options if enabled
  const questions = orderedQuestions.map((eq) => {
    let options = [...eq.questions.question_options];
    if (exam.shuffle_options) {
      options = seededShuffle(options, attempt.id + eq.questions.id);
    }

    // Find saved answer
    const saved = attempt.attempt_answers.find(
      (a) => a.question_id === eq.questions.id
    );

    return {
      examQuestionId: eq.id,
      questionId: eq.questions.id,
      content: eq.questions.content,
      type: eq.questions.type,
      difficulty: eq.questions.difficulty,
      points: Number(eq.points_override ?? eq.questions.default_points),
      options: options.map((o) => ({
        id: o.id,
        label: o.label,
        content: o.content,
        orderIndex: o.order_index,
      })),
      savedAnswer: saved
        ? {
            selectedOptionIds: Array.isArray(saved.selected_option_ids)
              ? (saved.selected_option_ids as string[])
              : [],
            isFlagged: saved.is_flagged,
          }
        : null,
    };
  });

  return {
    attemptId: attempt.id,
    examTitle: exam.title,
    examId: exam.id,
    durationMinutes: exam.duration_minutes,
    remainingMs,
    currentIndex: attempt.current_index,
    questions,
  };
}

// Deterministic shuffle using a simple hash
function seededShuffle<T>(arr: T[], seed: string): T[] {
  const result = [...arr];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  for (let i = result.length - 1; i > 0; i--) {
    hash = (hash * 16807 + 1) & 0x7fffffff;
    const j = hash % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// --- Save answer (auto-save) ---

const SaveAnswerInput = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
  selectedOptionIds: z.array(z.string().uuid()),
  isFlagged: z.boolean(),
});

export async function saveAnswer(raw: unknown) {
  const session = await auth();
  if (!session || session.user.role !== "student")
    throw new Error("Unauthorized");

  const data = SaveAnswerInput.parse(raw);

  // Verify attempt belongs to student and is in_progress
  const attempt = await db.exam_attempts.findFirst({
    where: {
      id: data.attemptId,
      student_id: session.user.id,
      status: "in_progress",
    },
    include: { exams: { select: { duration_minutes: true } } },
  });
  if (!attempt) throw new Error("Attempt tidak aktif");

  // Check deadline
  const deadline =
    new Date(attempt.started_at).getTime() +
    attempt.exams.duration_minutes * 60_000;
  if (Date.now() >= deadline) {
    throw new Error("Waktu ujian telah habis");
  }

  // Verify question belongs to this exam
  const examQuestion = await db.exam_questions.findFirst({
    where: { exam_id: attempt.exam_id, question_id: data.questionId },
  });
  if (!examQuestion) throw new Error("Soal tidak valid");

  // Upsert answer
  await db.attempt_answers.upsert({
    where: {
      attempt_id_question_id: {
        attempt_id: data.attemptId,
        question_id: data.questionId,
      },
    },
    update: {
      selected_option_ids: data.selectedOptionIds,
      is_flagged: data.isFlagged,
      answered_at: new Date(),
    },
    create: {
      attempt_id: data.attemptId,
      question_id: data.questionId,
      selected_option_ids: data.selectedOptionIds,
      is_flagged: data.isFlagged,
    },
  });

  return { ok: true };
}

// --- Update current index ---

export async function updateCurrentIndex(
  attemptId: string,
  index: number
) {
  const session = await auth();
  if (!session || session.user.role !== "student")
    throw new Error("Unauthorized");

  const attempt = await db.exam_attempts.findFirst({
    where: { id: attemptId, student_id: session.user.id, status: "in_progress" },
  });
  if (!attempt) throw new Error("Attempt tidak aktif");

  await db.exam_attempts.update({
    where: { id: attemptId },
    data: { current_index: index },
  });
}

// --- Submit attempt ---

export async function submitAttempt(attemptId: string) {
  const session = await auth();
  if (!session || session.user.role !== "student")
    throw new Error("Unauthorized");

  const attempt = await db.exam_attempts.findFirst({
    where: {
      id: attemptId,
      student_id: session.user.id,
      status: "in_progress",
    },
    include: { exams: { select: { duration_minutes: true } } },
  });
  if (!attempt) throw new Error("Attempt tidak aktif");

  const now = Date.now();
  const started = new Date(attempt.started_at).getTime();
  const deadline = started + attempt.exams.duration_minutes * 60_000;
  const timeSpent = Math.min(
    Math.floor((now - started) / 1000),
    attempt.exams.duration_minutes * 60
  );

  // If past deadline, mark as auto_submitted
  const status = now >= deadline ? "auto_submitted" : "submitted";

  await db.exam_attempts.update({
    where: { id: attemptId },
    data: {
      status,
      submitted_at: new Date(),
      time_spent_seconds: timeSpent,
    },
  });

  // Auto-grade objective questions
  try {
    const { gradeAttempt } = await import("./grading");
    await gradeAttempt(attemptId);
  } catch {
    // Grading failed — attempt remains submitted, admin can regrade later
  }

  revalidatePath("/ujian");
  return { ok: true, status };
}

// --- Get attempt summary (for submit confirmation) ---

export async function getAttemptSummary(attemptId: string) {
  const session = await auth();
  if (!session || session.user.role !== "student")
    throw new Error("Unauthorized");

  const attempt = await db.exam_attempts.findFirst({
    where: {
      id: attemptId,
      student_id: session.user.id,
    },
    include: {
      exams: {
        include: {
          _count: { select: { exam_questions: true } },
        },
      },
      attempt_answers: true,
    },
  });
  if (!attempt) throw new Error("Attempt tidak ditemukan");

  const totalQuestions = attempt.exams._count.exam_questions;
  const answered = attempt.attempt_answers.filter(
    (a) =>
      Array.isArray(a.selected_option_ids) &&
      (a.selected_option_ids as string[]).length > 0
  ).length;
  const flagged = attempt.attempt_answers.filter((a) => a.is_flagged).length;
  const unanswered = totalQuestions - answered;

  return {
    totalQuestions,
    answered,
    unanswered,
    flagged,
    status: attempt.status,
  };
}

export async function revalidateUjian() {
  revalidatePath("/ujian");
}
