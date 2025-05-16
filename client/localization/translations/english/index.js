import common from './common.js';
import auth from './auth.js';
import dashboard from './dashboard.js';
import onboarding from './onboarding.js';
import settings from './settings.js';
import firebase from './firebase.js';
import home from './home.js';
import validation from './validation.js';

const en = {
  ...common,
  ...home,
  ...auth,
  ...dashboard,
  ...onboarding,
  ...settings,
  ...firebase,
  ...validation,
};

export default en;
