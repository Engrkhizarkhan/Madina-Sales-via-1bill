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

The narrower `clear-test-sales` operation preserves all users, crew, PC enrollments, recurring rosters and date-specific bus/time assignments. It clears test sales, reservations, refunds, expenses, shifts, vouchers and temporary print snapshots, reopens the retained daily departures and publishes a full client resync. Ticket reference sequences are retained to avoid reusing old printed references. Its backup is written and flushed before deletion. The manual **Sign an explicitly requested test-sales cleanup** workflow can sign this fixed action using the external release key without exposing that key to the VPS. It does not contact or clean a system by itself: an authorized operator must verify and place the short-lived, exact-installation/release command on the cloud, await acknowledgment/replication and remove it. A duplicate nonce cannot clear later sales or print jobs. This workflow never runs on pushes.

For a different-main-PC handover, the signed `prepare-main-pc-handover` action also revokes test device enrollments and durably fences the test server before cleanup. The old main stays fenced after restarts and internet loss. Only after an operator verifies its retirement nonce and that all source GTIDs reached the cloud may the root-only handover tool detach the old replica/tunnel. A persistent `require-main.json` guard keeps cloud bookings closed while the new main is being installed, even if unfinished setup is cancelled. The main admin can still sign in and download the fresh installer.


If the owner explicitly confirms that an unavailable **test** main PC has been uninstalled and its unsynced data can be discarded, root can use `discard-unavailable-test-main.py --confirm DISCARD-OLD-TEST-PC-AND-UNSYNCED-DATA`. It refuses a reachable main PC, backs up the cloud copy, revokes the old tunnel credentials and leaves external APIs closed. Finish by installing a verified release, explicitly clearing operational data while preserving the owner and route/bus/roster configuration, and restoring that release's production nginx template. This is an operator recovery procedure, never automatic failover or an ordinary update. New main and counter PCs must enroll again.

## Quiet counter refresh

The initial `/admin/bootstrap` returns one consistent snapshot and its `liveCursor`. Visible counters subsequently call `/admin/changes` every five seconds. The compact latest-change index contains opaque record IDs and revisions, not another copy of passenger data. Business writes and their change marker commit together; the locked revision row orders those commits. Reservation expiry and affected tickets after departure edits also publish changes. Rollbacks publish nothing. The reader uses one repeatable-read snapshot so it cannot mix a new cursor with older booking details.

Unchanged responses contain no history arrays. Changed responses contain affected bookings/runs plus deleted IDs; small catalog data is returned only when changed. Existing objects are preserved when identical, so editing, selected seats, dialogs and scroll are not reset. Background refresh does not spin the manual Refresh button, display timestamps, open receipts or print another counter's ticket. Connection errors remain visible; successful quiet refreshes have no status message. Restores, cleanup and large catch-up batches request one consistent full resync. The counter bootstrap and subsequent changes are scoped to the selected service date. Historical booking, passenger, reservation, expense and departure registers use server pages of 10, 20, 50 or 100 records. Finance totals are database aggregates over the chosen date range. Printed departure reports fetch the complete service date separately, so pagination cannot truncate a CNIC sheet or voucher. Legacy clients without a date keep their original response during rolling updates until staff press Update.

Daily and pre-update SQL backups retain seven days. This does not remove tickets from the live database or shorten the main PC's replication binlog retention.


## MadinaExpress.pk migration

The canonical passenger host is https://madinaexpress.pk and remote staff use https://staff.madinaexpress.pk/login. The direct certificate-authenticated terminal endpoint is https://terminal.madinaexpress.pk. Provision and verify its HTTPS certificate before publishing the migration. Retire previous compatibility hosts only after the main PC reports the accepted release through the new endpoint.

The accepted release's privileged Windows migration entrypoint updates only the protected cloud origin and allowed web origins in config/backend.env and host/updater.json. It runs under the existing SYSTEM updater while the app is stopped. Original configuration copies are retained as .pre-pk files. Local IP, database settings, authenticator secrets, enrollment certificates, browser profiles and scheduled tasks are preserved. Each replacement is flushed before rename, interrupted partial switches are repeatable, and no database data is reset. The main app and updater can fail over between the approved terminal and staff hosts. Updater telemetry records the hostname that received its authenticated report; local health exposes the configured cloud origin.

Before publishing a domain migration: verify the new DNS and certificate, configure both public/staff virtual hosts, keep APIs and signed packages uncached, test existing-domain access and new-domain requests, and run isolated application/update tests. After installing: verify the main-PC health cloudOrigin, update telemetry through the new hostname, replication and public/staff pages. Child PCs retain their existing LAN shortcuts and enrolled profiles.

