# Admin User Setup Guide

This guide explains how to create admin users for accessing the CollectFlo admin dashboard and beta statistics.

## Admin Features Available

- **Beta Stats Dashboard**: `/beta-stats.html` - View signup statistics, user activity, and conversion metrics
- **Admin API Endpoints**: Access to admin-only functions like manual follow-up triggers
- **Full Platform Access**: No trial limitations, active subscription status

## Method 1: API Endpoint (Recommended for Production)

### Setup
1. **Set environment variable** in your deployment (Render, etc.):
   ```
   ADMIN_SETUP_SECRET=your-secure-random-string-here
   ```

2. **Make API call** to create admin user:
   ```bash
   curl -X POST https://collectflo.com/api/create-admin \
     -H "Content-Type: application/json" \
     -d '{
       "email": "admin@collectflo.com",
       "password": "your-secure-password",
       "name": "Admin User",
       "company_name": "CollectFlo Admin",
       "admin_secret": "your-secure-random-string-here"
     }'
   ```

### Using JavaScript/Fetch
```javascript
const response = await fetch('/api/create-admin', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'admin@collectflo.com',
    password: 'your-secure-password',
    name: 'Admin User',
    company_name: 'CollectFlo Admin',
    admin_secret: 'your-secure-random-string-here'
  })
});

const result = await response.json();
console.log(result);
```

## Method 2: Local Script (For Development)

If you have local access to the codebase:

```bash
node scripts/create-admin.js admin@collectflo.com adminpass123 "Admin User" "CollectFlo Admin"
```

## After Creating Admin User

1. **Login** at: `https://collectflo.com/login`
2. **Access Beta Stats** at: `https://collectflo.com/beta-stats.html`
3. **Regular Dashboard** at: `https://collectflo.com/dashboard`

## Security Notes

- **Remove `ADMIN_SETUP_SECRET`** from environment after creating admin users
- **Use strong passwords** (minimum 8 characters)
- **Admin users have active subscription status** (no trial limitations)
- **Admin role required** for accessing beta statistics and admin functions

## Troubleshooting

### "Admin setup not available"
- Ensure `ADMIN_SETUP_SECRET` environment variable is set
- Check that the secret matches exactly

### "User already exists"
- The email is already registered
- Try a different email or check existing users

### Database connection errors
- Ensure database is running and accessible
- Check DATABASE_URL environment variable

## Admin Dashboard Features

The beta stats dashboard shows:
- Total beta users and signups
- Today's signup count
- Page visit statistics
- Conversion rate metrics
- Recent signup list
- Traffic source breakdown

All admin functions require the user to have `role: 'admin'` in the database.