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

## Additional PCs, safe revocation and printing (v3.1)

The main administrator can add PC 4 and further slots (up to 99) in local **Settings → Main PC & offline access → Add PC**, using the administrator password. New slots do not automatically grant staff access: edit each account's allowed PC checkboxes. Download one setup ZIP per PC, use it within 30 minutes and run it in the staff Windows profile. Revocation requires a confirmation dialog and re-entering the administrator password; an accidental first click does not revoke anything.

Existing enrolled PCs do not need reinstallation. In Settings, download **Counter & Reports shortcuts**, extract it, close the old counter window and run `Setup-Counter-Shortcut.cmd` in the enrolled Windows profile. This uses the existing default Edge, Chrome or Firefox, installs no browser and creates two ME-branded desktop shortcuts:

- **Madina Express Counter** uses a separate browser profile with silent thermal printing, browser headers/footers disabled and zero browser margins. Set the 80 mm printer as the Windows default, choose the correct paper in its driver and select document feed/cut for one cut per job. Tickets and boarding tokens are queued as separate portrait jobs. Enable auto-print after payment in Settings to skip the receipt preview; manual printing closes the preview after the queue finishes.
- **Madina Express Reports** uses a separate normal-print profile of the same installed default browser and keeps the A4 printer-selection dialog. Sign in there once with the same account and enrolled profile. A4 reports are guarded against accidentally printing to the thermal printer from the silent Counter session. Browser silent mode is a profile setting, not a per-document web permission. Printer hardware margins and cutter settings remain in the printer driver.

Receipt design is shared across counters. The owner can edit branding, contact text, English font, heading/body/seat/Urdu sizes, spacing, padding, QR size, Urdu instructions and the boarding slip title in **Settings → Receipt configuration → Edit receipt design**. A preview shows the draft before saving. Paper choice and auto-print remain local to each browser.

## Direct Ethernet test network

For a two-PC cable test, use main Ethernet `192.168.50.1`, counter Ethernet `192.168.50.2`, subnet mask `255.255.255.0`. Leave gateway and DNS blank on that direct cable; keep a separate Wi-Fi connection for internet. Both PCs must have different addresses. Do not assign the router's address to the main PC when using a router.

For three or more PCs, connect every PC to the LAN ports of one router or a network switch. Reserve the main PC's address in the router, or set an unused static address in that router's subnet. Do not bridge adapters, enable internet sharing or expose MySQL/8443 through internet router forwarding.

Main setup automatically configures a firewall rule for TCP 8443, restricted to its selected LAN interface, local address and local subnet. It attempts to mark that interface Private; the scoped rule also works if Windows policy prevents that category change. To repair access on an already installed main PC, open **Windows PowerShell → Run as administrator** and run:

```powershell
$b = 'C:\ProgramData\MadinaExpress'
$a = (Get-Content "$b\host\current.json" -Raw | ConvertFrom-Json).application
& "$a\deploy\windows\Configure-Main-PC-Firewall.ps1" -Address '192.168.50.1'
```

From a child PC:

```powershell
Test-NetConnection 192.168.50.1 -Port 8443
```

`TcpTestSucceeded` must be `True` before enrollment. The child installer now checks this before creating a device key and gives a LAN-specific error. If it fails, check cable/link lights, different IPs, subnet masks and the elevated main-PC firewall repair; the main PC testing its own address does not prove that another PC can reach it.

If TPM is unavailable, the owner can approve **Allow this PC without TPM** for that setup download. The key is still non-exportable and tied to the enrolled Windows profile. Staff should use standard Windows accounts. Never clear the TPM as a troubleshooting step.

When moving the same main PC to another network, use the current installed script rather than an old extracted installer:

```powershell
$b = 'C:\ProgramData\MadinaExpress'
$a = (Get-Content "$b\host\current.json" -Raw | ConvertFrom-Json).application
& "$a\deploy\windows\Change-Main-PC-Network.ps1"
```

Then update each enrolled child's shortcuts with the new origin. Run its saved helper in that child's normal Windows profile:

```powershell
& "$env:LOCALAPPDATA\MadinaExpress\Setup-Counter-Shortcut.ps1" -Origin 'https://192.168.50.1:8443'
```

Use the new main IP in place of the example. If the saved helper is absent, download the current Counter & Reports shortcuts ZIP from Settings at the new local address. Existing CA and device enrollment survive an address change.

Keep the main PC awake while connected to AC power, enable BIOS **Restore after AC Power Loss → Power On**, and use a UPS for the main PC/router where possible. The database, server and updater start at Windows boot without a signed-in user. Child browsers are opened through their desktop shortcuts. Internet loss permits LAN counter work; main-PC power loss pauses all new reservations/sales. The cloud remains a read-only copy until the same main PC reconnects.

Disable **Let Windows manage my default printer** in Windows printer settings so an A4 report does not change the thermal default. Shortcut setup attempts this per-user preference automatically; the actual default printer and feed/cut mode must be selected in the installed printer driver.

The current shortcut setup removes the older Madina per-user Chrome/Edge global silent-print override, so A4 reports can show their dialog. After updating shortcuts, fully close and reopen the browser once. Firefox gets a separate Reports profile with silent printing disabled and Windows device certificates enabled; its Counter profile stays silent. Do not run an old downloaded Print Setup CMD that enables silent printing for all profiles.
