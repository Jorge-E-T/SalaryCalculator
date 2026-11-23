/* =====================================================================
   Firebase settings for CLOUD SYNC
   ---------------------------------------------------------------------
   Paste the values from: Firebase console -> your SALARY project ->
   Project settings (gear icon) -> "Your apps" -> Web app -> SDK setup
   and configuration -> "Config".

   These values are NOT secret: they only say which project to talk to.
   Your data is protected by the cloud sign-in plus the Firestore rules
   (firestore.rules), which only let your own e-mail(s) in.

   Leave the PASTE_... values in place to keep the program local-only.
   ===================================================================== */
window.FIREBASE_CONFIG = {
    apiKey: "PASTE_API_KEY_HERE",
    authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
    projectId: "PASTE_PROJECT_ID",
    storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
    messagingSenderId: "PASTE_SENDER_ID",
    appId: "PASTE_APP_ID"
};
