<?php
// Contact form handler for cPanel / shared hosting with PHP.
// Values in {{php:...}} are filled in from site.config.json by build.mjs.
declare(strict_types=1);
date_default_timezone_set('Africa/Nairobi');

$TO = {{php:firm.email}};          // where enquiries are delivered
$FROM = {{php:firm.formSender}};   // an address on your own domain (helps delivery / SPF)
$FIRM = {{php:firm.name}};
$BACK = 'contact.html';

function back(string $query): void {
    global $BACK;
    header('Location: ' . $BACK . '?' . $query, true, 303);
    exit;
}
function clean_line(string $v, int $max): string {
    $v = trim(preg_replace('/[\r\n\t]+/', ' ', $v) ?? '');
    return function_exists('mb_substr') ? mb_substr($v, 0, $max) : substr($v, 0, $max);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Location: ' . $BACK, true, 303);
    exit;
}

// Spam checks: hidden honeypot field must be empty; form must not be submitted
// implausibly fast (under 3 seconds) when the browser set a start time.
if (!empty($_POST['website'])) back('sent=1');
$started = (int)($_POST['started'] ?? 0);
if ($started > 0 && (time() - $started) < 3) back('error=spam');

$name    = clean_line((string)($_POST['name'] ?? ''), 120);
$email   = clean_line((string)($_POST['email'] ?? ''), 160);
$phone   = clean_line((string)($_POST['phone'] ?? ''), 40);
$topic   = clean_line((string)($_POST['topic'] ?? 'General enquiry'), 80);
$message = trim((string)($_POST['message'] ?? ''));
$message = function_exists('mb_substr') ? mb_substr($message, 0, 5000) : substr($message, 0, 5000);
$consent = ($_POST['consent'] ?? '') === 'yes';

if ($name === '' || $message === '' || !$consent || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    back('error=missing');
}

// Very small per-visitor rate limit (5 messages per hour) using the server temp directory.
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$bucket = sys_get_temp_dir() . '/omc-form-' . hash('sha256', $ip . __FILE__);
$recent = [];
if (is_readable($bucket)) {
    $recent = array_filter(array_map('intval', explode(',', (string)file_get_contents($bucket))), fn($t) => $t > time() - 3600);
}
if (count($recent) >= 5) back('error=spam');
$recent[] = time();
@file_put_contents($bucket, implode(',', $recent), LOCK_EX);

$subject = 'Website enquiry: ' . $topic . ' (' . $name . ')';
$body = "New enquiry from the {$FIRM} website\n\n"
      . "Name:    {$name}\n"
      . "Email:   {$email}\n"
      . "Phone:   " . ($phone !== '' ? $phone : '-') . "\n"
      . "Topic:   {$topic}\n"
      . "Consent: yes (privacy notice)\n"
      . "Sent:    " . date('Y-m-d H:i T') . "\n\n"
      . "Message:\n{$message}\n";

$headers = [
    'From: ' . $FIRM . ' website <' . $FROM . '>',
    'Reply-To: ' . $email,
    'Content-Type: text/plain; charset=UTF-8',
];
$encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
$ok = @mail($TO, $encodedSubject, $body, implode("\r\n", $headers), '-f' . $FROM);

back($ok ? 'sent=1' : 'error=server');
