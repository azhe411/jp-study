-- 契约 v1.7.0：
--   课程扩充内容：每课更多的生词（带例句）和句子，单独一张表，不动原来的讲义
--   预设卡的版本：v1 只有讲义里的生词；v2 加上扩充内容。老用户已经放过的课按版本补，用户删掉的不再补回
--   实时点评：教练新增 live 类型，按学习数据的指纹判断要不要重写

CREATE TABLE lesson_extras (
  lesson_id  text PRIMARY KEY,
  vocab      jsonb NOT NULL,
  sentences  jsonb NOT NULL,
  model      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lesson_card_seeds ADD COLUMN v int NOT NULL DEFAULT 1;

ALTER TABLE coach_notes DROP CONSTRAINT coach_notes_kind_check;
ALTER TABLE coach_notes ADD CONSTRAINT coach_notes_kind_check CHECK (kind IN ('daily', 'lesson', 'weekly', 'live'));
ALTER TABLE coach_notes ADD COLUMN fingerprint text;

-- 假名课的"声调"表曾被误做成词卡（正面はし、背面 1）：没学过的收回，学过的也没有意义，一并软删
UPDATE cards SET deleted_at = now(), version = version + 1
 WHERE source = 'lesson' AND deleted_at IS NULL AND back ~ '^[0-9]+$';
