exports.up = async (pgm) => {
  // Only proceed if table exists and column is integer
  const { rows } = await pgm.db.query(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'qbo_tokens'
      AND column_name = 'user_id';
  `);

  if (rows.length > 0 && rows[0].data_type && rows[0].data_type.toLowerCase() === 'integer') {
    // Drop FK constraint if any, alter type, then re-add
    // Find existing FK constraint name
    const fkResult = await pgm.db.query(`
      SELECT conname AS constraint_name
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
      WHERE t.relname = 'qbo_tokens'
        AND a.attname = 'user_id'
        AND c.contype = 'f'
      LIMIT 1;
    `);

    if (fkResult.rows.length > 0) {
      const constraintName = fkResult.rows[0].constraint_name;
      pgm.sql(`ALTER TABLE public.qbo_tokens DROP CONSTRAINT IF EXISTS ${constraintName};`);
    }

    // Alter column type with USING cast
    pgm.sql(`ALTER TABLE public.qbo_tokens ALTER COLUMN user_id TYPE BIGINT USING user_id::BIGINT;`);

    // Recreate FK constraint to users(id)
    pgm.sql(`ALTER TABLE public.qbo_tokens ADD CONSTRAINT qbo_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;`);
  }
};

exports.down = async (pgm) => {
  // Revert BIGINT -> INTEGER only if currently BIGINT
  const { rows } = await pgm.db.query(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'qbo_tokens'
      AND column_name = 'user_id';
  `);

  if (rows.length > 0 && rows[0].data_type && rows[0].data_type.toLowerCase() !== 'integer') {
    // Drop FK to allow type change
    pgm.sql(`ALTER TABLE public.qbo_tokens DROP CONSTRAINT IF EXISTS qbo_tokens_user_id_fkey;`);
    pgm.sql(`ALTER TABLE public.qbo_tokens ALTER COLUMN user_id TYPE INTEGER USING user_id::INTEGER;`);
    // Recreate FK
    pgm.sql(`ALTER TABLE public.qbo_tokens ADD CONSTRAINT qbo_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;`);
  }
};