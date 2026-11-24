-- 契约 v1.10.0：重新学习要有成绩。主页建议"重学某些卡"之后才能核验做没做、做得怎样；
-- 总记不住的卡也才有办法被证明"记住了"。只追加，不影响复习进度（SRS）。

CREATE TABLE restudy_rounds (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scope       text NOT NULL CHECK (scope IN ('date', 'lesson', 'hard')),
  scope_value text,
  partial     boolean NOT NULL DEFAULT false,
  total       int NOT NULL,
  known       int NOT NULL,
  score       int NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX restudy_rounds_user ON restudy_rounds (user_id, created_at DESC);

CREATE TABLE restudy_results (
  round_id   uuid NOT NULL REFERENCES restudy_rounds (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  card_id    uuid NOT NULL,
  known      boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, card_id)
);
CREATE INDEX restudy_results_card ON restudy_results (user_id, card_id, created_at DESC);
