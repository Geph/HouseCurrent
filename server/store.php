<?php
declare(strict_types=1);

function hc_private_dir(): string {
    $root = realpath($_SERVER['DOCUMENT_ROOT'] ?? __DIR__);
    $directory = getenv('HOUSECURRENT_PRIVATE_DIR') ?: dirname($root ?: __DIR__) . '/housecurrent-power-private';
    if (!is_dir($directory) || !is_writable($directory)) throw new RuntimeException('Run the private CLI setup before using this site.');
    $resolved = realpath($directory);
    $inside = str_replace('\\', '/', strtolower($resolved ?: '')) . '/';
    $public = str_replace('\\', '/', strtolower($root ?: __DIR__)) . '/';
    if (str_starts_with($inside, $public)) throw new RuntimeException('The data directory must be outside the website directory.');
    return $resolved;
}

function hc_database(string $directory): PDO {
    $db = new PDO('sqlite:' . $directory . '/housecurrent.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout=5000');
    $db->exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS snapshots (revision INTEGER PRIMARY KEY, state TEXT NOT NULL, saved_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY, client TEXT NOT NULL, attempted_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS attempts_time ON login_attempts(attempted_at)');
    return $db;
}

function hc_validate_state(mixed $state): void {
    if (!is_array($state) || ($state['version'] ?? null) !== 1) throw new InvalidArgumentException('Invalid Housecurrent backup version.');
    foreach (['devices'=>1000,'rooms'=>200,'bills'=>1000,'solarReadings'=>10000] as $key=>$max) {
        if (!isset($state[$key]) || !is_array($state[$key]) || !array_is_list($state[$key]) || count($state[$key])>$max) throw new InvalidArgumentException('Invalid ' . $key . ' list.');
    }
    foreach (['summerPeak','summerOff','winterPeak','winterOff','summerFlat','winterFlat'] as $key) hc_number($state['rates'][$key] ?? null, 0, 10);
    $deviceIds=[];
    foreach ($state['devices'] as $device) {
        if (!is_array($device) || !is_string($device['id'] ?? null) || !trim($device['id']) || isset($deviceIds[$device['id']]) || !is_string($device['name'] ?? null) || !trim($device['name']) || strlen($device['name'])>400 || !in_array($device['source'] ?? '', ['grid','solar','mixed'], true)) throw new InvalidArgumentException('Invalid device.');
        $deviceIds[$device['id']]=true;
        if (!in_array($device['mode'] ?? '', ['schedule','measured','event'], true)) throw new InvalidArgumentException('Invalid device mode.');
        if (isset($device['watts'])) hc_number($device['watts'],0,1000000);
        if ($device['mode']==='schedule') {
            hc_number($device['watts'] ?? null,0,1000000);hc_number($device['idleWatts'] ?? 0,0,$device['watts']);hc_number($device['hours'] ?? null,0.01,24);hc_time($device['startTime'] ?? null);
            if (!is_array($device['days'] ?? null) || !array_is_list($device['days']) || !count($device['days']) || count($device['days'])>7) throw new InvalidArgumentException('Choose run days.');
            foreach ($device['days'] as $day) if (!is_int($day) || $day<0 || $day>6) throw new InvalidArgumentException('Invalid run day.');
            if (isset($device['nightTime']) && !is_bool($device['nightTime'])) throw new InvalidArgumentException('Invalid nighttime selection.');
            if (isset($device['summerHours']) || isset($device['summerStartTime'])) {hc_number($device['summerHours'] ?? null,0.01,24);hc_time($device['summerStartTime'] ?? null);}
        } elseif ($device['mode']==='event') {
            hc_interval($device);hc_number($device['kwh'] ?? null,0,1000000000);hc_number($device['efficiency'] ?? null,0.1,100);
            if (!in_array($device['basis'] ?? '',['wall','delivered'],true) || !in_array($device['timing'] ?? '',['unknown','off','peak'],true) || !in_array($device['inputMode'] ?? 'kwh',['kwh','continuous'],true)) throw new InvalidArgumentException('Invalid energy entry settings.');
            if (($device['inputMode'] ?? '')==='continuous') hc_number($device['watts'] ?? null,0,1000000);
        } else {
            $logs=$device['logs'] ?? [$device];
            if (!is_array($logs) || !array_is_list($logs) || count($logs)>10000) throw new InvalidArgumentException('Invalid measured intervals.');
            foreach ($logs as $log) {hc_interval($log);hc_number($log['kwh'] ?? null,0,1000000000);if(isset($log['peakKwh']))hc_number($log['peakKwh'],0,$log['kwh']);}
            usort($logs,fn($a,$b)=>strcmp($a['start'],$b['start']));
            for($i=1;$i<count($logs);$i++)if($logs[$i]['start']<$logs[$i-1]['end'])throw new InvalidArgumentException('Measured intervals cannot overlap.');
        }
    }
    $locations=[];$colors=[];
    foreach ($state['rooms'] as $room) {
        if (!is_string($room['name'] ?? null) || !trim($room['name']) || !preg_match('/^#[0-9a-f]{6}$/i', $room['color'] ?? '')) throw new InvalidArgumentException('Invalid location.');
        $key=strtolower(trim(preg_replace('/\s+/',' ',$room['name'])));$color=strtolower($room['color']);
        if(isset($locations[$key]) || isset($colors[$color]))throw new InvalidArgumentException('Location names and colors must be unique.');
        $locations[$key]=true;$colors[$color]=true;
    }
    foreach($state['devices'] as $device){$key=strtolower(trim(preg_replace('/\s+/',' ',$device['room'] ?? '')));if($key!==''&&!isset($locations[$key]))throw new InvalidArgumentException('Choose a defined location.');}
    foreach($state['bills'] as $bill){hc_interval($bill);hc_number($bill['kwh'] ?? null,0,1000000000);hc_number($bill['peakKwh'] ?? null,0,$bill['kwh']);hc_number($bill['total'] ?? null,0,1000000000);if(isset($bill['energy']))hc_number($bill['energy'],0,$bill['total']);}
    foreach($state['solarReadings'] as $reading){hc_date($reading['date'] ?? null);hc_number($reading['kwh'] ?? null,0,1000000000);}
    if (!is_array($state['solar'] ?? null)) throw new InvalidArgumentException('Missing solar settings.');
    if(!in_array($state['solar']['kind'] ?? '',['ac','dc','unknown'],true))throw new InvalidArgumentException('Invalid solar meter type.');
    if(isset($state['solar']['efficiency']))hc_number($state['solar']['efficiency'],0.1,100);
    if(isset($state['nightHours']))foreach(['winter','summer'] as $season){$start=$state['nightHours'][$season.'Start'] ?? null;$end=$state['nightHours'][$season.'End'] ?? null;hc_time($start);hc_time($end);if($start===$end)throw new InvalidArgumentException('Nighttime start and end must differ.');}
}

function hc_time(mixed $value): void {if(!is_string($value)||!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/',$value))throw new InvalidArgumentException('Invalid schedule time.');}
function hc_date(mixed $value): void {if(!is_string($value)||!preg_match('/^\d{4}-\d{2}-\d{2}$/',$value)||!($date=DateTimeImmutable::createFromFormat('!Y-m-d',$value))||$date->format('Y-m-d')!==$value)throw new InvalidArgumentException('Invalid reading date.');}
function hc_interval(array $entry): void {hc_date($entry['start'] ?? null);hc_date($entry['end'] ?? null);if($entry['start']>=$entry['end'])throw new InvalidArgumentException('Ending date must follow starting date.');}

function hc_number(mixed $value, float $min, float $max): void {
    if ((!is_int($value) && !is_float($value)) || !is_finite((float)$value) || $value<$min || $value>$max) throw new InvalidArgumentException('Invalid numeric value.');
}

function hc_snapshot(PDO $db): array {
    $row=$db->query('SELECT revision,state FROM snapshots ORDER BY revision DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
    if (!$row) throw new RuntimeException('Initialize the data with the CLI setup.');
    return ['revision'=>(int)$row['revision'],'state'=>json_decode($row['state'], true, 128, JSON_THROW_ON_ERROR)];
}
