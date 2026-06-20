-- Modakerati Database Schema
-- Run this in the Supabase Dashboard SQL Editor: https://supabase.com/dashboard/project/rwkdpjuyosssfzcshrjv/sql

-- 1. Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  university TEXT,
  department TEXT,
  level TEXT CHECK (level IN ('license', 'master', 'doctorat')),
  academic_year TEXT,
  avatar_url TEXT,
  language TEXT DEFAULT 'fr' CHECK (language IN ('ar', 'en', 'fr')),
  theme TEXT DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Templates
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  university TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('memoire_master', 'these_doctorat', 'pfe', 'memoire_licence', 'generic')),
  language TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  chapter_structure JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Theses
CREATE TABLE IF NOT EXISTS theses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  template_id UUID REFERENCES templates,
  language TEXT DEFAULT 'fr',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  word_count INTEGER DEFAULT 0,
  page_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Chapters
CREATE TABLE IF NOT EXISTS chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thesis_id UUID REFERENCES theses ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'done')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Sections
CREATE TABLE IF NOT EXISTS sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID REFERENCES chapters ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'done')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Chat Messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thesis_id UUID REFERENCES theses ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  chapter_id UUID REFERENCES chapters,
  section_id UUID REFERENCES sections,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles ON DELETE CASCADE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'pro_plus')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  gateway TEXT CHECK (gateway IN ('chargily', 'eccp', 'stripe')),
  gateway_subscription_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. References / Citations
CREATE TABLE IF NOT EXISTS "references" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thesis_id UUID REFERENCES theses ON DELETE CASCADE NOT NULL,
  author TEXT NOT NULL,
  year TEXT,
  title TEXT NOT NULL,
  source TEXT,
  citation_style TEXT DEFAULT 'apa' CHECK (citation_style IN ('apa', 'mla', 'chicago', 'iso690')),
  cited_chapters TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT CHECK (type IN ('ai_complete', 'export', 'payment', 'system', 'grammar')),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE theses ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE "references" ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own profile
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Theses: users can CRUD their own theses
CREATE POLICY "Users can view own theses" ON theses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create theses" ON theses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own theses" ON theses FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own theses" ON theses FOR DELETE USING (auth.uid() = user_id);

-- Chapters: access through thesis ownership
CREATE POLICY "Users can view own chapters" ON chapters FOR SELECT
  USING (thesis_id IN (SELECT id FROM theses WHERE user_id = auth.uid()));
CREATE POLICY "Users can create chapters" ON chapters FOR INSERT
  WITH CHECK (thesis_id IN (SELECT id FROM theses WHERE user_id = auth.uid()));
CREATE POLICY "Users can update own chapters" ON chapters FOR UPDATE
  USING (thesis_id IN (SELECT id FROM theses WHERE user_id = auth.uid()));
CREATE POLICY "Users can delete own chapters" ON chapters FOR DELETE
  USING (thesis_id IN (SELECT id FROM theses WHERE user_id = auth.uid()));

-- Sections: access through chapter → thesis ownership
CREATE POLICY "Users can view own sections" ON sections FOR SELECT
  USING (chapter_id IN (SELECT c.id FROM chapters c JOIN theses t ON c.thesis_id = t.id WHERE t.user_id = auth.uid()));
CREATE POLICY "Users can create sections" ON sections FOR INSERT
  WITH CHECK (chapter_id IN (SELECT c.id FROM chapters c JOIN theses t ON c.thesis_id = t.id WHERE t.user_id = auth.uid()));
CREATE POLICY "Users can update own sections" ON sections FOR UPDATE
  USING (chapter_id IN (SELECT c.id FROM chapters c JOIN theses t ON c.thesis_id = t.id WHERE t.user_id = auth.uid()));
CREATE POLICY "Users can delete own sections" ON sections FOR DELETE
  USING (chapter_id IN (SELECT c.id FROM chapters c JOIN theses t ON c.thesis_id = t.id WHERE t.user_id = auth.uid()));

-- Chat messages: access through thesis ownership
CREATE POLICY "Users can view own chat" ON chat_messages FOR SELECT
  USING (thesis_id IN (SELECT id FROM theses WHERE user_id = auth.uid()));
