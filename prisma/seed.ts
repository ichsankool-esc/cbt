import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeonHttp } from "@prisma/adapter-neon";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaNeonHttp(connectionString, {});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding demo data...\n");
  const salt = await bcrypt.genSalt(10);

  // ===== 1. SCHOOL =====
  const school = await prisma.schools.upsert({
    where: { npsn: "20100001" },
    update: { name: "SMK Demo", address: "Jl. Contoh No. 1, Jakarta" },
    create: {
      name: "SMK Demo",
      npsn: "20100001",
      address: "Jl. Contoh No. 1, Jakarta",
      timezone: "Asia/Jakarta",
    },
  });
  console.log("School:", school.name);

  // ===== 2. ACADEMIC YEAR + SEMESTER =====
  const academicYear = await prisma.academic_years.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: { is_active: true },
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      school_id: school.id,
      name: "2025/2026",
      is_active: true,
    },
  });

  const semester = await prisma.semesters.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: { is_active: true },
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      academic_year_id: academicYear.id,
      name: "Ganjil",
      is_active: true,
    },
  });
  console.log("Academic Year:", academicYear.name, "-", semester.name);

  // ===== 3. SUBJECTS =====
  const subjects = await Promise.all([
    prisma.subjects.upsert({
      where: { school_id_code: { school_id: school.id, code: "MTK" } },
      update: { name: "Matematika" },
      create: { school_id: school.id, code: "MTK", name: "Matematika" },
    }),
    prisma.subjects.upsert({
      where: { school_id_code: { school_id: school.id, code: "IPA" } },
      update: { name: "Ilmu Pengetahuan Alam" },
      create: { school_id: school.id, code: "IPA", name: "Ilmu Pengetahuan Alam" },
    }),
  ]);
  console.log("Subjects:", subjects.map((s) => s.name).join(", "));

  // ===== 4. USERS =====
  // Admin
  const admin = await prisma.users.upsert({
    where: { school_id_username: { school_id: school.id, username: "admin" } },
    update: { password_hash: await bcrypt.hash("admin123", salt), status: "active" },
    create: {
      school_id: school.id,
      full_name: "Administrator",
      username: "admin",
      password_hash: await bcrypt.hash("admin123", salt),
      role: "admin",
      status: "active",
    },
  });
  console.log("  admin / admin123");

  // Teacher
  const teacher = await prisma.users.upsert({
    where: { school_id_username: { school_id: school.id, username: "guru" } },
    update: { password_hash: await bcrypt.hash("guru123", salt), status: "active" },
    create: {
      school_id: school.id,
      full_name: "Budi Santoso",
      username: "guru",
      password_hash: await bcrypt.hash("guru123", salt),
      role: "teacher",
      status: "active",
    },
  });
  await prisma.teacher_profiles.upsert({
    where: { user_id: teacher.id },
    update: {},
    create: { user_id: teacher.id, nip: "198501012010011001", position: "Guru Matematika" },
  });
  console.log("  guru / guru123");

  // Students
  const studentData = [
    { username: "siswa1", name: "Andi Pratama", nis: "2025001", nisn: "0012345678", gender: "L" },
    { username: "siswa2", name: "Siti Nurhaliza", nis: "2025002", nisn: "0012345679", gender: "P" },
    { username: "siswa3", name: "Dewi Lestari", nis: "2025003", nisn: "0012345680", gender: "P" },
    { username: "siswa4", name: "Rizky Aditya", nis: "2025004", nisn: "0012345681", gender: "L" },
    { username: "siswa5", name: "Putri Amelia", nis: "2025005", nisn: "0012345682", gender: "P" },
  ];

  const students = [];
  for (const sd of studentData) {
    const u = await prisma.users.upsert({
      where: { school_id_username: { school_id: school.id, username: sd.username } },
      update: { password_hash: await bcrypt.hash("siswa123", salt), status: "active" },
      create: {
        school_id: school.id,
        full_name: sd.name,
        username: sd.username,
        password_hash: await bcrypt.hash("siswa123", salt),
        role: "student",
        status: "active",
      },
    });
    await prisma.student_profiles.upsert({
      where: { user_id: u.id },
      update: {},
      create: { user_id: u.id, nis: sd.nis, nisn: sd.nisn, gender: sd.gender, entry_year: 2025 },
    });
    students.push(u);
    console.log(`  ${sd.username} / siswa123`);
  }

  // ===== 5. CLASS + ENROLLMENT =====
  const cls = await prisma.classes.upsert({
    where: { id: "00000000-0000-0000-0000-000000000003" },
    update: { homeroom_teacher_id: teacher.id },
    create: {
      id: "00000000-0000-0000-0000-000000000003",
      school_id: school.id,
      academic_year_id: academicYear.id,
      name: "XII RPL 1",
      grade_level: 12,
      homeroom_teacher_id: teacher.id,
    },
  });

  for (const s of students) {
    await prisma.class_enrollments.upsert({
      where: { class_id_student_id: { class_id: cls.id, student_id: s.id } },
      update: {},
      create: { class_id: cls.id, student_id: s.id, academic_year_id: academicYear.id },
    });
  }
  console.log("Class:", cls.name, "(", students.length, "students)");

  // ===== 6. QUESTION BANK + QUESTIONS =====
  // Delete existing bank if any
  const existingBank = await prisma.question_banks.findFirst({
    where: { school_id: school.id, name: "Bank Soal Matematika XII" },
  });
  if (existingBank) {
    await prisma.question_options.deleteMany({
      where: { questions: { question_bank_id: existingBank.id } },
    });
    await prisma.questions.deleteMany({ where: { question_bank_id: existingBank.id } });
    await prisma.question_banks.delete({ where: { id: existingBank.id } });
  }

  const bank = await prisma.question_banks.create({
    data: {
      school_id: school.id,
      subject_id: subjects[0].id,
      owner_teacher_id: teacher.id,
      name: "Bank Soal Matematika XII",
      description: "Bank soal matematika untuk ujian kelas XII",
    },
  });

  const questionsData = [
    {
      content: "Hasil dari 2 + 3 x 4 adalah...",
      options: [
        { label: "A", content: "14", is_correct: true },
        { label: "B", content: "20", is_correct: false },
        { label: "C", content: "24", is_correct: false },
        { label: "D", content: "12", is_correct: false },
      ],
    },
    {
      content: "Nilai dari akar 49 adalah...",
      options: [
        { label: "A", content: "6", is_correct: false },
        { label: "B", content: "7", is_correct: true },
        { label: "C", content: "8", is_correct: false },
        { label: "D", content: "49", is_correct: false },
      ],
    },
    {
      content: "Jika x + 5 = 12, maka nilai x adalah...",
      options: [
        { label: "A", content: "5", is_correct: false },
        { label: "B", content: "6", is_correct: false },
        { label: "C", content: "7", is_correct: true },
        { label: "D", content: "17", is_correct: false },
      ],
    },
    {
      content: "Luas lingkaran dengan jari-jari 7 cm adalah... (pi = 22/7)",
      options: [
        { label: "A", content: "154 cm2", is_correct: true },
        { label: "B", content: "144 cm2", is_correct: false },
        { label: "C", content: "44 cm2", is_correct: false },
        { label: "D", content: "88 cm2", is_correct: false },
      ],
    },
    {
      content: "Hasil dari 15% dari 200 adalah...",
      options: [
        { label: "A", content: "25", is_correct: false },
        { label: "B", content: "30", is_correct: true },
        { label: "C", content: "35", is_correct: false },
        { label: "D", content: "20", is_correct: false },
      ],
    },
    {
      content: "Keliling persegi dengan sisi 8 cm adalah...",
      options: [
        { label: "A", content: "16 cm", is_correct: false },
        { label: "B", content: "32 cm", is_correct: true },
        { label: "C", content: "64 cm", is_correct: false },
        { label: "D", content: "24 cm", is_correct: false },
      ],
    },
    {
      content: "Hasil dari (-3) x (-4) adalah...",
      options: [
        { label: "A", content: "-12", is_correct: false },
        { label: "B", content: "12", is_correct: true },
        { label: "C", content: "-7", is_correct: false },
        { label: "D", content: "7", is_correct: false },
      ],
    },
    {
      content: "Nilai dari 2 pangkat 5 adalah...",
      options: [
        { label: "A", content: "16", is_correct: false },
        { label: "B", content: "32", is_correct: true },
        { label: "C", content: "64", is_correct: false },
        { label: "D", content: "10", is_correct: false },
      ],
    },
    {
      content: "Jika sebuah dadu dilempar, peluang muncul angka genap adalah...",
      options: [
        { label: "A", content: "1/6", is_correct: false },
        { label: "B", content: "1/3", is_correct: false },
        { label: "C", content: "1/2", is_correct: true },
        { label: "D", content: "2/3", is_correct: false },
      ],
    },
    {
      content: "Hasil dari 3/4 + 1/2 adalah...",
      options: [
        { label: "A", content: "4/6", is_correct: false },
        { label: "B", content: "5/4", is_correct: true },
        { label: "C", content: "1", is_correct: false },
        { label: "D", content: "4/4", is_correct: false },
      ],
    },
  ];

  const questions = [];
  for (const q of questionsData) {
    const question = await prisma.questions.create({
      data: {
        question_bank_id: bank.id,
        subject_id: subjects[0].id,
        type: "single_choice",
        difficulty: "medium",
        content: q.content,
        default_points: 10,
        status: "published",
        created_by: teacher.id,
        question_options: {
          create: q.options.map((o, i) => ({
            label: o.label,
            content: o.content,
            is_correct: o.is_correct,
            order_index: i,
          })),
        },
      },
    });
    questions.push(question);
  }
  console.log("Question Bank:", bank.name, "(", questions.length, "questions)");

  // ===== 7. EXAM =====
  // Delete existing exam if any
  const existingExam = await prisma.exams.findFirst({
    where: { school_id: school.id, title: "UTS Demo" },
  });
  if (existingExam) {
    await prisma.attempt_answers.deleteMany({
      where: { attempt_id: { in: (await prisma.exam_attempts.findMany({ where: { exam_id: existingExam.id }, select: { id: true } })).map((a) => a.id) } },
    });
    await prisma.proctor_events.deleteMany({
      where: { attempt_id: { in: (await prisma.exam_attempts.findMany({ where: { exam_id: existingExam.id }, select: { id: true } })).map((a) => a.id) } },
    });
    await prisma.exam_results.deleteMany({ where: { exam_id: existingExam.id } });
    await prisma.exam_attempts.deleteMany({ where: { exam_id: existingExam.id } });
    await prisma.exam_assignments.deleteMany({ where: { exam_id: existingExam.id } });
    await prisma.exam_questions.deleteMany({ where: { exam_id: existingExam.id } });
    await prisma.exams.delete({ where: { id: existingExam.id } });
  }

  const exam = await prisma.exams.create({
    data: {
      school_id: school.id,
      subject_id: subjects[0].id,
      semester_id: semester.id,
      created_by: teacher.id,
      title: "UTS Demo",
      description: "Ujian Tengah Semester Matematika Kelas XII",
      exam_type: "uts",
      duration_minutes: 30,
      total_points: questions.length * 10,
      passing_score: 60,
      max_attempts: 1,
      shuffle_questions: true,
      shuffle_options: true,
      show_result_immediately: true,
      status: "active",
    },
  });

  for (let i = 0; i < questions.length; i++) {
    await prisma.exam_questions.create({
      data: {
        exam_id: exam.id,
        question_id: questions[i].id,
        order_index: i,
        points_override: 10,
      },
    });
  }

  const token = randomBytes(6).toString("hex").toUpperCase();
  await prisma.exam_assignments.create({
    data: { exam_id: exam.id, class_id: cls.id, token },
  });
  console.log("Exam:", exam.title, "| Token:", token, "| Status: active");

  // ===== 8. SAMPLE GRADED ATTEMPTS (for demo rekap) =====
  // Fetch questions with options for creating sample attempts
  const questionsWithOptions = await prisma.questions.findMany({
    where: { question_bank_id: bank.id, deleted_at: null },
    include: { question_options: true },
  });

  const sampleStudents = students.slice(1); // siswa2-5
  for (let i = 0; i < sampleStudents.length; i++) {
    const student = sampleStudents[i];
    let totalScore = 0;
    const totalMax = questionsWithOptions.length * 10;

    const attempt = await prisma.exam_attempts.create({
      data: {
        exam_id: exam.id,
        student_id: student.id,
        attempt_number: 1,
        status: "graded",
        started_at: new Date(Date.now() - 25 * 60 * 1000),
        submitted_at: new Date(Date.now() - 5 * 60 * 1000),
        time_spent_seconds: 1200 + i * 120,
        score: 0,
        total_points: totalMax,
      },
    });

    for (const q of questionsWithOptions) {
      const correctOpt = q.question_options.find((o) => o.is_correct);
      const wrongOpt = q.question_options.find((o) => !o.is_correct);
      const isCorrect = Math.random() > 0.25 + i * 0.12;
      const selectedId = isCorrect ? correctOpt?.id : wrongOpt?.id;
      const points = isCorrect ? 10 : 0;
      if (isCorrect) totalScore += points;

      await prisma.attempt_answers.create({
        data: {
          attempt_id: attempt.id,
          question_id: q.id,
          selected_option_ids: selectedId ? [selectedId] : [],
          is_correct: isCorrect,
          points_awarded: points,
        },
      });
    }

    await prisma.exam_attempts.update({
      where: { id: attempt.id },
      data: { score: totalScore },
    });

    const normalized = Math.round((totalScore / totalMax) * 100);
    const grade = normalized >= 85 ? "A" : normalized >= 75 ? "B" : normalized >= 65 ? "C" : normalized >= 50 ? "D" : "E";

    await prisma.exam_results.create({
      data: {
        exam_id: exam.id,
        student_id: student.id,
        attempt_id: attempt.id,
        score: totalScore,
        grade: `${normalized} (${grade})`,
        is_published: true,
        graded_at: new Date(),
      },
    });
  }

  // Recalculate ranks
  const allResults = await prisma.exam_results.findMany({
    where: { exam_id: exam.id },
    orderBy: { score: "desc" },
  });
  for (let i = 0; i < allResults.length; i++) {
    await prisma.exam_results.update({
      where: { id: allResults[i].id },
      data: { rank: i + 1 },
    });
  }

  console.log("\nDemo data ready.");
  console.log("========================");
  console.log("Accounts:");
  console.log("  admin / admin123");
  console.log("  guru  / guru123");
  console.log("  siswa1 / siswa123 (belum mengerjakan)");
  console.log("  siswa2-5 / siswa123 (sudah graded)");
  console.log("Exam Token:", token);
  console.log("========================");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
