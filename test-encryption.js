/**
 * Test encryption/decryption with current SESSION_SECRET
 */

require('dotenv').config();
const crypto = require('crypto');
const secrets = require('./backend/config/secrets');

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function encrypt(text) {
  const sessionSecret = secrets.app.sessionSecret;
  const key = crypto.createHash('sha256').update(sessionSecret).digest();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

function decrypt(encData) {
  const sessionSecret = secrets.app.sessionSecret;
  const key = crypto.createHash('sha256').update(sessionSecret).digest();
  const iv = Buffer.from(encData.iv, 'hex');
  const authTag = Buffer.from(encData.authTag, 'hex');
  
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Test with sample QBO token data
const testTokens = {
  access_token: "test_access_token_12345",
  refresh_token: "test_refresh_token_67890",
  realmId: "9341455072813865",
  connected_at: new Date().toISOString(),
  expires_in: 3600
};

console.log('Testing encryption/decryption...');
console.log('SESSION_SECRET:', secrets.app.sessionSecret.substring(0, 4) + '...' + secrets.app.sessionSecret.substring(secrets.app.sessionSecret.length - 4));
console.log('Original tokens:', testTokens);

try {
  // Encrypt
  const tokenStr = JSON.stringify(testTokens);
  const encrypted = encrypt(tokenStr);
  console.log('Encryption successful:', {
    ivLength: encrypted.iv.length,
    authTagLength: encrypted.authTag.length,
    encryptedLength: encrypted.encrypted.length
  });

  // Decrypt
  const decrypted = decrypt(encrypted);
  const parsedTokens = JSON.parse(decrypted);
  console.log('Decryption successful:', parsedTokens);
  
  // Compare
  const match = JSON.stringify(testTokens) === JSON.stringify(parsedTokens);
  console.log('Round-trip successful:', match);
  
} catch (error) {
  console.error('Encryption/decryption failed:', error.message);
  console.error('Error stack:', error.stack);
}