CREATE POLICY "Users can create chat messages" ON chat_messages FOR INSERT
  WITH CHECK (thesis_id IN (SELECT id FROM theses WHERE user_id = auth.uid()));

-- Subscriptions: users can read their own
CREATE POLICY "Users can view own subscription" ON subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create subscription" ON subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- References: access through thesis ownership
CREATE POLICY "Users can view own references" ON "references" FOR SELECT
  USING (thesis_id IN (SELECT id FROM theses WHERE user_id = auth.uid()));
CREATE POLICY "Users can create references" ON "references" FOR INSERT
  WITH CHECK (thesis_id IN (SELECT id FROM theses WHERE user_id = auth.uid()));
CREATE POLICY "Users can update own references" ON "references" FOR UPDATE
  USING (thesis_id IN (SELECT id FROM theses WHERE user_id = auth.uid()));
CREATE POLICY "Users can delete own references" ON "references" FOR DELETE
  USING (thesis_id IN (SELECT id FROM theses WHERE user_id = auth.uid()));

-- Notifications: users see their own
CREATE POLICY "Users can view own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON notifications FOR UPDATE USING (auth.uid() = user_id);

-- Templates: readable by all authenticated users
CREATE POLICY "Templates are viewable by authenticated users" ON templates FOR SELECT TO authenticated USING (true);

-- ============================================================
-- Auto-create profile on signup
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Seed: University Templates
-- ============================================================

INSERT INTO templates (university, type, language, name, config, chapter_structure) VALUES
(
  'Universite de Djelfa',
  'memoire_master',
  'ar/fr',
  'Memoire de Master',
  '{"margins": {"top": "2.5 cm", "bottom": "2.5 cm", "left": "3.0 cm", "right": "2.0 cm"}, "bodyFont": "Times New Roman", "bodySize": "12 pt", "headingFont": "Times New Roman Bold", "lineSpacing": "1.5", "paperSize": "A4"}',
  '["Cover Page", "Introduction", "Literature Review", "Methodology", "Results & Discussion", "Conclusion", "References", "Appendices"]'
),
(
  'USTHB Alger',
  'these_doctorat',
  'fr',
  'These de Doctorat',
  '{"margins": {"top": "2.5 cm", "bottom": "2.5 cm", "left": "3.0 cm", "right": "2.0 cm"}, "bodyFont": "Times New Roman", "bodySize": "12 pt", "headingFont": "Times New Roman Bold", "lineSpacing": "1.5", "paperSize": "A4"}',
  '["Cover Page", "Abstract", "Introduction", "State of the Art", "Contribution", "Experiments", "Conclusion", "References"]'
),
(
  'Universite de Blida',
  'memoire_licence',
  'ar/fr',
  'Memoire de Licence',
  '{"margins": {"top": "2.5 cm", "bottom": "2.5 cm", "left": "2.5 cm", "right": "2.5 cm"}, "bodyFont": "Times New Roman", "bodySize": "12 pt", "headingFont": "Arial Bold", "lineSpacing": "1.5", "paperSize": "A4"}',
  '["Cover Page", "Introduction", "Chapter 1", "Chapter 2", "Chapter 3", "Conclusion", "References"]'
),
(
  'ESI Alger',
  'pfe',
  'fr/en',
  'PFE - Projet de Fin d''Etudes',
  '{"margins": {"top": "2.5 cm", "bottom": "2.5 cm", "left": "3.0 cm", "right": "2.0 cm"}, "bodyFont": "Times New Roman", "bodySize": "12 pt", "headingFont": "Arial Bold", "lineSpacing": "1.5", "paperSize": "A4"}',
  '["Cover Page", "Acknowledgements", "Introduction", "State of the Art", "Analysis & Design", "Implementation", "Conclusion", "References"]'
),
(
  'Generic International',
  'generic',
  'en',
  'Master''s Thesis',
  '{"margins": {"top": "1 in", "bottom": "1 in", "left": "1.5 in", "right": "1 in"}, "bodyFont": "Times New Roman", "bodySize": "12 pt", "headingFont": "Times New Roman Bold", "lineSpacing": "2.0", "paperSize": "Letter"}',
  '["Title Page", "Abstract", "Introduction", "Literature Review", "Methodology", "Results", "Discussion", "Conclusion", "References"]'
);
