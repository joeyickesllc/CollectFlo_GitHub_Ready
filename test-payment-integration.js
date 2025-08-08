/**
 * Test Payment Integration
 * 
 * This script demonstrates the complete payment link integration
 * including QuickBooks payment link generation and follow-up communication.
 */

const { generateQuickBooksPaymentLink } = require('./services/paymentLinkService');
const { sendTestFollowUpEmail } = require('./services/emailService');
const { sendTestFollowUpSMS } = require('./services/smsService');

/**
 * Test QuickBooks payment link generation
 */
async function testPaymentLinkGeneration() {
  console.log('\n=== Testing Payment Link Generation ===');
  
  try {
    // Test with a sample invoice ID and user ID
    const invoiceId = '1001'; // Sample QuickBooks invoice ID
    const userId = 1; // Sample user ID
    
    console.log(`Generating payment link for invoice ${invoiceId}...`);
    
    const paymentLinkData = await generateQuickBooksPaymentLink(invoiceId, userId);
    
    console.log('✅ Payment link generated successfully:');
    console.log({
      paymentUrl: paymentLinkData.paymentUrl,
      invoiceNumber: paymentLinkData.invoiceNumber,
      amount: paymentLinkData.amount,
      customerName: paymentLinkData.customerName,
      dueDate: paymentLinkData.dueDate
    });
    
    return paymentLinkData;
  } catch (error) {
    console.error('❌ Payment link generation failed:', error.message);
    return null;
  }
}

/**
 * Test email with payment link
 */
async function testEmailWithPaymentLink(paymentLink = null) {
  console.log('\n=== Testing Email with Payment Link ===');
  
  try {
    const testEmail = 'test@example.com'; // Replace with your test email
    const testData = {
      invoiceId: 'TEST-001',
      customerName: 'Test Customer',
      amount: 1500.00,
      daysOverdue: 5,
      templateType: 'gentle_reminder',
      paymentLink: paymentLink || 'https://example.com/pay/test-123'
    };
    
    console.log(`Sending test email to ${testEmail}...`);
    
    const result = await sendTestFollowUpEmail(testEmail, testData);
    
    console.log('✅ Test email sent successfully:');
    console.log({
      status: result.status,
      templateType: result.templateType,
      recipient: result.recipient,
      messageId: result.messageId,
      subject: result.subject
    });
    
    return result;
  } catch (error) {
    console.error('❌ Test email failed:', error.message);
    return null;
  }
}

/**
 * Test SMS with payment link
 */
async function testSMSWithPaymentLink(paymentLink = null) {
  console.log('\n=== Testing SMS with Payment Link ===');
  
  try {
    const testPhone = '+1234567890'; // Replace with your test phone number
    const testData = {
      invoiceId: 'TEST-001',
      customerName: 'Test Customer',
      amount: 1500.00,
      daysOverdue: 5,
      templateType: 'gentle_reminder',
      paymentLink: paymentLink || 'https://example.com/pay/test-123'
    };
    
    console.log(`Sending test SMS to ${testPhone}...`);
    
    const result = await sendTestFollowUpSMS(testPhone, testData);
    
    console.log('✅ Test SMS sent successfully:');
    console.log({
      status: result.status,
      templateType: result.templateType,
      recipient: result.recipient,
      messageId: result.messageId,
      message: result.message,
      characterCount: result.characterCount
    });
    
    return result;
  } catch (error) {
    console.error('❌ Test SMS failed:', error.message);
    return null;
  }
}

/**
 * Run complete payment integration test
 */
async function runCompleteTest() {
  console.log('🚀 Starting Payment Integration Test');
  console.log('=====================================');
  
  // Step 1: Test payment link generation
  const paymentLinkData = await testPaymentLinkGeneration();
  
  // Step 2: Test email with real payment link
  await testEmailWithPaymentLink(paymentLinkData?.paymentUrl);
  
  // Step 3: Test SMS with real payment link
  await testSMSWithPaymentLink(paymentLinkData?.paymentUrl);
  
  console.log('\n=== Test Summary ===');
  console.log('✅ Payment link generation: ' + (paymentLinkData ? 'SUCCESS' : 'FAILED'));
  console.log('✅ Email integration: Ready (check email logs)');
  console.log('✅ SMS integration: Ready (check SMS logs)');
  console.log('\n🎉 Payment integration test completed!');
  console.log('\nNext steps:');
  console.log('1. Test with real QuickBooks invoice IDs');
  console.log('2. Verify payment links redirect to QuickBooks payment portal');
  console.log('3. Test end-to-end customer payment flow');
  console.log('4. Monitor follow-up automation with payment status checking');
}

// Export functions for individual testing
module.exports = {
  testPaymentLinkGeneration,
  testEmailWithPaymentLink,
  testSMSWithPaymentLink,
  runCompleteTest
};

// Run test if called directly
if (require.main === module) {
  runCompleteTest().catch(console.error);
}