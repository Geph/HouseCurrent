<?php
declare(strict_types=1);
require __DIR__ . '/store.php';
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');

function hc_reply(int $status, array $value): never {
    http_response_code($status);
    echo json_encode($value, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

try {
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    $local = getenv('HOUSECURRENT_ALLOW_LOCAL_HTTP') === '1' && in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1','::1'], true);
    if (!$https && !$local) hc_reply(426, ['error'=>'Use HTTPS to view and edit Housecurrent.']);
    $directory=hc_private_dir();
    $db=hc_database($directory);
    $passwordHash=$db->query("SELECT value FROM settings WHERE key='password_hash'")->fetchColumn();
    if (!$passwordHash) hc_reply(503, ['error'=>'Administrator setup is required.']);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    $cookiePath=rtrim(str_replace('\\','/',dirname($_SERVER['SCRIPT_NAME'])), '/') . '/';
    session_name('hc_' . substr(hash('sha256', __DIR__),0,16));
    session_set_cookie_params(['lifetime'=>0,'path'=>$cookiePath,'secure'=>$https,'httponly'=>true,'samesite'=>'Strict']);
    session_start();
    if (!isset($_SESSION['csrf'])) $_SESSION['csrf']=bin2hex(random_bytes(32));
    $editable=isset($_SESSION['last_active']) && time()-(int)$_SESSION['last_active']<1800 && hash_equals(hash('sha256',$passwordHash),$_SESSION['credential_version'] ?? '');
    if ($editable) $_SESSION['last_active']=time();
    else unset($_SESSION['last_active']);
    $method=$_SERVER['REQUEST_METHOD'];
    $action=$_GET['action'] ?? '';
    if ($method==='GET' && $action==='state') hc_reply(200, hc_snapshot($db)+['editable'=>$editable,'csrf'=>$_SESSION['csrf']]);
    if ($method!=='POST') hc_reply(405, ['error'=>'Method not allowed.']);
    if (!hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) hc_reply(403, ['error'=>'Your session changed. Reload this page and try again.']);
    if (isset($_SERVER['HTTP_ORIGIN'])) {
        $origin=($https?'https://':'http://') . ($_SERVER['HTTP_HOST'] ?? '');
        if ($_SERVER['HTTP_ORIGIN']!==$origin) hc_reply(403, ['error'=>'Cross-site request rejected.']);
    }
    if (!str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''),'application/json')) hc_reply(415,['error'=>'Send JSON.']);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0)>5000000) hc_reply(413,['error'=>'Data is too large.']);
    $raw=file_get_contents('php://input', false, null, 0, 5000001);
    if (strlen($raw)>5000000) hc_reply(413,['error'=>'Data is too large.']);
    $body=json_decode($raw, true, 128, JSON_THROW_ON_ERROR);
    if (!is_array($body)) hc_reply(400,['error'=>'Invalid request.']);
    if ($action==='login') {
        $password=$body['password'] ?? '';
        if (!is_string($password) || strlen($password)>72) hc_reply(400,['error'=>'Invalid PIN.']);
        $client=hash('sha256',$_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $db->exec('BEGIN IMMEDIATE');
        $cleanup=$db->prepare('DELETE FROM login_attempts WHERE attempted_at < ?');$cleanup->execute([time()-900]);
        $query=$db->prepare('SELECT COUNT(*) FROM login_attempts WHERE client=?');$query->execute([$client]);
        if ((int)$query->fetchColumn()>=5 || (int)$db->query('SELECT COUNT(*) FROM login_attempts')->fetchColumn()>=50) {
            $db->exec('COMMIT');header('Retry-After: 900');hc_reply(429,['error'=>'Too many login attempts. Try again in 15 minutes.']);
        }
        $query=$db->prepare('INSERT INTO login_attempts(client,attempted_at) VALUES (?,?)');$query->execute([$client,time()]);$db->exec('COMMIT');
        if (!password_verify($password,$passwordHash)) hc_reply(401,['error'=>'Incorrect PIN.']);
        $query=$db->prepare('DELETE FROM login_attempts WHERE client=?');$query->execute([$client]);
        session_regenerate_id(true);
        $_SESSION['last_active']=time();$_SESSION['csrf']=bin2hex(random_bytes(32));$_SESSION['credential_version']=hash('sha256',$passwordHash);
        hc_reply(200,['ok'=>true]);
    }
    if ($action==='logout') {
        $_SESSION=[];session_regenerate_id(true);session_destroy();
        hc_reply(200,['ok'=>true]);
    }
    if (!$editable) hc_reply(401,['error'=>'Sign in to edit. If your session expired, sign out and sign in again.']);
    if ($action!=='save') hc_reply(404,['error'=>'Unknown action.']);
    hc_validate_state($body['state'] ?? null);
    if (!is_int($body['revision'] ?? null)) hc_reply(400,['error'=>'Missing data revision.']);
    $encoded=json_encode($body['state'], JSON_THROW_ON_ERROR);
    $db->exec('BEGIN IMMEDIATE');
    $current=hc_snapshot($db);
    if ($current['revision']!==$body['revision']) {
        $db->exec('ROLLBACK');hc_reply(409,['error'=>'Another browser saved newer data. Your form is still open; reload the latest data before applying your change again.']);
    }
    $revision=$current['revision']+1;
    $query=$db->prepare('INSERT INTO snapshots(revision,state,saved_at) VALUES (?,?,?)');$query->execute([$revision,$encoded,time()]);
    $query=$db->prepare('DELETE FROM snapshots WHERE revision < ?');$query->execute([$revision-20]);
    $db->exec('COMMIT');
    hc_reply(200,['revision'=>$revision]);
} catch (JsonException|InvalidArgumentException $e) {
    hc_reply(400,['error'=>'Invalid data: ' . $e->getMessage()]);
} catch (Throwable $e) {
    error_log('Housecurrent: ' . $e->getMessage());
    hc_reply(503,['error'=>'Housecurrent server is unavailable. Check the private setup and PHP error log.']);
}
