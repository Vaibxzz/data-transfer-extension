/*
  firebase-init-and-auth-wiring.js
  Uses compat SDK (firebase-app-compat.js and firebase-auth-compat.js).
  This file waits for the SDK to be available, initializes firebase with
  window.__FIREBASE_CONFIG__ then wires up Google + Microsoft sign-in buttons.
*/

(function () {
  function waitForFirebase(cb) {
    if (typeof firebase !== 'undefined' && firebase.apps && !firebase.apps.length && window.__FIREBASE_CONFIG__) {
      try {
        firebase.initializeApp(window.__FIREBASE_CONFIG__);
      } catch (e) {
        // ignore if already initialized
      }
    }
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
      return setTimeout(function(){ waitForFirebase(cb); }, 50);
    }
    cb();
  }

  function start() {
    var auth = firebase.auth();

    // Google provider wiring
    var googleProvider = new firebase.auth.GoogleAuthProvider();
    Array.prototype.forEach.call(document.querySelectorAll('.google-btn, .google-signin'), function(btn){
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        auth.signInWithPopup(googleProvider).then(function(result){
          console.log('Google signIn success', result);
          // you can add post-signin behavior here
        }).catch(function(err){
          console.error('Google signIn error', err);
          alert('Google sign-in error: ' + (err && err.message ? err.message : err));
        });
      });
    });

    // Microsoft (Outlook) provider wiring
    // Firebase supports Microsoft using OAuth provider name "microsoft.com"
    var msProvider = new firebase.auth.OAuthProvider('microsoft.com');
    // request basic scopes (profile + openid + email). adjust as needed.
    msProvider.addScope('openid');
    msProvider.addScope('profile');
    msProvider.addScope('email');

    Array.prototype.forEach.call(document.querySelectorAll('.outlook-btn, .ms-btn, .microsoft-btn'), function(btn){
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        auth.signInWithPopup(msProvider).then(function(result){
          console.log('Microsoft signIn success', result);
        }).catch(function(err){
          console.error('Microsoft signIn error', err);
          alert('Microsoft sign-in error: ' + (err && err.message ? err.message : err));
        });
      });
    });

    // optional: show current auth state
    auth.onAuthStateChanged(function(user){
      if (user) {
        console.log('firebase auth user', user);
      } else {
        console.log('no firebase user signed in');
      }
    });

    console.log('Firebase init + auth wiring ready.');
  }

  // wait for compat libs + config. They are loaded in page (auth.html) as compat scripts.
  waitForFirebase(start);
})();
