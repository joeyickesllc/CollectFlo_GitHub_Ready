-- Quick Admin User Creation SQL
-- Run this directly in your Render PostgreSQL database console

-- First, let's create a company for the admin user
INSERT INTO companies (name, created_at, is_beta) VALUES ('CollectFlo Admin', NOW(), true);

-- Get the company ID (replace X with the actual ID returned from above)
-- INSERT INTO users (name, email, password, company_id, role, is_beta, created_at) 
-- VALUES (
--   'Admin User', 
--   'admin@collectflo.com', 
--   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password: "password"
--   1, -- replace with actual company ID from above
--   'admin', 
--   true, 
--   NOW()
-- );

-- Alternative: One-step admin creation with password hash
-- Password will be: AdminPass123
INSERT INTO users (name, email, password, company_id, role, is_beta, created_at) 
SELECT 
  'Admin User' as name,
  'admin@collectflo.com' as email,
  '$2a$10$5/oiWvuS6VVD5t0VdVqp/uNfBhLN3L7DjIl7LzV.mKd2fR6vgQo3m' as password, -- AdminPass123
  c.id as company_id,
  'admin' as role,
  true as is_beta,
  NOW() as created_at
FROM companies c 
WHERE c.name = 'CollectFlo Admin' 
ORDER BY c.created_at DESC 
LIMIT 1;

-- Verify admin user was created
SELECT id, name, email, role, is_beta, created_at FROM users WHERE email = 'admin@collectflo.com';