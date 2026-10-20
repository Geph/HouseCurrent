<?php
declare(strict_types=1);
if (PHP_SAPI!=='cli') {http_response_code(404);exit;}
require __DIR__ . '/store.php';
if ($argc<2 || $argc>3 || ($argc===3 && !in_array($argv[2],['--reset-password','--reset-pin'],true))) {fwrite(STDERR,"Usage: php setup.php /home/USERNAME/housecurrent-power-private [--reset-pin]\n");exit(1);}
umask(0077);
$directory=$argv[1];
if (!is_dir($directory) && !mkdir($directory,0700,true)) throw new RuntimeException('Cannot create private directory.');
$db=hc_database($directory);
$configured=(bool)$db->query("SELECT value FROM settings WHERE key='password_hash'")->fetchColumn();
$reset=in_array($argv[2] ?? '',['--reset-password','--reset-pin'],true);
if ($configured && !$reset) {fwrite(STDERR,"Already configured. No password or data was changed. Use --reset-pin to change only the PIN.\n");exit(1);}
if (!$configured && $reset) {fwrite(STDERR,"Run initial setup first.\n");exit(1);}
$tty=PHP_OS_FAMILY!=='Windows' && function_exists('shell_exec') && function_exists('stream_isatty') && stream_isatty(STDIN);
function hc_read_secret(string $prompt,bool $tty): string {
    fwrite(STDOUT,$prompt);
    if ($tty) shell_exec('stty -echo');
    try {$value=trim(fgets(STDIN) ?: '');} finally {if($tty){shell_exec('stty echo');fwrite(STDOUT,"\n");}}
    return $value;
}
$password=hc_read_secret('Choose a PIN (6–12 digits): ',$tty);
$again=hc_read_secret('Repeat PIN: ',$tty);
if (!preg_match('/\A[0-9]{6,12}\z/',$password) || $password!==$again) {fwrite(STDERR,"PINs must match and contain 6–12 digits (0–9). Nothing configured.\n");exit(1);}
$state=json_decode(file_get_contents(__DIR__ . '/starter-state.json'), true, 128, JSON_THROW_ON_ERROR);
hc_validate_state($state);
$db->exec('BEGIN IMMEDIATE');
$query=$db->prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)');$query->execute(['password_hash',password_hash($password,PASSWORD_DEFAULT)]);
if (!$reset) {$query=$db->prepare('INSERT INTO snapshots(revision,state,saved_at) VALUES (1,?,?)');$query->execute([json_encode($state,JSON_THROW_ON_ERROR),time()]);}
$db->exec('COMMIT');
chmod($directory . '/housecurrent.sqlite',0600);
fwrite(STDOUT,$reset?"PIN changed. Household data preserved; previous editing sessions are invalid. Sign in with your new PIN.\n":"Configured. Open https://jeffginger.com/power/, sign in, then restore your current JSON backup once.\n");
