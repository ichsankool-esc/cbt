# CBT SMK

Computer-Based Test application for SMK (vocational high school).

## Demo

**URL:** `https://cbt-smk.vercel.app`

### Accounts

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | Admin |
| `guru` | `guru123` | Teacher |
| `siswa1` | `siswa123` | Student (belum mengerjakan) |
| `siswa2` | `siswa123` | Student (sudah ada hasil) |
| `siswa3` | `siswa123` | Student (sudah ada hasil) |
| `siswa4` | `siswa123` | Student (sudah ada hasil) |
| `siswa5` | `siswa123` | Student (sudah ada hasil) |

**Exam Token:** `181B237B7D26` (UTS Demo)

### Demo Flow

1. Login as `admin` → Dashboard shows stats
2. Go to Bank Soal → "Bank Soal Matematika XII" has 10 questions
3. Go to Ujian → "UTS Demo" is active, click Hasil to see rekap with 4 graded students
4. Logout, login as `siswa1` → See "UTS Demo" in exam list
5. Enter token `181B237B7D26` → Start exam
6. Answer questions, navigate, flag one as doubt
7. Submit → See score immediately
8. Go to Hasil → Review answers with correct/wrong indicators
9. Logout, login as `admin` → See siswa1's result in rekap

## Environment Variables

Set these in Vercel Dashboard → Settings → Environment Variables:

```
DATABASE_URL=postgresql://...pooler...neon.tech/neondb?sslmode=require
DIRECT_URL=postgresql://...neon.tech/neon.tech/neondb?sslmode=require
AUTH_SECRET=<random-32-char-string>
NEXTAUTH_URL=https://your-domain.vercel.app
```

- `DATABASE_URL` — Neon pooled connection (for runtime)
- `DIRECT_URL` — Neon direct connection (for migrations)
- `AUTH_SECRET` — Random string for NextAuth JWT signing
- `NEXTAUTH_URL` — Your Vercel deployment URL

## Tech Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4
- Prisma 7 + Neon Postgres
- NextAuth v5 (Auth.js)
- Lucide React icons

## Local Development

```bash
npm install
cp .env.example .env  # fill in your Neon connection strings
npx prisma db pull
npx prisma generate
npm run seed
npm run dev
```