Receipt design also allows the booking website caption, text size, boldness and left/center/right alignment to be saved for all counters. Older clients' complete receipt settings acquire defaults for these new fields.

For an existing counter connection that cannot download a full release within its timeout, an explicitly selected configuration bridge can reuse an exact previously signed release. `package-domain-bridge.mjs` verifies that release's signature, archive hash and unchanged schema, then signs only the fixed domain migration and updater/proxy support. It accepts no SQL, shell command or data reset input. `materialize-bridge.mjs` verifies every overlay file and the cached original archive before filling the release directory. If the ZIP cache has expired, it may use the installed base only when its complete file-tree digest matches the signed original. Corrupt, missing or modified code is refused. Host/config and business data are outside materialization. Ordinary full releases do not perform this operation. The operator materializes the same accepted bridge on the cloud before publishing its channel, verifies the main PC migrated, then returns the publisher to full releases.

Counter connection status is shown in Settings → Counter connections. Enrolled browsers send a small startup/ready contact every 15 seconds, plus a bounded 96 KiB file sample once per minute while visible. Identity comes from the existing client certificate, not a submitted PC number. The main stores a bounded set of contacts per PC and replicates it to the cloud; no ticket or payment data is added to contacts. Missing contacts become stale after 90 seconds. A closed/sleeping browser is not proof that a PC is powered off. When the main cannot be reached, cloud status is explicitly last-known/unknown. Quality bars are response/transfer measurements, not radio signal or negotiated Ethernet speed.

Voucher design is independent of ticket design, with compact defaults, font, spacing and optional passenger net amounts. Collection totals remain visible. Ticket marketing has separate font, size, bold, alignment, border, padding and inverted black/white options. Sizes accept positive finite values without preset upper limits; padding accepts zero. The print-job transfer accepts only these inert style variables and rejects arbitrary CSS/URLs.

Full releases include the Windows Node v22.23.5 executable downloaded from the official vendor and verified against its pinned SHA-256 before signing. The privileged migration verifies it again and installs it beside the existing runtime. Protected launchers and the next scheduled updater use the versioned executable; the running updater is never overwritten. Existing runtime and database files are retained for recovery. A failed runtime verification leaves launchers unchanged. The configuration-only bridge intentionally performs no runtime update. Fresh main-PC installers pin the same Node patch release.

## Sales reports and individual PC printing (3.6.0)

Finance → ticket sales supports collection or travel dates, grouped by day, route, bus/vehicle, selling account, authenticated counter PC or booking source. Counts represent first paid issue, including tickets later refunded; refunds use their own transaction dates with collection-date reporting. Public reservations retain Public web origin after counter collection, while the selling PC/account is recorded separately. Recorded commissions are already included in expenses, not subtracted twice. Departure settlements show saved voucher deductions, money after costs and after driver handover; changed collections require reviewing the voucher. Finance PIN and existing access controls remain required.

The main owner can use Settings → Receipt configuration → Print settings for each PC. Enable central settings for a PC, then independently choose Auto-print after payment and Show ticket preview. Both on prints and leaves the preview open; auto only prints without preview; preview only waits for Print; neither saves without opening or printing slips. The collection response includes the current policy for the authenticated device, so a previously open browser uses the latest saved switches. Unmanaged PCs retain their browser preferences. A failed print never retries the sale or automatically duplicates slips.

Thermal printing still needs the installed Counter shortcut/profile for silent Chrome/Firefox operation, or compatible direct USB access. Regular browser security cannot be bypassed by a website checkbox. A4 reports keep their existing printer-selection flow. The Epson path accepts the supported vendor/product ID regardless of the operating system product label, selects a bulk output alternate interface, sends long images in bounded raster bands, serializes device access and cuts after each slip. A browser/driver that denies USB access reports the installed-driver Counter printing alternative. Physical paper/cutter behavior must be checked on the connected printer.

Refunds accept paisa (minimum PKR 0.01), subject to remaining paid balance and owner-configured staff limits. Staff seat hover/focus shows passenger contact and creation/sale times; these details are never added to the public seat map. Reserved seats use gray with the R marker; female and web indicators remain distinct. Roster History/Departed uses only its From/To range, independent of the day selector.

Roster → Deleted lists archived schedules. Restore schedule requires explicit confirmation and roster-management permissions, reactivates the same ID and retains every ticket, reservation and dated departure state. Deleted/inactive routes, retired/deleted buses and conflicting bus/crew assignments must be resolved first. Restoration is audited and shared through the live catalog.
