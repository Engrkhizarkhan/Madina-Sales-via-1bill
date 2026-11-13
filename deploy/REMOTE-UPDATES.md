# Remote application updates

Install the current main-PC ZIP once on Windows 10/11. It includes a separate, protected updater. Future application releases do not reinstall MySQL, reset data, or enroll the counter PCs again.

## Publishing from home

Push reviewed application changes to `main`. The **Test and publish application release** workflow runs application, booking and update recovery tests plus Windows PowerShell/service checks. The publish job runs only after both test jobs succeed. It produces a signed package and GitHub release named `r-<commit>`.

The cloud checks the signed release channel every two minutes, without requiring inbound access to the terminal or a GitHub token on the customer's PC. The main PC checks the cloud once a minute. It downloads and verifies a release, waits for at least 60 seconds without a write, drains new business writes, takes a database backup, applies pending migrations and switches application directories. The protected journal allows recovery after a restart. A failed health check restores the previous application; it never restores an old database over newly issued tickets.

During installation, the app displays an update-in-progress response to new writes. Source API and HTTPS health must both pass before normal writes resume. During downloads or an internet outage, the existing application continues working. An update waits for internet rather than switching booking authority to the cloud.

The main admin can pause future installations in **Settings → Application updates**. An installation already in progress finishes its safe transaction. Settings shows the current cloud version, available release and last main-PC report. The sidebar shows the running frontend's version and commit. Existing browser tabs get a refresh notice after the server changes; their current forms are not forcibly reloaded. Shared assets preserve lazy-loaded receipt/PDF files across release changes.

## What is protected

- Ed25519 signatures establish release authority; SHA-256/size checks detect incomplete downloads. Both are checked before extraction.
- The release public key is pinned in the initial installer. The private key is stored in GitHub Actions secret `MADINA_RELEASE_SIGNING_KEY`; a recovery copy on the developer Mac is under `~/.config/madina-express`, mode 0700/0600. Never put the private key in Git or a client installer.
- The verifier checks the project, commit, monotonically increasing release sequence, expiry and safe archive paths. It rejects unsigned packages and unreviewed destructive schema changes.
- The Windows app runs as LocalService. Application/updater code and the release pointer are read-only to it. The separate update task runs as SYSTEM and accepts signed application packages, not cloud-provided shell commands.
- LocalService cannot read MySQL administrator credentials. App configuration, private data, TLS keys and backups are separate from versioned code.
- An account/API compromise can pause updates or affect application data according to its permissions; it does not supply the release signing key. Protect the GitHub account and main branch.

## Database and cloud coordination

New migrations must be additive and idempotent, carry `-- release: additive`, and keep the previous application compatible for rollback. Applied migration hashes are recorded; modifying an already applied migration fails the release update. A schema change that cannot preserve old-code compatibility needs a supervised maintenance plan.

When the Windows PC is the source, it applies migrations there. MySQL replicates those changes. The cloud waits for the expected source release and migration hashes before switching its own code. It never runs seed/reset scripts on the replica. The legacy migrations are baselined rather than replayed, because some historical conversions modify ticket data.

Future 1Bill integration can use this same release process without a terminal visit. Provider credentials and payment enablement need their own protected configuration; they are not embedded in release ZIPs. Online payments require internet and must be tested for duplicate/retried callbacks before enabling them. Until then, the public portal remains reservation-only.

## Recovery and logs

Windows protected updater: `C:\ProgramData\MadinaExpress\host`.
Current application pointer: `host\current.json`.
Updater output: `host\updater-out.log`, `host\updater-error.log`.
App output: `logs\server.log`, `logs\server-error.log`.
Pre-update backups: `backups\pre-update-*.sql.gz` (7 days); daily backups remain under `data\backups`.

Cloud: `journalctl -u madina-release-update.service`, `madina-pm2 logs --nostream`, `/var/lib/madina-express/host/current.json`.

A failed release is not repeatedly installed. Fix it and push a new tested commit. If Windows or MySQL itself needs an upgrade, treat that as separate maintenance; ordinary application releases do not replace those runtimes. Verify physical Windows/LAN/printer operation before accepting live tickets. Windows 10 must receive applicable ongoing security updates.

## Explicit production preparation

Ordinary updates never delete operational data. An owner can explicitly request cleanup using the password/CSRF-protected maintenance endpoint. An operator can also deliver the fixed `clear-test-data` operation through the existing authenticated terminal status channel, signed by the external release key. The signed payload must name the exact installation, accepted release, protected main administrator, a unique nonce and an expiry within 15 minutes. It accepts no SQL or shell commands. A cloud API compromise cannot manufacture a valid signature.

Cleanup waits for in-flight counter writes, takes a protected recovery snapshot and deletes bookings, payments, refunds, expenses, shifts, date-specific run history, test crew and other user accounts. It preserves the named main administrator, configured routes, buses, recurring rosters, settings and enrolled PCs. An applied nonce is committed in the same transaction as deletion, so repeated delivery after a reconnect cannot erase subsequent sales. The operator verifies the cloud has replicated the result and removes the signed request. Recovery snapshots expire with local backup retention after 7 days.

For a different-main-PC handover, the signed `prepare-main-pc-handover` action also revokes test device enrollments and durably fences the test server before cleanup. The old main stays fenced after restarts and internet loss. Only after an operator verifies its retirement nonce and that all source GTIDs reached the cloud may the root-only handover tool detach the old replica/tunnel. A persistent `require-main.json` guard keeps cloud bookings closed while the new main is being installed, even if unfinished setup is cancelled. The main admin can still sign in and download the fresh installer.


If the owner explicitly confirms that an unavailable **test** main PC has been uninstalled and its unsynced data can be discarded, root can use `discard-unavailable-test-main.py --confirm DISCARD-OLD-TEST-PC-AND-UNSYNCED-DATA`. It refuses a reachable main PC, backs up the cloud copy, revokes the old tunnel credentials and leaves external APIs closed. Finish by installing a verified release, explicitly clearing operational data while preserving the owner and route/bus/roster configuration, and restoring that release's production nginx template. This is an operator recovery procedure, never automatic failover or an ordinary update. New main and counter PCs must enroll again.

## Quiet counter refresh

The initial `/admin/bootstrap` returns one consistent snapshot and its `liveCursor`. Visible counters subsequently call `/admin/changes` every five seconds. The compact latest-change index contains opaque record IDs and revisions, not another copy of passenger data. Business writes and their change marker commit together; the locked revision row orders those commits. Reservation expiry and affected tickets after departure edits also publish changes. Rollbacks publish nothing. The reader uses one repeatable-read snapshot so it cannot mix a new cursor with older booking details.

Unchanged responses contain no history arrays. Changed responses contain affected bookings/runs plus deleted IDs; small catalog data is returned only when changed. Existing objects are preserved when identical, so editing, selected seats, dialogs and scroll are not reset. Background refresh does not spin the manual Refresh button, display timestamps, open receipts or print another counter's ticket. Connection errors remain visible; successful quiet refreshes have no status message. Restores, cleanup and large catch-up batches request one consistent full resync. Historical data is still loaded once on entry for the existing history/finance views; server pagination of those views remains a separate improvement as history becomes large.

Daily and pre-update SQL backups retain seven days. This does not remove tickets from the live database or shorten the main PC's replication binlog retention.
