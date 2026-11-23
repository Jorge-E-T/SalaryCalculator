# La Casa De Los Trucos — Salary Calculator

Weekly pay calculator (hours, overtime, bonus, Social Security, Medicare, 15-T withholding), employee records, accounting and year-to-date totals. Works on a computer, a phone, and the **rabbit r1**, with optional **cloud sync** (Firebase) so every device shows the same, current data.

## Put it on GitHub Pages
1. Upload every file in this folder to the root of your repository (including `.nojekyll`).
2. Repository → **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main`, folder `/ (root)` → Save.
3. After a minute the app is at `https://YOUR-NAME.github.io/REPO-NAME/`.
4. Open `https://YOUR-NAME.github.io/REPO-NAME/install.html` on a computer and scan the QR code with the r1.

> On the free GitHub plan, Pages sites are **public**. Anyone with the link can open the app (but not your data — data stays in each device's browser).

## First use on a new device
There are no built-in accounts or employees any more. The first time it opens you'll be asked to create the **admin** password (8+ characters), or you can load your encrypted backup.

## Cloud sync (Firebase)
The data can be kept in sync across all your devices through a Firebase project of its own (separate from the ordering app). The program stays on GitHub Pages; Firebase holds only the data.

- Files: `cloud-sync.js`, `cloud-sync.css`, `firebase-config.js` (your project's settings), `firestore.rules` (paste into Firebase → Firestore → Rules).
- Each device keeps its own copy and keeps working offline; changes upload when it's back online.
- Sign in once per device with the **cloud** e-mail/password (Cloud Sync card at the bottom, or the button in the login window). The program's own logins work as before.
- Status pill (top-right): green = up to date, blue = syncing, amber = offline, grey = not signed in, red = problem.
- Full setup steps: see the "Salary Calculator – Cloud Sync Setup Guide".
- With `PASTE_` values left in `firebase-config.js`, the program stays local-only, exactly as before.

## Moving your data (export / re-import)
With cloud sync on you don't need this to move data between devices; keep making a monthly backup anyway.
- **💾 Backup / ⟳ Restore** — plain backup file for your own computer. **Never upload this to GitHub** — it contains names, SSNs, and pay.
- **🔒 Encrypted Backup** — asks for a password and downloads `backup.enc.json`, scrambled with AES-256. Restore accepts it too (it asks for the password).
- **To get your data onto the r1:** make an encrypted backup on the computer, upload `backup.enc.json` to the repository next to `index.html`, then on the r1 tap **🔒 Load encrypted backup from website** and type the password. Delete the file from the repository when you're done if you prefer.

## Using it on the r1
- Bottom bar: **Pay · Results · People · Reports · More**.
- **Hold the side button and speak** to fill the selected box (or the name box). Examples: “Ana Lopez”, “November ninth”, “eight hours thirty minutes”, “fifteen fifty” (→ 15.50). Spanish dates work too.
- **Scroll wheel** scrolls the screen; a **short press** moves to the next box.
- Layout can be forced under **More → Screen layout** (Automatic / Desktop / Compact).
- Printing, PDF and emailing pay stubs are meant for the computer and may not work on the r1.

## Privacy notes
- Cloud data is readable only by the e-mails listed in `firestore.rules`. Program-login passwords sync too, so don't reuse your cloud or e-mail password as a program password.
- Employee SSNs and the old admin password were removed from `script.js`; don't put them back in the code.
- Emailing a pay stub uploads the PDF to Uploadcare's public file service to create the link.
