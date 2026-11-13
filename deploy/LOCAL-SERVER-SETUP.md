# Madina Express: test here, then move to the terminal

## Main admin

Open https://staff.madinaexpress.duckdns.org/login on a phone or laptop. Use username **admin**, the existing password, and the current authenticator code. Do not enter an email address. The old main-PC pairing has been revoked; download a fresh installer.

The main admin is exempt from counter-PC restrictions. Staff need an account created by the admin and an enrolled Windows profile on one of the three counter PCs. The main PC can also serve as counter PC 1.

## Install on the supplied PC

1. Use a 64-bit Windows 10 version 1809 or newer, or Windows 11, with PowerShell 5.1. Install current Windows security updates. Initial setup requires internet and Windows administrator access.
2. Connect the main PC to the router by Ethernet. In Windows network settings, mark this trusted connection **Private**. Run `ipconfig` and note the Ethernet IPv4 address; reserve that address in the router.
3. Sign in to the staff website. Open **Settings → Main PC & offline access**, enter the admin password and download the main PC installer. Extract the entire ZIP; keep the extracted folder.
4. Run **Install-Main-PC.cmd**, approve Windows elevation, and enter the main PC's IPv4 address. Let runtime downloads, database import and service startup finish. If a former installation is found, setup only permits a fresh reset before cloud activation and requires typing `RESET`; the former installation is archived.
5. Open the HTTPS local address printed by setup. Sign in as admin. In local Settings, create **PC 1 setup** and run it in the Windows profile used for counter work. TPM is preferred. For an older PC without TPM, check **Allow this PC without TPM** before downloading its setup. This approves a non-exportable Windows software key for that download only; setup still tries TPM first. Software keys offer less protection against a local Windows administrator. Use standard Windows accounts for staff.
6. On each other Windows 10/11 PC, connect to the same LAN, generate its own PC 2/3 setup ZIP, extract and run it in that counter's Windows profile. Setup files expire after 30 minutes. Use the **Madina Express Counter** desktop shortcut; Chrome may request the enrolled terminal certificate.
7. Create staff usernames/passwords in Settings. Test staff login on an enrolled PC and rejection on a personal device.

Terminal-only accounts may use a password/PIN of at least four characters. Keep staff Windows profiles protected; the enrolled device/profile is still required. Accounts approved for remote login need 12+ characters with upper-case, lower-case, a number and a symbol. Enabling remote access on a terminal-only account requires setting a strong new password. The main admin's password and authenticator requirements are unchanged.

Deleting staff revokes access and releases their username/email for reuse. Historical records retain the former account ID and name; recreating a login creates a fresh account and does not restore old sessions, MFA or permissions. Older deleted accounts release their identifiers when the main admin reuses them.

Compatibility approval is stored on the server against the one-use enrollment token and recorded in the audit log. Editing the downloaded setting cannot authorize a reported Windows software key by itself. The provider reported by the managed installer is not remote hardware attestation; these installations do not cryptographically prove TPM residency to the server. A malicious administrator on an enrolled PC is outside the ordinary staff-password restriction. Protect Windows administrator credentials and revoke a PC in Settings if it is lost or compromised.

Setup also installs the signed application update service. Tested releases from GitHub install automatically during quiet periods; the main admin can pause them in Settings. The sidebar shows the running version. See [remote updates](REMOTE-UPDATES.md).

The app starts automatically after reboot. Keep the main PC awake and powered on. No inbound router port forwarding is required. MySQL listens only on loopback; only HTTPS port 8443 is exposed to the private local subnet.

## Move the same PC to the terminal

Keep its data and installation. Connect to the terminal router, mark the trusted Ethernet connection Private, and reserve its new IPv4 address. From the retained setup folder, run **Change-Main-PC-Network.cmd** as Administrator and enter the new address. It replaces only the server certificate/address and preserves the database, private CA, admin and device enrollments.

On already enrolled child PCs, run **Change-Terminal-PC-Address.cmd**, enter the main PC's new IP, close the existing counter Chrome windows and open the updated desktop shortcut. Newly added PCs use a fresh PC setup ZIP from local Settings.

## Confirm before live use

- Reboot the main PC and verify `https://localhost:8443/login` and its LAN HTTPS address both work.
- From a second PC, issue a test ticket and verify the other screen updates and cannot sell the same occupied seat.
- Disconnect the router's internet connection while keeping LAN connected. Book, reserve and refund locally; reconnect internet and check cloud counts/payment totals agree.
- From a phone using mobile data, sign in as main admin with MFA. When the main PC is connected, full operations are available. If it is offline or setup is incomplete, the cloud allows login and viewing the last synced data, and blocks changes to prevent conflicting bookings. A cloud-only offline session may require signing in again after the main PC reconnects.
- Print the receipt/token through the counter shortcut and check both cuts. Check the separate A4 voucher/CNIC dialog.
- Confirm local backups exist in `C:\ProgramData\MadinaExpress\data\backups`; backups are made daily and retained for 30 days. Back up to separate storage as well; backups on the same disk cannot protect against disk failure.

## Troubleshooting

The four signal bars beside the account avatar show measured response speed. Four bars mean under 250 ms, three under 750 ms, two under 1500 ms, and one slower; zero means unavailable or still checking. The reading smooths recent browser-to-server and main-PC-to-cloud response times. Click the icon for the current milliseconds and sync details. The small status dot is green when synced, amber while catching up, and red for offline/sync errors. Local counters continue through their Counter shortcut during a WAN outage; the cloud URL requires internet. The main admin can view the cloud's last synced copy while the terminal is offline.

After internet returns, authenticated main-PC status checks probe the actual forwarded API. Two failed probes cause the dedicated tunnel connection to reopen, with a 30-second recovery cooldown. A healthy tunnel with a disconnected MySQL receiver restarts only that receiver. Replication positions and queued local transactions are preserved; an applier/data error is reported instead of skipped. Allow roughly a minute for a broken connection and queued changes to recover. Staff sign-in requests time out with a retry message instead of waiting indefinitely.

If setup stops before activation, remote admin login remains available. In cloud Settings enter the admin password and click **Cancel unfinished setup**, then download a new installer and retry. This revokes the previous installer/key. An already active source cannot be reset this way because it may hold unsynced tickets.

If Windows says the local address cannot connect, use Administrator PowerShell:

```powershell
Get-Content C:\ProgramData\MadinaExpress\logs\server.log -Tail 35
Get-Content C:\ProgramData\MadinaExpress\logs\server-error.log -Tail 35
Get-Service MadinaTerminalMySQL
Get-ScheduledTaskInfo -TaskName 'Madina Express Terminal Server'
```

Do not share `backend\.env`, the installation ZIP's `setup.json`, tunnel keys, local-secrets.json, or database dumps. Do not expose port 3310 or 8443 through the public router.
