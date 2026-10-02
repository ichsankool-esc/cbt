"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

// --- Core grading engine ---

function isAnswerCorrect(
  type: string,
  selected: string[],
  correctIds: string[]
): boolean {
  const sel = new Set(selected);
  const cor = new Set(correctIds);

  if (type === "single_choice" || type === "true_false") {
    return sel.size === 1 && cor.has([...sel][0]);
  }
  if (type === "multiple_answer") {
    return sel.size === cor.size && [...cor].every((id) => sel.has(id));
  }
  // essay / matching — skip auto-grading
  return false;
}

export async function gradeAttempt(attemptId: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  // Students can only grade their own; admins can grade any in their school
  const attempt = await db.exam_attempts.findFirst({
    where: { id: attemptId },
    include: {
      exams: {
        include: {
          exam_questions: {
            include: {
              questions: {
                include: {
                  question_options: true,
                },
              },
            },
          },
        },
      },
      attempt_answers: true,
    },
  });

  if (!attempt) throw new Error("Attempt tidak ditemukan");

  // Verify ownership
  if (session.user.role === "student") {
    if (attempt.student_id !== session.user.id)
      throw new Error("Unauthorized");
  } else {
    // Admin must be in same school
    const exam = await db.exams.findFirst({
      where: { id: attempt.exam_id, school_id: session.user.schoolId! },
    });
    if (!exam) throw new Error("Unauthorized");
  }

  // Only grade submitted attempts
  if (attempt.status !== "submitted" && attempt.status !== "auto_submitted") {
    if (attempt.status === "graded") {
      // Re-grade: recalculate
    } else {
      throw new Error("Attempt belum disubmit");
    }
  }

  // Build question → correct option IDs map
  const questionMap = new Map<
    string,
    {
      type: string;
      correctOptionIds: string[];
      maxPoints: number;
    }
  >();

  for (const eq of attempt.exams.exam_questions) {
    const correctIds = eq.questions.question_options
      .filter((o) => o.is_correct)
      .map((o) => o.id);

    questionMap.set(eq.questions.id, {
      type: eq.questions.type,
      correctOptionIds: correctIds,
      maxPoints: Number(eq.points_override ?? eq.questions.default_points),
    });
  }

  // Grade each answer
  let totalScore = 0;
  let totalMaxPoints = 0;

  for (const [questionId, qInfo] of questionMap) {
    totalMaxPoints += qInfo.maxPoints;

    const answer = attempt.attempt_answers.find(
      (a) => a.question_id === questionId
    );

    if (!answer) {
      // Unanswered
      continue;
    }

    const selected = Array.isArray(answer.selected_option_ids)
      ? (answer.selected_option_ids as string[])
      : [];

    if (selected.length === 0) {
      // Not answered
      await db.attempt_answers.update({
        where: { id: answer.id },
        data: { is_correct: false, points_awarded: 0 },
      });
      continue;
    }

    // Skip essay/matching for auto-grading
    if (qInfo.type === "essay" || qInfo.type === "matching") {
      // Mark as needing manual grading
      await db.attempt_answers.update({
        where: { id: answer.id },
        data: { is_correct: null, points_awarded: null },
      });
      continue;
    }

    const correct = isAnswerCorrect(
      qInfo.type,
      selected,
      qInfo.correctOptionIds
    );
    const points = correct ? qInfo.maxPoints : 0;

    if (correct) totalScore += points;

    await db.attempt_answers.update({
      where: { id: answer.id },
      data: { is_correct: correct, points_awarded: points },
    });
  }

  // Update attempt
  await db.exam_attempts.update({
    where: { id: attemptId },
    data: {
      status: "graded",
      score: totalScore,
      total_points: totalMaxPoints,
    },
  });

  // Calculate normalized score (0-100)
  const normalizedScore =
    totalMaxPoints > 0 ? Math.round((totalScore / totalMaxPoints) * 100) : 0;

  // Determine grade
  const grade = calculateGrade(normalizedScore);

  // Upsert exam_result
  const exam = attempt.exams;
  await db.exam_results.upsert({
    where: {
      exam_id_student_id: {
        exam_id: attempt.exam_id,
        student_id: attempt.student_id,
      },
    },
    update: {
      score: totalScore,
      grade: `${normalizedScore} (${grade})`,
      attempt_id: attemptId,
      graded_at: new Date(),
    },
    create: {
      exam_id: attempt.exam_id,
      student_id: attempt.student_id,
      attempt_id: attemptId,
      score: totalScore,
      grade: `${normalizedScore} (${grade})`,
      is_published: exam.show_result_immediately,
      graded_at: new Date(),
    },
  });

  // Recalculate ranks for this exam
  await recalculateRanks(attempt.exam_id);

  revalidatePath("/ujian");
  revalidatePath("/admin/ujian");

  return {
    score: totalScore,
    totalPoints: totalMaxPoints,
    normalizedScore,
    grade,
  };
}

