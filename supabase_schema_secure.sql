-- Supabase Schema for Production/Thi thật (Secure RLS)
-- Run this in your Supabase SQL Editor

-- 1. Create exams table if not exists
create table if not exists public.exams (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  owner_id uuid references auth.users(id),
  title text not null,
  subject text,
  grade text,
  duration integer,
  exam_type text,
  deadline timestamp with time zone,
  show_result boolean default true,
  exam_data jsonb,
  answer_data jsonb,
  score_config jsonb
);

-- 2. Create submissions table if not exists
create table if not exists public.submissions (
  id uuid default gen_random_uuid() primary key,
  exam_id uuid references public.exams(id) not null,
  student_name text not null,
  class_name text,
  exam_type text,
  multiple_choice_answers jsonb,
  true_false_answers jsonb,
  essay_answer text,
  essay_attachment text,
  multiple_choice_score numeric,
  true_false_score numeric,
  essay_score numeric,
  total_score numeric,
  teacher_comments text,
  submitted_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Turn on Row Level Security (RLS)
alter table public.exams enable row level security;
alter table public.submissions enable row level security;

-- Drop existing policies if they exist (from test)
drop policy if exists "Enable completely public read access" on public.exams;
drop policy if exists "Enable public insert" on public.exams;
drop policy if exists "Enable read access for all users" on public.exams;
drop policy if exists "Students can read exams" on public.exams;
drop policy if exists "Teachers can create exams temporarily" on public.exams;
drop policy if exists "public can read active exams" on public.exams;
drop policy if exists "students can insert submissions" on public.submissions;
drop policy if exists "Enable public insert for submissions" on public.submissions;
drop policy if exists "Enable read access for all submissions" on public.submissions;
drop policy if exists "Students can submit answers" on public.submissions;
drop policy if exists "Teacher can read submissions temporarily" on public.submissions;

-- Secure Policies for exams
-- (Anon cannot read exams. Netlify Function uses Service Role Key)

-- Teacher (authenticated) can insert their own exams
create policy "teacher can insert own exams" on public.exams
  for insert
  to authenticated
  with check (auth.uid() = owner_id);

-- Teacher (authenticated) can read/update their own exams
create policy "teacher can update own exams" on public.exams
  for update
  to authenticated
  using (auth.uid() = owner_id);

create policy "teacher can delete own exams" on public.exams
  for delete
  to authenticated
  using (auth.uid() = owner_id);

create policy "teacher can read own exams" on public.exams
  for select
  to authenticated
  using (auth.uid() = owner_id);

-- Secure Policies for submissions

-- NO POLICY FOR ANON SELECT OR INSERT.
-- Submissions are strictly handled by Netlify Function via Service Role.

-- Teachers can read submissions for exams they own
create policy "teacher can read submissions for own exams" on public.submissions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.exams
      where public.exams.id = submissions.exam_id
      and public.exams.owner_id = auth.uid()
    )
  );

-- Teachers can update submissions (e.g., grade essays, add comments) for exams they own
create policy "teacher can update submissions for own exams" on public.submissions
  for update
  to authenticated
  using (
    exists (
      select 1 from public.exams
      where public.exams.id = submissions.exam_id
      and public.exams.owner_id = auth.uid()
    )
  );

-- Teachers can delete submissions for exams they own
create policy "teacher can delete submissions for own exams" on public.submissions
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.exams
      where public.exams.id = submissions.exam_id
      and public.exams.owner_id = auth.uid()
    )
  );
