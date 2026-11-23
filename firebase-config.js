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
    apiKey: "AIzaSyAD2vnzFW0GVXJF9ff9P4tXRbWNRTgTm98",
    authDomain: "salarycalculator-8430e.firebaseapp.com",
    projectId: "salarycalculator-8430e",
    storageBucket: "salarycalculator-8430e.firebasestorage.app",
    messagingSenderId: "621648585833",
    appId: "1:621648585833:web:cefff9814d3855ec7d2ef8"
};