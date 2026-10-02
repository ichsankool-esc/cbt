"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { revalidatePath } from "next/cache";

const SubjectInput = z.object({
  code: z.string().min(1, "Kode wajib diisi").max(20),
  name: z.string().min(1, "Nama wajib diisi").max(100),
});

export async function createSubject(raw: unknown) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const data = SubjectInput.parse(raw);

  return db.subjects.create({
    data: {
      school_id: session.user.schoolId!,
      code: data.code,
      name: data.name,
    },
  });
}

export async function updateSubject(id: string, raw: unknown) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const data = SubjectInput.parse(raw);

  // Verify ownership
  const existing = await db.subjects.findFirst({
    where: { id, school_id: session.user.schoolId! },
  });
  if (!existing) throw new Error("Not found");

  return db.subjects.update({
    where: { id },
    data: { code: data.code, name: data.name },
  });
}

export async function deleteSubject(id: string) {
  const session = await auth();
  if (
    !session ||
    !["admin", "teacher", "superadmin"].includes(session.user.role)
  )
    throw new Error("Unauthorized");

  const existing = await db.subjects.findFirst({
    where: { id, school_id: session.user.schoolId! },
  });
  if (!existing) throw new Error("Not found");

  return db.subjects.delete({ where: { id } });
}

export async function getSubjects() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  return db.subjects.findMany({
    where: { school_id: session.user.schoolId! },
    orderBy: { name: "asc" },
  });
}

export async function revalidateSubjects() {
  revalidatePath("/admin/mata-pelajaran");
}
