exports.up = async (pgm) => {
  // 1) Add user_id column if it doesn't exist
  await pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'settings' AND column_name = 'user_id'
      ) THEN
        ALTER TABLE settings ADD COLUMN user_id BIGINT;
      END IF;
    END $$;
  `);

  // 2) Drop old unique constraint on company_id if it exists (one-per-company model)
  await pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'settings_company_id_key'
      ) THEN
        ALTER TABLE settings DROP CONSTRAINT settings_company_id_key;
      END IF;
    END $$;
  `);

  // 3) Backfill user_id by picking any user from the same company
  await pgm.sql(`
    UPDATE settings s
    SET user_id = (
      SELECT u.id FROM users u
      WHERE u.company_id = s.company_id
      ORDER BY u.id
      LIMIT 1
    )
    WHERE s.user_id IS NULL;
  `);

  // 4) Enforce NOT NULL and add FK constraint
  await pgm.sql(`
    ALTER TABLE settings
    ALTER COLUMN user_id SET NOT NULL;
  `);

  await pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'settings' AND constraint_name = 'fk_settings_user_id'
      ) THEN
        ALTER TABLE settings
        ADD CONSTRAINT fk_settings_user_id
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  // 5) Ensure uniqueness per user and index
  await pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_settings_user_id ON settings(user_id);
  `);

  await pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_settings_company_id ON settings(company_id);
  `);
};

exports.down = async (pgm) => {
  // Reverse operations: drop unique/index, FK, and user_id column
  await pgm.sql(`
    DROP INDEX IF EXISTS uq_settings_user_id;
  `);

  await pgm.sql(`
    ALTER TABLE settings DROP CONSTRAINT IF EXISTS fk_settings_user_id;
  `);

  await pgm.sql(`
    ALTER TABLE settings DROP COLUMN IF EXISTS user_id;
  `);

  // Restore unique per company_id (legacy behavior)
  await pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'settings' AND constraint_name = 'settings_company_id_key'
      ) THEN
        ALTER TABLE settings ADD CONSTRAINT settings_company_id_key UNIQUE (company_id);
      END IF;
    END $$;
  `);
};