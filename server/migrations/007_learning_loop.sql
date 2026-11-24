-- 契约 v1.5.0：学习闭环。
--   本课练习：每课记录练习的最好成绩与时间，今日路线据此判断"练习"一站是否完成
--   预设抽认卡：按课记录"已经把这一课的词放进牌组"，只放一次 —— 用户删掉的卡不会被再塞回来
--   学习教练：AI（或规则）写的每日 / 每课 / 每周小结，按 (用户, 类型, 引用) 缓存，一天只写一次

ALTER TABLE lesson_progress ADD COLUMN practice_best int CHECK (practice_best BETWEEN 0 AND 100);
ALTER TABLE lesson_progress ADD COLUMN practiced_at timestamptz;

CREATE TABLE lesson_card_seeds (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_id  text NOT NULL,
  cards      int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE coach_notes (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('daily', 'lesson', 'weekly')),
  ref        text NOT NULL,
  content    jsonb NOT NULL,
  source     text NOT NULL CHECK (source IN ('ai', 'rules')),
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, ref)
);
CREATE INDEX coach_notes_user_created_idx ON coach_notes (user_id, created_at DESC);

-- 旧版起步模板里与今日路线重复的三项（复习、新卡、B 站 1 集）停用；用户改过名字的不动
UPDATE task_templates SET active = false, version = version + 1
 WHERE deleted_at IS NULL AND active
   AND ((module = 'flashcards' AND title IN ('复习到期抽认卡', '学习新卡')) OR (module = 'course' AND title = 'B 站课程 1 集'));
