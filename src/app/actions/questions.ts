"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { revalidatePath } from "next/cache";

const OptionInput = z.object({
  label: z.string().min(1),
  content: z.string().min(1, "Isi opsi wajib diisi"),
  is_correct: z.boolean(),
  order_index: z.number().int().min(0),
});

const QuestionInput = z.object({
  content: z.string().min(1, "Teks soal wajib diisi"),
  type: z.enum(["single_choice", "multiple_answer", "true_false"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  default_points: z.number().min(0.5),
  explanation: z.string().optional(),
  status: z.enum(["draft", "published"]),
  options: z
    .array(OptionInput)
    .min(2, "Minimal 2 opsi jawaban"),
});

function validateOptionsByType(
  type: string,
  options: z.infer<typeof OptionInput>[]
) {
  const correctCount = options.filter((o) => o.is_correct).length;

  if (correctCount < 1) {
    throw new Error("Minimal 1 opsi harus ditandai benar");
  }

  if (type === "single_choice" || type === "true_false") {
    if (correctCount !== 1) {
      throw new Error("Tipe ini harus tepat 1 opsi benar");
    }
  }
}

export async function createQuestion(
  bankId: string,
  raw: unknown
) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  // Verify bank ownership
  const bank = await db.question_banks.findFirst({
    where: { id: bankId, school_id: session.user.schoolId! },
  });
  if (!bank) throw new Error("Bank soal tidak ditemukan");

  const data = QuestionInput.parse(raw);
  validateOptionsByType(data.type, data.options);

  return db.questions.create({
    data: {
      question_bank_id: bankId,
      subject_id: bank.subject_id,
      type: data.type,
      difficulty: data.difficulty,
      content: data.content,
      default_points: data.default_points,
      explanation: data.explanation ?? null,
      status: data.status,
      created_by: session.user.id,
      question_options: {
        create: data.options.map((o) => ({
          label: o.label,
          content: o.content,
          is_correct: o.is_correct,
          order_index: o.order_index,
        })),
      },
    },
    include: { question_options: true },
  });
}

export async function updateQuestion(
  questionId: string,
  raw: unknown
) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const data = QuestionInput.parse(raw);
  validateOptionsByType(data.type, data.options);

  // Verify ownership via bank → school
  const question = await db.questions.findFirst({
    where: { id: questionId, deleted_at: null },
    include: { question_banks: { select: { school_id: true } } },
  });
  if (!question || question.question_banks.school_id !== session.user.schoolId!)
    throw new Error("Not found");

  // Update question + replace options
  return db.questions.update({
    where: { id: questionId },
    data: {
      content: data.content,
      type: data.type,
      difficulty: data.difficulty,
      default_points: data.default_points,
      explanation: data.explanation ?? null,
      status: data.status,
      version: { increment: 1 },
      question_options: {
        deleteMany: {},
        create: data.options.map((o) => ({
          label: o.label,
          content: o.content,
          is_correct: o.is_correct,
          order_index: o.order_index,
        })),
      },
    },
    include: { question_options: true },
  });
}

export async function softDeleteQuestion(questionId: string) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const question = await db.questions.findFirst({
    where: { id: questionId, deleted_at: null },
    include: { question_banks: { select: { school_id: true } } },
  });
  if (!question || question.question_banks.school_id !== session.user.schoolId!)
    throw new Error("Not found");

  return db.questions.update({
    where: { id: questionId },
    data: { deleted_at: new Date() },
  });
}

export async function getQuestions(bankId: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  // Verify bank ownership
  const bank = await db.question_banks.findFirst({
    where: { id: bankId, school_id: session.user.schoolId! },
  });
  if (!bank) throw new Error("Not found");

  return db.questions.findMany({
    where: {
      question_bank_id: bankId,
      deleted_at: null,
    },
    include: {
      question_options: { orderBy: { order_index: "asc" } },
    },
    orderBy: { created_at: "desc" },
  });
}

export async function getQuestion(questionId: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const question = await db.questions.findFirst({
    where: { id: questionId, deleted_at: null },
    include: {
      question_options: { orderBy: { order_index: "asc" } },
      question_banks: { select: { school_id: true } },
    },
  });
  if (!question || question.question_banks.school_id !== session.user.schoolId!)
    throw new Error("Not found");

  return question;
}

export async function revalidateQuestions(bankId: string) {
  revalidatePath(`/admin/bank-soal/${bankId}`);
}
