-- 001_init.sql —— 阶段 2：用户、会话、幂等、修订号、设置、任务、模板、抽认卡、复习、时长、模考
-- 约定：所有用户实体都有 version / created_at / updated_at / deleted_at / rev。
--      rev 与 updated_at 由触发器维护；version 由应用层递增（复习排期变化不算"编辑"，不涨 version）。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────── 用户与会话 ─────────────

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  device_id   text,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  replaced_by uuid
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- ───────────── 幂等键 ─────────────

CREATE TABLE idempotency_keys (
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_op_id uuid NOT NULL,
  request_hash text NOT NULL,
  status_code  int,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_op_id)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

-- ───────────── 用户级单调修订号 ─────────────
-- 行锁持有到事务结束，因此同一用户的 rev 分配顺序与提交顺序一致，pull 不会漏读。

CREATE TABLE user_revs (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  rev     bigint NOT NULL
);

CREATE FUNCTION next_rev(uid uuid) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO user_revs (user_id, rev) VALUES (uid, 1)
  ON CONFLICT (user_id) DO UPDATE SET rev = user_revs.rev + 1
  RETURNING rev;
$$;

CREATE FUNCTION touch_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.rev := next_rev(NEW.user_id);
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- ───────────── 设置（id 恒等于 user_id）─────────────

CREATE TABLE settings (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  data       jsonb NOT NULL,
  version    int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  rev        bigint NOT NULL DEFAULT 0
);

-- ───────────── 任务模板与任务 ─────────────

CREATE TABLE task_templates (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title          text NOT NULL,
  module         text NOT NULL,
  day_modes      text[] NOT NULL,
  weekdays       text[] NOT NULL DEFAULT '{}',
  target_minutes int,
  target_count   int,
  sort_order     int NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  link           text,
  version        int NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  rev            bigint NOT NULL DEFAULT 0
);
CREATE INDEX task_templates_user_idx ON task_templates (user_id, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE tasks (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date           date NOT NULL,
  title          text NOT NULL,
  module         text NOT NULL,
  target_minutes int,
  target_count   int,
  status         text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done', 'skipped')),
  template_id    uuid,
  sort_order     int NOT NULL DEFAULT 0,
  link           text,
  note           text,
  completed_at   timestamptz,
  version        int NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  rev            bigint NOT NULL DEFAULT 0
);
CREATE INDEX tasks_user_date_idx ON tasks (user_id, date, sort_order) WHERE deleted_at IS NULL;

-- 记录某天按什么档位生成过任务：删光任务后不会被"今天"接口自作主张地重新生成
CREATE TABLE day_plans (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date       date NOT NULL,
  day_mode   text NOT NULL CHECK (day_mode IN ('minimal', 'standard', 'sprint')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

-- ───────────── 抽认卡与复习 ─────────────

CREATE TABLE cards (
  id                  uuid PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  deck                text NOT NULL,
  front               text NOT NULL,
  back                text NOT NULL,
  reading             text,
  example             text,
  example_translation text,
  tags                text[] NOT NULL DEFAULT '{}',
  source              text NOT NULL DEFAULT 'manual',
  source_ref          text,
  jlpt_level          text,
  suspended           boolean NOT NULL DEFAULT false,
  -- FSRS 排期
  state               text NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review', 'relearning')),
  due                 timestamptz NOT NULL DEFAULT now(),
  stability           double precision NOT NULL DEFAULT 0,
  difficulty          double precision NOT NULL DEFAULT 0,
  scheduled_days      double precision NOT NULL DEFAULT 0,
  learning_steps      int NOT NULL DEFAULT 0,
  reps                int NOT NULL DEFAULT 0,
  lapses              int NOT NULL DEFAULT 0,
  last_review_at      timestamptz,
  version             int NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  rev                 bigint NOT NULL DEFAULT 0
);
CREATE INDEX cards_user_due_idx ON cards (user_id, due) WHERE deleted_at IS NULL AND NOT suspended;
CREATE INDEX cards_user_deck_idx ON cards (user_id, deck) WHERE deleted_at IS NULL;
CREATE INDEX cards_user_created_idx ON cards (user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE TABLE review_logs (
  id                   uuid PRIMARY KEY,
  user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  card_id              uuid NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  rating               smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),
  reviewed_at          timestamptz NOT NULL,
  duration_ms          int NOT NULL,
  state_before         text NOT NULL,
  scheduled_days_after double precision NOT NULL,
  version              int NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  rev                  bigint NOT NULL DEFAULT 0
);
CREATE INDEX review_logs_card_idx ON review_logs (card_id, reviewed_at);
CREATE INDEX review_logs_user_time_idx ON review_logs (user_id, reviewed_at);

-- ───────────── 学习时长与 JLPT 模考 ─────────────

CREATE TABLE time_logs (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  module      text NOT NULL,
  started_at  timestamptz NOT NULL,
  duration_ms int NOT NULL,
  version     int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  rev         bigint NOT NULL DEFAULT 0
);
CREATE INDEX time_logs_user_time_idx ON time_logs (user_id, started_at);

CREATE TABLE jlpt_mocks (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  level      text NOT NULL CHECK (level IN ('N5', 'N4', 'N3', 'N2', 'N1')),
  taken_at   date NOT NULL,
  sections   jsonb NOT NULL,
  total      int NOT NULL,
  total_max  int NOT NULL,
  source     text,
  version    int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  rev        bigint NOT NULL DEFAULT 0
);
CREATE INDEX jlpt_mocks_user_idx ON jlpt_mocks (user_id, taken_at);

-- ───────────── 触发器与同步索引 ─────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['settings', 'task_templates', 'tasks', 'cards', 'review_logs', 'time_logs', 'jlpt_mocks'] LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_row()', t, t);
    EXECUTE format('CREATE INDEX %I_user_rev_idx ON %I (user_id, rev)', t, t);
  END LOOP;
END;
$$;
