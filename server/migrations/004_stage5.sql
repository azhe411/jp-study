-- 阶段 5：听力、写作、阅读、发音、敬语/惯用语、汉字、词汇量测试、课程，以及测验作答记录（统计用）。
-- 可同步实体照例带 version / deleted_at / rev 并挂 touch_row；词汇测试会话与作答记录属服务端内部状态。

CREATE TABLE listening_attempts (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  material_id    text NOT NULL,
  mode           text NOT NULL CHECK (mode IN ('blind', 'subtitle', 'intensive', 'dictation')),
  duration_ms    int NOT NULL,
  score          int,
  segment_scores jsonb NOT NULL DEFAULT '[]',
  replays        int NOT NULL DEFAULT 0,
  version        int NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  rev            bigint NOT NULL DEFAULT 0
);

CREATE TABLE writing_entries (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('diary', 'essay', 'email', 'free')),
  title        text NOT NULL,
  prompt       text,
  content      text NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'corrected', 'failed')),
  char_count   int NOT NULL DEFAULT 0,
  correction   jsonb,
  submitted_at timestamptz,
  version      int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  rev          bigint NOT NULL DEFAULT 0
);
CREATE INDEX writing_entries_user_idx ON writing_entries (user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE TABLE reading_attempts (
  id                    uuid PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  material_id           text NOT NULL,
  duration_ms           int NOT NULL,
  char_count            int NOT NULL,
  chars_per_minute      int NOT NULL,
  looked_up_words       text[] NOT NULL DEFAULT '{}',
  comprehension_correct int,
  comprehension_total   int,
  version               int NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  rev                   bigint NOT NULL DEFAULT 0
);

CREATE TABLE pronunciation_attempts (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  pair_id    text NOT NULL,
  mode       text NOT NULL CHECK (mode IN ('listen', 'speak')),
  target     text NOT NULL CHECK (target IN ('a', 'b')),
  chosen     text CHECK (chosen IN ('a', 'b')),
  transcript text,
  method     text,
  correct    boolean NOT NULL,
  version    int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  rev        bigint NOT NULL DEFAULT 0
);

CREATE TABLE expression_attempts (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_id    text NOT NULL,
  -- 冗余存一份类型，按 keigo / idiom 过滤时免得回查内容库
  type       text NOT NULL CHECK (type IN ('keigo', 'idiom')),
  mode       text NOT NULL CHECK (mode IN ('meaning', 'convert', 'fillBlank')),
  answer     text NOT NULL,
  correct    boolean NOT NULL,
  version    int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  rev        bigint NOT NULL DEFAULT 0
);

CREATE TABLE kanji_attempts (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kanji_id   text NOT NULL,
  mode       text NOT NULL CHECK (mode IN ('reading', 'meaning', 'writing')),
  answer     text NOT NULL,
  correct    boolean NOT NULL,
  version    int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  rev        bigint NOT NULL DEFAULT 0
);
CREATE INDEX kanji_attempts_user_kanji_idx ON kanji_attempts (user_id, kanji_id) WHERE deleted_at IS NULL;

-- 词汇测试会话：题目与答案只在服务端，60 分钟过期
CREATE TABLE vocab_tests (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- [{ itemId, kind, word, options, answerIndex, band, fake }]
  items        jsonb NOT NULL,
  expires_at   timestamptz NOT NULL,
  submitted_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vocab_test_results (
  id               uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  test_id          uuid NOT NULL UNIQUE,
  estimated_vocab  int NOT NULL,
  jlpt_estimate    text NOT NULL,
  false_alarm_rate double precision NOT NULL,
  bands            jsonb NOT NULL,
  version          int NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  rev              bigint NOT NULL DEFAULT 0
);

CREATE TABLE courses (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title           text NOT NULL,
  platform        text NOT NULL CHECK (platform IN ('bilibili', 'youtube', 'other')),
  url             text NOT NULL,
  total_episodes  int,
  current_episode int NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'inProgress', 'paused', 'completed')),
  note            text,
  last_studied_at timestamptz,
  version         int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  rev             bigint NOT NULL DEFAULT 0
);

-- 测验作答明细：统计"做了多少题、错了多少"的来源
CREATE TABLE quiz_answers (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  quiz_id     uuid NOT NULL,
  question_id text NOT NULL,
  correct     boolean NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, quiz_id, question_id)
);
CREATE INDEX quiz_answers_user_time_idx ON quiz_answers (user_id, answered_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['listening_attempts', 'writing_entries', 'reading_attempts', 'pronunciation_attempts',
                           'expression_attempts', 'kanji_attempts', 'vocab_test_results', 'courses'] LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_row()', t, t);
    EXECUTE format('CREATE INDEX %I_user_rev_idx ON %I (user_id, rev)', t, t);
  END LOOP;
END;
$$;
