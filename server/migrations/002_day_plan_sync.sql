-- 契约 v1.2.0（A1）：day_plans 成为只读同步实体 dayPlan。
-- 补齐同步所需的列（id / version / deleted_at / rev），挂上 touch_row 触发器，
-- 并给已有行补发 rev，让下一次全量 pull 能拿到它们。

ALTER TABLE day_plans
  ADD COLUMN id         uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN version    int NOT NULL DEFAULT 1,
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN rev        bigint NOT NULL DEFAULT 0;

ALTER TABLE day_plans ADD CONSTRAINT day_plans_id_key UNIQUE (id);

CREATE TRIGGER day_plans_touch BEFORE INSERT OR UPDATE ON day_plans FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE INDEX day_plans_user_rev_idx ON day_plans (user_id, rev);

UPDATE day_plans SET day_mode = day_mode;  -- 触发器会给每行分配新的 rev
