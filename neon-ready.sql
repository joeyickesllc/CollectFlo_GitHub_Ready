INSERT INTO message_templates (day_offset, channel, subject, body) VALUES
(-1, 'email', 'Invoice Due Tomorrow', 'Your invoice is due tomorrow. Please ensure timely payment to avoid any late fees.'),
(0, 'email', 'Invoice Due Today', 'This is a reminder that your invoice is due today.'),
(1, 'email', 'Payment Overdue', 'Your invoice payment is now overdue. Please make the payment as soon as possible.'),
(3, 'email', 'Payment Reminder', 'Your invoice payment is 3 days overdue. Please contact us if you need to discuss payment options.'),
(7, 'email', 'Urgent: Payment Required', 'Your invoice is now 7 days overdue. Please make the payment or contact us immediately.'),
(15, 'email', 'Final Notice', 'This is a final notice regarding your overdue invoice. Please contact us immediately.');