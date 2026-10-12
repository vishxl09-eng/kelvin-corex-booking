KELVIN COREX — FINAL BOOKING APP
================================

Includes:
- Responsive customer booking page
- Mobile-friendly owner dashboard
- Google Sheets storage (no PostgreSQL)
- Approve / Reject / Remove appointments
- WhatsApp message links
- Vercel deployment configuration
- No JSON-file booking storage

IMPORTANT: The app cannot save bookings until Google Apps Script and Vercel environment variables are configured.

A. SET UP GOOGLE SHEETS BACKEND
1. Open https://script.google.com/home and create a New project.
2. Open google-apps-script/Code.gs from this ZIP and copy ALL of it into the Apps Script editor.
3. In Code.gs, replace CHANGE_THIS_TO_A_LONG_RANDOM_SECRET with a long private secret. Example format only: KC-choose-your-own-random-secret-2026-!  Do not use this example as your real secret.
4. Click Save.
5. Run the setup() function once from the function dropdown. Google will ask for authorization. Review and allow the requested Google Sheets permissions.
6. If asked to choose a Google account, use the account where you want the appointment spreadsheet created.
7. After setup succeeds, click Deploy > New deployment > select the gear icon > Web app.
8. Execute as: Me.
9. Who has access: Anyone (if this option is available and permitted by your Google account).
10. Click Deploy and complete authorization if asked. Copy the Web app URL ending in /exec.
11. Keep the Apps Script project and spreadsheet in your account. The spreadsheet is created automatically by setup().

If Google shows an unverified-app warning, only continue through Advanced if this is your own script and you have reviewed its code. Do not bypass an organization policy or a blocked-app warning.

B. SET UP VERCEL VARIABLES
In Vercel > kelvin-corex-booking > Settings > Environment Variables, add each variable for Production:
SHEETS_WEB_APP_URL = the /exec URL copied from Apps Script
SHEETS_API_KEY = the exact same secret you placed in Code.gs
ADMIN_PASSWORD = a strong owner dashboard password
OWNER_WHATSAPP = 918287139492
SALON_NAME = Kelvin Corex
OPEN_HOUR = 10
CLOSE_HOUR = 20
PUBLIC_SITE_URL = https://kelvin-corex-booking.vercel.app

Use the normal Project Environment Variables section. Do not create a pre-production environment. Do not put secret values in public HTML or commit them to GitHub.

C. PUSH THE UPDATED PROJECT TO YOUR EXISTING GITHUB REPOSITORY
1. Extract this ZIP.
2. Copy the CONTENTS of the extracted folder into your existing project folder, replacing matching app files. Keep the existing .git folder. Do not copy .git from anywhere.
3. In PowerShell, open your existing project folder and run:
   git add .
   git commit -m "Replace JSON storage with Google Sheets and improve mobile UI"
   git push origin main
4. Vercel should deploy from GitHub automatically. If not, open Deployments and redeploy the latest commit.

D. TEST
- Customer booking page: https://kelvin-corex-booking.vercel.app/
- Owner dashboard: https://kelvin-corex-booking.vercel.app/owner.html
- Health check: https://kelvin-corex-booking.vercel.app/api/health

Create one test booking. It should appear in the Google spreadsheet named "Kelvin Corex Appointments". Owner dashboard default password is NOT hardcoded; use the ADMIN_PASSWORD you set in Vercel.

NOTES
- This version never writes appointment data to a local JSON file.
- WhatsApp notifications open a prefilled WhatsApp message for the owner/customer. Fully automatic sending requires WhatsApp Business Platform API configuration.
- If the Google account is managed by school/work and blocks Apps Script authorization or "Anyone" deployment, use a personal Google account or ask the administrator; Gmail settings cannot manually approve a blocked script.
- If the project has an old Vercel deployment, ensure the new files are pushed to GitHub and that the latest deployment is successful.
