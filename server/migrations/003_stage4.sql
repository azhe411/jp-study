-- 阶段 4：AI 查询、错题本、场景对话、句库、朗读/跟读。
-- 可同步实体（mistake / conversation / message / phrase / phraseAttempt / speakingAttempt）
-- 一律带 version / deleted_at / rev，并挂 touch_row 触发器；
-- AI 缓存与测验属服务端内部状态，不同步。

-- ───────────── AI 查询缓存（跨用户共享：同一个词的解释与谁来查无关）─────────────

CREATE TABLE ai_lookup_cache (
  type         text NOT NULL CHECK (type IN ('word', 'grammar', 'kanji')),
  query_norm   text NOT NULL,
  -- 带语境的查询单独缓存：同一个词在不同句子里可能是不同意思
  context_hash text NOT NULL DEFAULT '',
  result       jsonb NOT NULL,
  model        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (type, query_norm, context_hash)
);

-- ───────────── 测验：题目与答案只存在服务端，过期即失效 ─────────────

CREATE TABLE quizzes (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- lookup：查询附带的三道题；retry：错题变式题
  source     text NOT NULL CHECK (source IN ('lookup', 'retry')),
  source_ref text,
  -- [{ id, stem, options[4], answerIndex, explanationZh, category }]
  questions  jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quizzes_expires_idx ON quizzes (expires_at);

-- ───────────── 错题本 ─────────────

CREATE TABLE mistakes (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category       text NOT NULL,
  source         text NOT NULL DEFAULT 'manual',
  source_ref     text,
  question       text NOT NULL,
  wrong_answer   text NOT NULL,
  correct_answer text NOT NULL,
  explanation_zh text,
  error_count    int NOT NULL DEFAULT 1,
  last_wrong_at  timestamptz NOT NULL DEFAULT now(),
  mastered       boolean NOT NULL DEFAULT false,
  mastered_at    timestamptz,
  tags           text[] NOT NULL DEFAULT '{}',
  version        int NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  rev            bigint NOT NULL DEFAULT 0
);
-- 同 question + correctAnswer 视为同一道错题（题干可能很长，用摘要建唯一索引）
CREATE UNIQUE INDEX mistakes_dedup_idx ON mistakes (user_id, md5(question || chr(31) || correct_answer)) WHERE deleted_at IS NULL;
CREATE INDEX mistakes_user_count_idx ON mistakes (user_id, error_count DESC, last_wrong_at DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX mistakes_user_last_idx ON mistakes (user_id, last_wrong_at DESC, id) WHERE deleted_at IS NULL;

-- ───────────── 场景对话（场景本身是代码里的内容库）─────────────

CREATE TABLE conversations (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scenario_id   text NOT NULL,
  register      text NOT NULL CHECK (register IN ('plain', 'polite', 'keigo')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  title         text NOT NULL,
  message_count int NOT NULL DEFAULT 0,
  score         int,
  summary       text,
  finished_at   timestamptz,
  version       int NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  rev           bigint NOT NULL DEFAULT 0
);
CREATE INDEX conversations_user_created_idx ON conversations (user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX conversations_user_scenario_idx ON conversations (user_id, scenario_id) WHERE deleted_at IS NULL;

CREATE TABLE messages (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         text NOT NULL,
  translation_zh  text,
  reading         text,
  feedback        jsonb,
  version         int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  rev             bigint NOT NULL DEFAULT 0
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at, id);

-- ───────────── 句库 ─────────────

CREATE TABLE phrases (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book          text NOT NULL CHECK (book IN ('travel', 'life')),
  category      text NOT NULL,
  ja            text NOT NULL,
  reading       text NOT NULL,
  zh            text NOT NULL,
  note          text,
  builtin       boolean NOT NULL DEFAULT false,
  -- 内置句在内容库里的稳定标识；自建句为 null
  slug          text,
  -- 排序键：内置句 = 内容库中的序号，自建句 = 创建时刻（毫秒），因此自建句总排在内置句之后
  sort_key      bigint NOT NULL,
  favorite      boolean NOT NULL DEFAULT false,
  best_score    int,
  attempt_count int NOT NULL DEFAULT 0,
  version       int NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  rev           bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX phrases_user_slug_idx ON phrases (user_id, slug) WHERE slug IS NOT NULL;
CREATE INDEX phrases_user_sort_idx ON phrases (user_id, sort_key, id) WHERE deleted_at IS NULL;

-- 内容库下发到每个用户的版本（内置句按需补种，不覆盖用户已有的行）
CREATE TABLE user_seeds (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    text NOT NULL,
  version int NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE phrase_attempts (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  phrase_id   uuid NOT NULL REFERENCES phrases (id) ON DELETE CASCADE,
  transcript  text NOT NULL,
  method      text NOT NULL,
  duration_ms int NOT NULL,
  scores      jsonb NOT NULL,
  diff        jsonb NOT NULL,
  version     int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  rev         bigint NOT NULL DEFAULT 0
);
CREATE INDEX phrase_attempts_phrase_idx ON phrase_attempts (phrase_id, created_at DESC, id DESC);

-- ───────────── 朗读 / 影子跟读 ─────────────

CREATE TABLE speaking_attempts (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mode           text NOT NULL CHECK (mode IN ('reading', 'shadowing')),
  source_type    text NOT NULL,
  source_id      text,
  reference_text text NOT NULL,
  transcript     text NOT NULL,
  method         text NOT NULL,
  duration_ms    int NOT NULL,
  scores         jsonb NOT NULL,
  diff           jsonb NOT NULL,
  version        int NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  rev            bigint NOT NULL DEFAULT 0
);
CREATE INDEX speaking_attempts_user_idx ON speaking_attempts (user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

-- ───────────── 触发器与同步索引 ─────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mistakes', 'conversations', 'messages', 'phrases', 'phrase_attempts', 'speaking_attempts'] LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_row()', t, t);
    EXECUTE format('CREATE INDEX %I_user_rev_idx ON %I (user_id, rev)', t, t);
  END LOOP;
END;
$$;
