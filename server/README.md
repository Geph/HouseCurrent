# Housecurrent on DreamHost: public viewing, private editing

Target: **https://jeffginger.com/power/**

This version stores the shared household in SQLite on your VPS. Anyone can view it; only a signed-in administrator can save, restore, or remove records. The offline `Housecurrent.html` remains a separate browser-local editor.

## One-time installation

Requires PHP **8.1 or newer**, PDO SQLite, HTTPS, and SSH access for setup. Use the same DreamHost user for the website and setup command so PHP can write the private database. The supplied `.htaccess` is for Apache; core authentication and private data storage do not depend on hiding a button or on `.htaccess`.

1. Export a fresh JSON backup from your current local Housecurrent editor.
2. Extract `housecurrent-php-upload.zip`. Upload the contents of its `power` folder into the **power subfolder of jeffginger.com's web directory**. Include `.htaccess` if using Apache. Do not replace your main website homepage. If the previous static viewer is there, replace its files with this version.
3. Over SSH, go to that folder and run the setup below, replacing `USERNAME` with your DreamHost website user and adjusting the website directory if yours differs:

   ```sh
   cd /home/USERNAME/jeffginger.com/power
   php setup.php /home/USERNAME/housecurrent-power-private
   ```

4. Choose and repeat your own PIN at the private terminal prompts. Use 6–12 digits (0–9), with no letters or symbols. Do not put the password in a command argument, source file, GitHub, or this chat. On an interactive Unix terminal, password input is hidden. Only its password hash is saved.
5. Open **https://jeffginger.com/power/** and choose **Sign in to edit**.
6. Once signed in, use **Restore backup** to import your current JSON backup. This initial import replaces the starter records. Visitors never need to upload a file. Afterwards, add and adjust devices directly on the hosted site.

The default private directory is one level above PHP's `DOCUMENT_ROOT`, named `housecurrent-power-private`. For the example above, that is `/home/USERNAME/housecurrent-power-private`. **It must be outside every publicly served website directory.** If your server uses another document-root arrangement, set the PHP environment variable `HOUSECURRENT_PRIVATE_DIR` to the chosen absolute private path. The API rejects a directory inside its document root. Do not place the database, backups, or password hash in `/power` or another website folder.

Setup refuses to overwrite an existing installation. There is no public web setup page for someone else to claim. If the website reports a server error, check PHP's error log, permissions on the private folder, the PHP version, and whether PDO SQLite is enabled. Production API access requires HTTPS.

## Daily use

- Visitors open the link and see current shared records. Open public pages check for updates every 30 seconds while visible, except during sign-in.
- Sign in to add devices, one-time uses, locations, bills, or rate settings. The usual edit and remove controls appear after authentication.
- Saves complete on the server before the app confirms success. Signing out returns to public viewing.
- Sessions expire after 30 minutes without an API request. A stale editor cannot overwrite another tab's newer data: it receives a conflict message and keeps its form open. Copy any unsaved input, reload, and apply it to the latest records.
- Continue exporting JSON backups regularly. Restoring a backup replaces shared records for everyone. The database also retains the latest 21 saved revisions, but JSON export is the normal recovery and migration route; there is no revision-history interface yet.
- Local offline edits do not automatically synchronize with the hosted site. Once migrated, use the hosted app as your main editor to avoid divergent copies.

## Update the app

After source changes, run:

```sh
node build-server.mjs
```

Upload the newly generated files inside `hosted/power` over the existing `/power` files. Leave the private database directory alone; it holds your records and password hash independently of app updates. Do not rerun initial setup.

## Change or recover the editing PIN

Over SSH, run:

```sh
cd /home/USERNAME/jeffginger.com/power
php setup.php /home/USERNAME/housecurrent-power-private --reset-pin
```

Enter the new 6–12 digit PIN privately. Data is preserved, and existing editing sessions become invalid. After uploading this version, use this command once to replace an existing password with a PIN. Existing password hashes remain valid until reset; the login API keeps compatibility during that transition. Never reset by deleting the database.

## Protections and verification

Every write requires a valid, unexpired server session and a session-specific CSRF token. Login regenerates the session ID; production cookies are Secure, HttpOnly and SameSite=Strict. Passwords are hashed with PHP's password API. Login attempts are limited to five per source IP and fifty overall in 15 minutes. The server validates bounded data and stores revisions transactionally with an optimistic version check.

Local automated tests exercise anonymous write rejection, valid/invalid login, forged CSRF, cross-origin rejection, persistence, conflicting writes, logout, password-reset session revocation, malformed data, and login throttling. The browser flow was checked with a disposable local database. DreamHost installation, TLS, Apache headers and production file permissions still need to be verified on the VPS after upload. No production password or household data is included in the upload package.

Source implementation: `server/`, `build-server.mjs`, and `tests/server.test.mjs`. Run PHP integration tests by installing PHP with PDO SQLite locally and setting `HOUSECURRENT_PHP` to its executable if it is not on PATH. Without a suitable PHP runtime, `npm test` explicitly skips the PHP integration test; it still checks the generated JavaScript adapter and all energy calculations.
