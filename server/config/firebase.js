import admin from 'firebase-admin';
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

export const fireBaseAuth = admin.auth();
export default admin; 