function calculateGrade(score: number): string {
  if (score >= 85) return "A";
  if (score >= 75) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "E";
}

async function recalculateRanks(examId: string) {
  const results = await db.exam_results.findMany({
    where: { exam_id: examId },
    orderBy: { score: "desc" },
  });

  for (let i = 0; i < results.length; i++) {
    await db.exam_results.update({
      where: { id: results[i].id },
      data: { rank: i + 1 },
    });
  }
}

// --- Admin: regrade ---

export async function regradeExam(examId: string) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const exam = await db.exams.findFirst({
    where: { id: examId, school_id: session.user.schoolId!, deleted_at: null },
  });
  if (!exam) throw new Error("Not found");

  // Get all submitted attempts for this exam
  const attempts = await db.exam_attempts.findMany({
    where: {
      exam_id: examId,
      status: { in: ["submitted", "auto_submitted", "graded"] },
    },
    select: { id: true },
  });

  for (const attempt of attempts) {
    await gradeAttempt(attempt.id);
  }

  revalidatePath(`/admin/ujian/${examId}/hasil`);
  return { graded: attempts.length };
}

// --- Admin: publish/unpublish ---

export async function togglePublishResults(
  examId: string,
  published: boolean
) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const exam = await db.exams.findFirst({
    where: { id: examId, school_id: session.user.schoolId!, deleted_at: null },
  });
  if (!exam) throw new Error("Not found");

  await db.exam_results.updateMany({
    where: { exam_id: examId },
    data: { is_published: published },
  });

  revalidatePath(`/admin/ujian/${examId}/hasil`);
}

// --- Get results ---

export async function getExamResults(examId: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  // Verify exam ownership
  const exam = await db.exams.findFirst({
    where: { id: examId, deleted_at: null },
  });
  if (!exam) throw new Error("Not found");

  // Admin checks school_id; student checks their own result
  if (session.user.role === "student") {
    const result = await db.exam_results.findFirst({
      where: { exam_id: examId, student_id: session.user.id },
      include: {
        exam_attempts: {
          select: {
            id: true,
            status: true,
            started_at: true,
            submitted_at: true,
            time_spent_seconds: true,
          },
        },
      },
    });
    return { exam, results: result ? [result] : [], stats: null };
  }

  // Admin: get all results
  if (exam.school_id !== session.user.schoolId!) throw new Error("Unauthorized");

  const results = await db.exam_results.findMany({
    where: { exam_id: examId },
    include: {
      users_exam_results_student_idTousers: {
        select: {
          id: true,
          full_name: true,
          student_profiles: { select: { nis: true, nisn: true } },
        },
      },
      exam_attempts: {
        select: {
          id: true,
          status: true,
          started_at: true,
          submitted_at: true,
          time_spent_seconds: true,
          total_points: true,
        },
      },
    },
    orderBy: { rank: "asc" },
  });

  // Stats
  const scores = results.map((r) => Number(r.score ?? 0));
  const normalizedScores = results.map((r) => {
    const max = Number(r.exam_attempts?.total_points ?? 1);
    return max > 0 ? Math.round((Number(r.score ?? 0) / max) * 100) : 0;
  });

  const stats = {
    total: results.length,
    average:
      normalizedScores.length > 0
        ? Math.round(
            normalizedScores.reduce((a, b) => a + b, 0) /
              normalizedScores.length
          )
        : 0,
    highest: normalizedScores.length > 0 ? Math.max(...normalizedScores) : 0,
    lowest: normalizedScores.length > 0 ? Math.min(...normalizedScores) : 0,
    passing: normalizedScores.filter((s) => {
      const ps = exam.passing_score ? Number(exam.passing_score) : null;
      return ps !== null ? s >= ps : true;
    }).length,
  };

  return { exam, results, stats };
}

