"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";

const emptyToUndef = z
  .string()
  .transform((v) => (v === "" ? undefined : v));

const ExamInput = z.object({
  title: z.string().min(1, "Judul wajib diisi"),
  description: z.string().optional(),
  subjectId: emptyToUndef.pipe(z.string().uuid()).optional(),
  semesterId: emptyToUndef.pipe(z.string().uuid()).optional(),
  examType: z.enum(["uts", "uas", "quiz"]),
  durationMinutes: z.number().int().min(1, "Durasi minimal 1 menit"),
  passingScore: z.number().min(0).optional(),
  maxAttempts: z.number().int().min(1).default(1),
  shuffleQuestions: z.boolean().default(true),
  shuffleOptions: z.boolean().default(true),
  showResultImmediately: z.boolean().default(true),
});

export async function createExam(raw: unknown) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const data = ExamInput.parse(raw);

  return db.exams.create({
    data: {
      school_id: session.user.schoolId!,
      subject_id: data.subjectId ?? null,
      semester_id: data.semesterId ?? null,
      created_by: session.user.id,
      title: data.title,
      description: data.description ?? null,
      exam_type: data.examType,
      duration_minutes: data.durationMinutes,
      passing_score: data.passingScore ?? null,
      max_attempts: data.maxAttempts,
      shuffle_questions: data.shuffleQuestions,
      shuffle_options: data.shuffleOptions,
      show_result_immediately: data.showResultImmediately,
      status: "draft",
    },
  });
}

export async function updateExam(id: string, raw: unknown) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const data = ExamInput.parse(raw);

  const existing = await db.exams.findFirst({
    where: { id, school_id: session.user.schoolId!, deleted_at: null },
  });
  if (!existing) throw new Error("Not found");

  return db.exams.update({
    where: { id },
    data: {
      title: data.title,
      description: data.description ?? null,
      subject_id: data.subjectId ?? null,
      semester_id: data.semesterId ?? null,
      exam_type: data.examType,
      duration_minutes: data.durationMinutes,
      passing_score: data.passingScore ?? null,
      max_attempts: data.maxAttempts,
      shuffle_questions: data.shuffleQuestions,
      shuffle_options: data.shuffleOptions,
      show_result_immediately: data.showResultImmediately,
    },
  });
}

export async function deleteExam(id: string) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const existing = await db.exams.findFirst({
    where: { id, school_id: session.user.schoolId!, deleted_at: null },
  });
  if (!existing) throw new Error("Not found");

  return db.exams.update({
    where: { id },
    data: { deleted_at: new Date() },
  });
}

export async function getExams() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  return db.exams.findMany({
    where: { school_id: session.user.schoolId!, deleted_at: null },
    include: {
      subjects: { select: { name: true, code: true } },
      _count: { select: { exam_questions: true } },
    },
    orderBy: { created_at: "desc" },
  });
}

export async function getExam(id: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const exam = await db.exams.findFirst({
    where: { id, school_id: session.user.schoolId!, deleted_at: null },
    include: {
      subjects: { select: { name: true, code: true } },
      semesters: { select: { name: true } },
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
      exam_assignments: {
        include: {
          classes: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!exam) throw new Error("Not found");

  return exam;
}

// --- Exam Questions ---

export async function addQuestionToExam(
  examId: string,
  questionId: string,
  pointsOverride?: number
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
  if (!exam) throw new Error("Ujian tidak ditemukan");

  // Get current max order_index
  const maxOrder = await db.exam_questions.aggregate({
    where: { exam_id: examId },
    _max: { order_index: true },
  });
  const nextOrder = (maxOrder._max.order_index ?? -1) + 1;

  // Get question default points if no override
  let points = pointsOverride;
  if (points === undefined) {
    const question = await db.questions.findUnique({
      where: { id: questionId },
      select: { default_points: true },
    });
    points = question ? Number(question.default_points) : 1;
  }

  await db.exam_questions.create({
    data: {
      exam_id: examId,
      question_id: questionId,
      order_index: nextOrder,
      points_override: points,
    },
  });

  // Update total_points
  await recalculateTotalPoints(examId);

  revalidatePath(`/admin/ujian/${examId}`);
}

export async function removeQuestionFromExam(
  examId: string,
  examQuestionId: string
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

  await db.exam_questions.delete({ where: { id: examQuestionId } });

  await recalculateTotalPoints(examId);

  revalidatePath(`/admin/ujian/${examId}`);
}

export async function reorderExamQuestions(
  examId: string,
  orderedIds: string[]
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

  for (let i = 0; i < orderedIds.length; i++) {
    await db.exam_questions.update({
      where: { id: orderedIds[i] },
      data: { order_index: i },
    });
  }

  revalidatePath(`/admin/ujian/${examId}`);
}

async function recalculateTotalPoints(examId: string) {
  const result = await db.exam_questions.aggregate({
    where: { exam_id: examId },
    _sum: { points_override: true },
  });
  const total = Number(result._sum.points_override ?? 0);

  await db.exams.update({
    where: { id: examId },
    data: { total_points: total },
  });
}

// --- Exam Assignments ---

export async function assignExamToClass(examId: string, classId: string) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const exam = await db.exams.findFirst({
    where: { id: examId, school_id: session.user.schoolId!, deleted_at: null },
  });
  if (!exam) throw new Error("Ujian tidak ditemukan");

  const cls = await db.classes.findFirst({
    where: { id: classId, school_id: session.user.schoolId! },
  });
  if (!cls) throw new Error("Kelas tidak ditemukan");

  // Check if already assigned
  const existing = await db.exam_assignments.findFirst({
    where: { exam_id: examId, class_id: classId },
  });
  if (existing) throw new Error("Ujian sudah ditugaskan ke kelas ini");

  const token = randomBytes(6).toString("hex").toUpperCase();

  return db.exam_assignments.create({
    data: {
      exam_id: examId,
      class_id: classId,
      token,
    },
    include: { classes: { select: { name: true } } },
  });
}

export async function removeExamAssignment(assignmentId: string) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  return db.exam_assignments.delete({ where: { id: assignmentId } });
}

export async function getClasses() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  return db.classes.findMany({
    where: { school_id: session.user.schoolId! },
    orderBy: { name: "asc" },
  });
}

export async function getSemesters() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  return db.semesters.findMany({
    where: { academic_years: { school_id: session.user.schoolId! } },
    include: { academic_years: { select: { name: true } } },
    orderBy: { academic_years: { name: "desc" } },
  });
}

// --- Status transitions ---

export async function updateExamStatus(
  examId: string,
  status: "draft" | "scheduled" | "active" | "closed"
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

  return db.exams.update({
    where: { id: examId },
    data: { status },
  });
}

export async function revalidateExams() {
  revalidatePath("/admin/ujian");
}
