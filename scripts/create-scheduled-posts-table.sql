-- Created scheduled posts table for post scheduling feature
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255),
  media_url TEXT NOT NULL,
  caption TEXT,
  title VARCHAR(255),
  keywords TEXT,
  content_type VARCHAR(50),
  accounts JSONB NOT NULL,
  scheduled_for TIMESTAMP NOT NULL,
  status VARCHAR(50) DEFAULT 'scheduled',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP
);

CREATE INDEX idx_scheduled_posts_scheduled_for ON scheduled_posts(scheduled_for);
CREATE INDEX idx_scheduled_posts_status ON scheduled_posts(status);
