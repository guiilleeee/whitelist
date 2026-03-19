CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  discord_id TEXT UNIQUE NOT NULL,
  discord_username TEXT,
  avatar TEXT,
  created_at TIMESTAMP,
  is_eligible BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('multiple', 'open')),
  options JSONB
);

CREATE TABLE IF NOT EXISTS exams (
  id SERIAL PRIMARY KEY,
  user_discord_id TEXT REFERENCES users(discord_id),
  discord_username TEXT,
  steam_link TEXT,
  discord_channel_id TEXT,
  discord_channel_id_main TEXT,
  discord_channel_id_staff TEXT,
  discord_message_id_staff TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  created_at TIMESTAMP DEFAULT NOW(),
  submitted_at TIMESTAMP,
  reviewed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_questions (
  exam_id INT REFERENCES exams(id) ON DELETE CASCADE,
  question_id INT REFERENCES questions(id),
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (exam_id, question_id)
);

CREATE TABLE IF NOT EXISTS answers (
  id SERIAL PRIMARY KEY,
  exam_id INT REFERENCES exams(id) ON DELETE CASCADE,
  question_id INT REFERENCES questions(id),
  answer_text TEXT,
  time_ms INT,
  is_suspicious BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS logs (
  id SERIAL PRIMARY KEY,
  exam_id INT REFERENCES exams(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  count INT DEFAULT 0,
  details JSONB
);

CREATE TABLE IF NOT EXISTS "session" (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS appeals (
  id SERIAL PRIMARY KEY,
  discord_id TEXT NOT NULL,
  main_channel_id TEXT,
  staff_channel_id TEXT,
  main_message_id TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exams_user ON exams(user_discord_id);
CREATE INDEX IF NOT EXISTS idx_exam_questions_exam ON exam_questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_questions_question ON exam_questions(question_id);
CREATE INDEX IF NOT EXISTS idx_answers_exam ON answers(exam_id);
CREATE INDEX IF NOT EXISTS idx_session_expire ON "session" (expire);
CREATE INDEX IF NOT EXISTS idx_appeals_discord ON appeals(discord_id);
