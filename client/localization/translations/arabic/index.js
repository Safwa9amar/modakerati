import common from './common.js';
import auth from './auth.js';
import dashboard from './dashboard.js';
import onboarding from './onboarding.js';
import settings from './settings.js';
import firebase from './firebase.js';

const ar = {
  ...common,
  ...auth,
  ...dashboard,
  ...onboarding,
  ...settings,
  ...firebase,
};

export default ar;