// --- Get student's result for specific exam ---

export async function getStudentExamResult(examId: string) {
  const session = await auth();
  if (!session || session.user.role !== "student")
    throw new Error("Unauthorized");

  const exam = await db.exams.findFirst({
    where: { id: examId, school_id: session.user.schoolId!, deleted_at: null },
  });
  if (!exam) throw new Error("Not found");

  const result = await db.exam_results.findFirst({
    where: { exam_id: examId, student_id: session.user.id },
    include: {
      exam_attempts: true,
    },
  });

  if (!result) return { exam, result: null };

  // Check if results should be shown
  if (!exam.show_result_immediately && !result.is_published) {
    return {
      exam,
      result: { ...result, hidden: true },
    };
  }

  return { exam, result: { ...result, hidden: false } };
}

// --- Get attempt detail for review ---

export async function getAttemptReview(attemptId: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const attempt = await db.exam_attempts.findFirst({
    where: { id: attemptId },
    include: {
      exams: {
        include: {
          exam_questions: {
            include: {
              questions: {
                include: {
                  question_options: true,
                },
              },
            },
            orderBy: { order_index: "asc" },
          },
        },
      },
      attempt_answers: true,
    },
  });

  if (!attempt) throw new Error("Not found");

  // Verify access
  if (session.user.role === "student") {
    if (attempt.student_id !== session.user.id)
      throw new Error("Unauthorized");
    // Check if results are published
    const result = await db.exam_results.findFirst({
      where: {
        exam_id: attempt.exam_id,
        student_id: session.user.id,
      },
    });
    if (!result?.is_published && !attempt.exams.show_result_immediately) {
      throw new Error("Hasil belum dipublikasikan");
    }
  } else {
    const exam = await db.exams.findFirst({
      where: {
        id: attempt.exam_id,
        school_id: session.user.schoolId!,
      },
    });
    if (!exam) throw new Error("Unauthorized");
  }

  // Build review data
  const questions = attempt.exams.exam_questions.map((eq) => {
    const answer = attempt.attempt_answers.find(
      (a) => a.question_id === eq.questions.id
    );
    const correctOptions = eq.questions.question_options.filter(
      (o) => o.is_correct
    );

    return {
      questionId: eq.questions.id,
      content: eq.questions.content,
      type: eq.questions.type,
      points: Number(eq.points_override ?? eq.questions.default_points),
      options: eq.questions.question_options.map((o) => ({
        id: o.id,
        label: o.label,
        content: o.content,
        isCorrect: o.is_correct,
      })),
      answer: answer
        ? {
            selectedOptionIds: Array.isArray(answer.selected_option_ids)
              ? (answer.selected_option_ids as string[])
              : [],
            isCorrect: answer.is_correct,
            pointsAwarded: Number(answer.points_awarded ?? 0),
            explanation: eq.questions.explanation,
          }
        : null,
    };
  });

  return {
    attemptId: attempt.id,
    examTitle: attempt.exams.title,
    status: attempt.status,
    score: Number(attempt.score ?? 0),
    totalPoints: Number(attempt.total_points ?? 0),
    startedAt: attempt.started_at,
    submittedAt: attempt.submitted_at,
    timeSpentSeconds: attempt.time_spent_seconds,
    questions,
  };
}
