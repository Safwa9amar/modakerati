-- Modakerati — Notifications System Migration
-- Run this in the Supabase Dashboard SQL Editor:
--   https://supabase.com/dashboard/project/rwkdpjuyosssfzcshrjv/sql
--
-- Adds: notifications.data, expanded notification type check, push_tokens table,
-- profiles.notification_preferences, and RLS policies for push_tokens & notifications.
-- Idempotent — safe to re-run.

-- ============================================================
-- 1. notifications: add `data` payload column
-- ============================================================
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;

-- ============================================================
-- 2. notifications: expand allowed type values
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'ai_complete', 'export', 'payment', 'system',
    'grammar', 'template', 'subscription', 'welcome'
  ));

-- ============================================================
-- 3. profiles: notification preferences
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notification_preferences JSONB
  DEFAULT '{"pushEnabled":true,"aiSuggestions":true,"exportReminders":false,"marketing":false}'::jsonb;

-- ============================================================
-- 4. push_tokens (Expo Push device tokens)
-- ============================================================
CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles ON DELETE CASCADE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- push_tokens RLS: users manage their own rows
DROP POLICY IF EXISTS "Users can view own push tokens" ON push_tokens;
CREATE POLICY "Users can view own push tokens" ON push_tokens
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own push tokens" ON push_tokens;
CREATE POLICY "Users can insert own push tokens" ON push_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own push tokens" ON push_tokens;
CREATE POLICY "Users can update own push tokens" ON push_tokens
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own push tokens" ON push_tokens;
CREATE POLICY "Users can delete own push tokens" ON push_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 5. notifications: additional RLS policies (INSERT + DELETE)
--    The server uses the admin client, but these keep RLS consistent.
--    (SELECT/UPDATE policies already exist from 001_initial_schema.sql.)
-- ============================================================
DROP POLICY IF EXISTS "Users can insert own notifications" ON notifications;
CREATE POLICY "Users can insert own notifications" ON notifications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;
CREATE POLICY "Users can delete own notifications" ON notifications
  FOR DELETE USING (auth.uid() = user_id);
