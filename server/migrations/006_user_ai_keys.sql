-- 契约 v1.4.0：用户自带 AI Key。Key 以 AES-256-GCM 密文存放，只留末 4 位用于辨认。
CREATE TABLE user_ai_keys (
  user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  provider   text NOT NULL DEFAULT 'deepseek',
  key_sealed text NOT NULL,
  last4      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 共享额度：可以用服务器上的 Key。新用户默认没有。
ALTER TABLE users ADD COLUMN shared_ai boolean NOT NULL DEFAULT false;

-- 迁移前就存在的真实账号（站长自己）保留共享额度；冒烟、压测账号不给
UPDATE users SET shared_ai = true
 WHERE email NOT LIKE 'smoke-%@example.com' AND email NOT LIKE 'load-%@example.com';
