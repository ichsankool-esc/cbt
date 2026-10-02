"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const ProctorEventInput = z.object({
  attemptId: z.string().uuid(),
  eventType: z.enum([
    "tab_blur",
    "fullscreen_exit",
    "paste",
    "focus_lost",
    "reconnect",
    "other",
  ]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function logProctorEvent(raw: unknown) {
  const session = await auth();
  if (!session || session.user.role !== "student")
    throw new Error("Unauthorized");

  const data = ProctorEventInput.parse(raw);

  // Verify attempt belongs to student and is in_progress
  const attempt = await db.exam_attempts.findFirst({
    where: {
      id: data.attemptId,
      student_id: session.user.id,
      status: "in_progress",
    },
  });
  if (!attempt) throw new Error("Attempt tidak aktif");

  await db.proctor_events.create({
    data: {
      attempt_id: data.attemptId,
      event_type: data.eventType,
      metadata: (data.metadata ?? {}) as any,
    },
  });

  // Count violations for this attempt
  const count = await db.proctor_events.count({
    where: { attempt_id: data.attemptId },
  });

  return { ok: true, violationCount: count };
}

export async function getProctorEvents(attemptId: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  if (session.user.role === "student") {
    const attempt = await db.exam_attempts.findFirst({
      where: { id: attemptId, student_id: session.user.id },
    });
    if (!attempt) throw new Error("Unauthorized");
  } else {
    const attempt = await db.exam_attempts.findFirst({
      where: { id: attemptId },
      include: { exams: { select: { school_id: true } } },
    });
    if (!attempt || attempt.exams.school_id !== session.user.schoolId!)
      throw new Error("Unauthorized");
  }

  const events = await db.proctor_events.findMany({
    where: { attempt_id: attemptId },
    orderBy: { created_at: "desc" },
  });

  const summary = {
    total: events.length,
    tab_blur: events.filter((e) => e.event_type === "tab_blur").length,
    focus_lost: events.filter((e) => e.event_type === "focus_lost").length,
    fullscreen_exit: events.filter((e) => e.event_type === "fullscreen_exit")
      .length,
    paste: events.filter((e) => e.event_type === "paste").length,
  };

  return { events, summary };
}
