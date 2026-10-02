"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { revalidatePath } from "next/cache";

const emptyToUndef = z
  .string()
  .transform((v) => (v === "" ? undefined : v));

const BankInput = z.object({
  name: z.string().min(1, "Nama wajib diisi"),
  subjectId: emptyToUndef.pipe(z.string().uuid()).optional(),
  description: z.string().optional(),
});

export async function createQuestionBank(raw: unknown) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const data = BankInput.parse(raw);

  return db.question_banks.create({
    data: {
      school_id: session.user.schoolId!,
      owner_teacher_id: session.user.id,
      subject_id: data.subjectId ?? null,
      name: data.name,
      description: data.description ?? null,
    },
  });
}

export async function updateQuestionBank(id: string, raw: unknown) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const data = BankInput.parse(raw);

  const existing = await db.question_banks.findFirst({
    where: { id, school_id: session.user.schoolId! },
  });
  if (!existing) throw new Error("Not found");

  return db.question_banks.update({
    where: { id },
    data: {
      name: data.name,
      subject_id: data.subjectId ?? null,
      description: data.description ?? null,
    },
  });
}

export async function deleteQuestionBank(id: string) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const existing = await db.question_banks.findFirst({
    where: { id, school_id: session.user.schoolId! },
  });
  if (!existing) throw new Error("Not found");

  return db.question_banks.delete({ where: { id } });
}

export async function getQuestionBanks() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  return db.question_banks.findMany({
    where: { school_id: session.user.schoolId! },
    include: {
      subjects: { select: { name: true, code: true } },
      users: { select: { full_name: true } },
      _count: { select: { questions: { where: { deleted_at: null } } } },
    },
    orderBy: { created_at: "desc" },
  });
}

export async function getQuestionBank(id: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const bank = await db.question_banks.findFirst({
    where: { id, school_id: session.user.schoolId! },
    include: {
      subjects: { select: { name: true, code: true } },
      users: { select: { full_name: true } },
    },
  });
  if (!bank) throw new Error("Not found");

  return bank;
}

export async function revalidateBanks() {
  revalidatePath("/admin/bank-soal");
}
