-- 契约 v1.3.0：学习计划、课程进度、课程内容缓存、视频观看进度。

CREATE TABLE study_plans (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  start_level    text NOT NULL CHECK (start_level IN ('zero', 'kana', 'N5', 'N4', 'N3', 'N2')),
  goal           text NOT NULL CHECK (goal IN ('N5', 'N4', 'N3', 'N2', 'N1', 'travel', 'conversation')),
  start_date     date NOT NULL,
  target_date    date NOT NULL,
  daily_minutes  int NOT NULL CHECK (daily_minutes BETWEEN 10 AND 600),
  reminder_time  text CHECK (reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  late_reminder  boolean NOT NULL DEFAULT true,
  version        int NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  rev            bigint NOT NULL DEFAULT 0
);

CREATE TABLE lesson_progress (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_id  text NOT NULL,
  status     text NOT NULL CHECK (status IN ('available', 'passed')),
  best_score int,
  passed_at  timestamptz,
  attempts   int NOT NULL DEFAULT 0,
  version    int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  rev        bigint NOT NULL DEFAULT 0,
  UNIQUE (user_id, lesson_id)
);

-- AI 生成的课程内容：每课只生成一次，所有用户共享
CREATE TABLE lesson_content (
  lesson_id  text PRIMARY KEY,
  content    jsonb NOT NULL,
  model      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE video_progress (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id    text NOT NULL,
  page         int NOT NULL CHECK (page >= 1),
  position_sec int NOT NULL DEFAULT 0,
  duration_sec int NOT NULL DEFAULT 0,
  completed    boolean NOT NULL DEFAULT false,
  version      int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  rev          bigint NOT NULL DEFAULT 0,
  UNIQUE (user_id, course_id, page)
);
CREATE INDEX video_progress_recent_idx ON video_progress (user_id, course_id, updated_at DESC);

-- 课程过关小测复用测验表
ALTER TABLE quizzes DROP CONSTRAINT quizzes_source_check;
ALTER TABLE quizzes ADD CONSTRAINT quizzes_source_check CHECK (source IN ('lookup', 'retry', 'lesson'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['study_plans', 'lesson_progress', 'video_progress'] LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_row()', t, t);
    EXECUTE format('CREATE INDEX %I_user_rev_idx ON %I (user_id, rev)', t, t);
  END LOOP;
END;
$$;
