-- QBO Tokens Table Creation Script
-- This script creates the qbo_tokens table if it doesn't already exist
-- It is safe to run multiple times (idempotent)

-- Check if the table exists before creating it
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'qbo_tokens') THEN
        -- Create the table
        CREATE TABLE public.qbo_tokens (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            encrypted_tokens TEXT NOT NULL,
            iv TEXT NOT NULL,
            auth_tag TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT qbo_tokens_encrypted_data_check CHECK (encrypted_tokens != '' AND iv != '' AND auth_tag != '')
        );

        -- Add table comment
        COMMENT ON TABLE public.qbo_tokens IS 'Stores encrypted QuickBooks OAuth tokens for users';
        
        -- Add column comments
        COMMENT ON COLUMN public.qbo_tokens.encrypted_tokens IS 'Encrypted QuickBooks OAuth tokens';
        COMMENT ON COLUMN public.qbo_tokens.iv IS 'Initialization vector for AES-GCM encryption';
        COMMENT ON COLUMN public.qbo_tokens.auth_tag IS 'Authentication tag for AES-GCM encryption';
        
        -- Create indexes
        CREATE INDEX idx_qbo_tokens_user_id ON public.qbo_tokens(user_id);
        CREATE INDEX idx_qbo_tokens_updated_at ON public.qbo_tokens(updated_at);
        
        RAISE NOTICE 'Created qbo_tokens table and indexes';
    ELSE
        RAISE NOTICE 'qbo_tokens table already exists, no changes made';
    END IF;
END $$;

-- Verify indexes exist (will create them if they don't)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'qbo_tokens' AND indexname = 'idx_qbo_tokens_user_id') THEN
        CREATE INDEX idx_qbo_tokens_user_id ON public.qbo_tokens(user_id);
        RAISE NOTICE 'Created missing index on user_id';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'qbo_tokens' AND indexname = 'idx_qbo_tokens_updated_at') THEN
        CREATE INDEX idx_qbo_tokens_updated_at ON public.qbo_tokens(updated_at);
        RAISE NOTICE 'Created missing index on updated_at';
    END IF;
END $$;
