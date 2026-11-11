# Main PC and two child PCs

The main Windows PC is the booking authority for all three counters. Its local MySQL database remains available when the internet fails. A restricted outbound SSH tunnel forwards cloud requests to that PC and copies committed transactions to a read-only cloud database using MySQL GTIDs. There is one writer at all times; the cloud is never automatically promoted during an outage.

The cloud deployment only prepares installer support. **Offline operation starts after the installer has successfully activated on the actual Windows PC.** No Windows PC was available for installation during development.

## Before installation

Windows 11 is preferred for a new setup. Keep Windows 10 covered by applicable ongoing security updates, such as Extended Security Updates (ESU); regular Home/Pro support ended in October 2025. See [Microsoft lifecycle guidance](https://support.microsoft.com/en-us/windows/deployment/updates-lifecycle/what-does-it-mean-if-windows-isn-t-supported).

- Use 64-bit Windows 10 version 1809 or later, or Windows 11, with Windows PowerShell 5.1 on the main PC. Windows 7/8 cannot host this server. One of the Windows 10 counter PCs can host it while continuing to serve as a counter. Keep it powered on, connected by Ethernet, and awake during counter hours. A UPS for it and the router is recommended.
- Connect all three PCs to the same trusted router/LAN. They need no internet connection to reach each other.
- Reserve the main PC's IPv4 address in the router's DHCP settings. Run `ipconfig` to find it. The installer checks that the supplied private address belongs to the main PC and embeds it in HTTPS and child setup files.
- The main PC installer needs administrator elevation and internet for the first installation. Allow roughly 3 GB for downloaded runtimes, installation and initial data; additional space is needed for the database, logs, 30 daily backups and binary logs. Keep at least 10 GB free and monitor usage.
- Child PCs also need Windows 10/11 and PowerShell 5.1. Upgrade a Windows 7 PC before enrolling it. Child PC enrollment uses the Windows TPM and a non-exportable key in the counter's Windows user profile. Enable TPM if enrollment reports it is unavailable. Do not copy certificates or share exported private keys.
- Finish or pause counter work during initial transfer. Downloading the installer alone changes no booking authority. Starting data transfer pauses cloud writes until activation finishes.

## Install the main PC

1. Sign in to [staff Settings](https://staff.madinaexpress.duckdns.org/manage) as admin. The existing authenticator is enabled again; use its current six-digit code.
2. Open **Settings → Main PC & offline access**. Enter the current admin password and download the main PC installer ZIP.
3. Copy it to the main Windows PC and extract it. Run `Install-Main-PC.cmd`, approve Windows elevation, enter the local IPv4 address, and type `YES` to begin.
4. The installer verifies runtime checksums, creates protected application/data directories, installs a loopback-only MySQL service, imports the current cloud data, creates local HTTPS certificates and starts the server under Windows LocalService at startup. It does not expose MySQL to the LAN.
5. Set this trusted LAN connection to **Private** in Windows network settings. The installed firewall rule permits local subnet access to TCP 8443 on Private networks only. Do not forward 8443 or MySQL ports through the router.
6. Open the local URL printed by the installer, for example `https://192.168.1.20:8443/login`. First activation needs the cloud connection to complete. If it says setup is finishing, wait and refresh.
7. Sign in as admin with your password and authenticator. In Settings, check **Cloud connected** and that the cloud copy is syncing. All counters must use this local address, including while internet is working.
8. The installer ZIP contains installation credentials. Keep it in an administrator-only location while resolving setup, then delete downloaded setup copies after successful installation. The installed credentials stay protected in ProgramData.

## Enroll PC 1, PC 2 and PC 3

1. From the **local** Settings page, enter the admin password and generate **PC 1 setup** for the counter profile on the main PC. Generate separate **PC 2 setup** and **PC 3 setup** files for the two child PCs. Each file expires after 30 minutes and works once.
2. Extract each ZIP on its matching PC. Sign in to the Windows user profile actually used at that counter and run `Install-Terminal-PC.cmd` normally. Do not run it under a different administrator profile.
3. The main IP is already included. Press Enter to accept it. Setup installs the local public CA certificate, creates a TPM-backed client key, enrolls it with the main PC and creates a **Madina Express Counter** desktop shortcut.
4. Open that shortcut and select the terminal certificate if Chrome asks. Set the thermal printer as the Windows default printer. The shortcut uses a separate Chrome profile with kiosk printing for silent ticket slips. Open the same local address in regular Firefox for A4 reports that need a print dialog.
5. Create staff usernames/passwords in **Settings → Staff access**. Any staff account can use any of the three approved PCs in its enrolled Windows profile. Those passwords alone cannot sign in from a personal computer. Admin access works remotely while the main PC has internet.
6. Use **Revoke access** to remove a lost/replaced PC immediately. Generate a new setup file for its slot and enroll the replacement. New enrollment also invalidates the previous certificate and its staff sessions.

A child installer only accepts the main IP embedded by the main installation. It cannot silently redirect a trusted certificate to a different server. Keep the original reserved IP. An IP change requires an administrator-assisted certificate/configuration update and regenerated child installers.

If setup reports "The remote name could not be resolved", download a fresh installer ZIP from the staff site and extract it into a new folder. Current installers use the staff hostname for runtime downloads and cloud synchronization. Keep the original installation data in ProgramData when retrying; verified runtime downloads are reused.

## Test at the terminal

- From all three shortcuts, open the same date/departure. Make a reservation on PC 2 and check it appears on PC 1 and PC 3 after the seat refresh (within about five seconds).
- Disconnect the router's **internet/WAN** cable, keeping the router and LAN running. Create a reservation and collect a payment locally. Verify the other two PCs see the seat; check the local-operation notice.
- Check the public website from a phone using mobile data: timetable/lookup may show the last synchronized information, and new public reservations must be unavailable during the outage.
- Reconnect internet. Settings should return to cloud connected and the replication lag should fall to zero. Confirm the public lookup sees the new ticket after synchronization.
- Reboot the main PC, wait for its services, then confirm all counters can sign in again. Test thermal ticket cuts and A4 printing on the physical printers.
- If a child PC cannot reach the local URL, check the main PC is awake, the IP has not changed, Windows network is Private, and the PCs are not on an isolated guest Wi-Fi network.

## Backups, logs and recovery

- Main PC daily SQL backups: `C:\ProgramData\MadinaExpress\data\backups` (30 days). Cloud SQL backups retain 30 days under `/var/backups/madina-express`.
- Main server log: `C:\ProgramData\MadinaExpress\logs\server.log`; MySQL logs/data: `data\mysql`. The scheduled task is **Madina Express Terminal Server**; database service is **MadinaTerminalMySQL**.
- Cloud logs remain under PM2: `ssh root@62.171.173.11 'pm2 logs --nostream'`.
- Main PC binary logs retain 30 days. If cloud replication is disconnected for longer than that, or Settings reports a replication error, do not clear logs or force writes on the cloud. An administrator must create a fresh consistent replica seed.
- An internet outage is supported; a failed/switched-off main PC is not. Keep an encrypted backup copy on a separate disk. Replacing a failed main PC requires an administrator-led restore and replication check; do not run a fresh installer over existing live data or allow both machines to sell seats.
- Local HTTPS/server and terminal certificates last one year; the private local CA lasts five years. Arrange renewal before expiry. Renew client certificates by generating/re-running the appropriate PC setup. Server certificate renewal must preserve the existing CA and IP; do not regenerate the CA on a live installation.
- Initial installation failure: preserve ProgramData and rerun the same installer on the same PC. It retains its tunnel key and installation ID. If the cloud remains paused before activation, an administrator can cancel the transfer through SSH using the restricted helper's `abort` action and the installation ID from the protected state file. Never abort after activation or promote the cloud without verifying the authoritative data.

## Updates

Once active, `deploy/update.sh` refuses the old cloud-only database install path. Use a coordinated maintenance window: back up the main PC, pause sales, update its application with the same build as the cloud, apply required schema migrations on the **main source** only, let them replicate, update cloud static/API code, then resume. Do not run cloud seed/reset scripts on the replica. This release supplies first-install and enrollment tools; automated rolling updates and automatic failover are not included.

## Verification performed by development

JavaScript certificate/relay/device tests, isolated API and booking workflow tests, MySQL source/replica outage-and-reconnect tests, frontend build/lint, dependency audit, and installer PowerShell syntax parsing are run before release. These do not replace the physical Windows/LAN/printer acceptance steps above.

The database topology follows [MySQL GTID replication](https://dev.mysql.com/doc/refman/8.0/en/replication-gtids.html); portable MySQL service installation follows [MySQL Windows services](https://dev.mysql.com/doc/refman/8.0/en/windows-start-service.html).

## Testing Nginx configurations safely

Alternate Nginx test instances must set their own PID, proxy/body/cache temporary paths and worker user. Do not let a test instance use the production `/var/lib/nginx` paths: Nginx can change their ownership while starting or checking configuration. Production API downloads stream without proxy disk buffering. If a browser reports a content-length mismatch, inspect the Nginx error log and temporary-directory ownership before retrying.
