const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const User = require('../models/User');
const logger = require('../utils/logger');

// One message for an unknown email and a wrong password: distinct messages
// told anyone which addresses have accounts.
const BAD_CREDENTIALS = 'Incorrect email or password.';

module.exports = function (passport) {
  passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const user = await User.findOne({ email: String(email).trim().toLowerCase() });
      if (!user) return done(null, false, { message: BAD_CREDENTIALS });

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return done(null, false, { message: BAD_CREDENTIALS });

      return done(null, user);
    } catch (err) {
      logger.error('Error in authentication:', err.message);
      return done(err);
    }
  }));

  // Serialize user to store in session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // Deserialize user from session. The hash is not needed after sign-in, so it
  // never rides along on req.user into every template.
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id).select('-password');
      done(null, user);
    } catch (err) {
      done(err);
    }
  });
};
