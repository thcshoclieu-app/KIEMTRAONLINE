create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subject text,
  grade text,
  duration integer default 45,
  exam_type text default 'full-exam',
  deadline timestamptz,
  show_result boolean default true,
  exam_data jsonb not null,
  answer_data jsonb,
  score_config jsonb,
  created_at timestamptz default now()
);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid references exams(id) on delete cascade,
  student_name text not null,
  class_name text not null,
  exam_type text default 'full-exam',
  multiple_choice_answers jsonb,
  true_false_answers jsonb,
  essay_answer text,
  essay_attachment text,
  multiple_choice_score numeric default 0,
  true_false_score numeric default 0,
  essay_score numeric default 0,
  total_score numeric default 0,
  teacher_comments text,
  submitted_at timestamptz default now()
);

alter table exams enable row level security;
alter table submissions enable row level security;

drop policy if exists "Students can read exams" on exams;
create policy "Students can read exams"
on exams
for select
to anon
using (true);

drop policy if exists "Teachers can create exams temporarily" on exams;
create policy "Teachers can create exams temporarily"
on exams
for insert
to anon
with check (true);

drop policy if exists "Students can submit answers" on submissions;
create policy "Students can submit answers"
on submissions
for insert
to anon
with check (true);

drop policy if exists "Teacher can read submissions temporarily" on submissions;
create policy "Teacher can read submissions temporarily"
on submissions
for select
to anon
using (true);
