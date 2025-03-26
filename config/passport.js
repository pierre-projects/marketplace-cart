const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const User = require('../models/User');

module.exports = function (passport) {
    passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
        try {
            console.log('Login attempt with email:', email);
    
            // Check if user exists
            const user = await User.findOne({ email: email.toLowerCase() });
            console.log('User found:', user);
    
            if (!user) {
                console.log('Login failed: User does not exist');
                return done(null, false, { message: 'User does not exist' });
            }
    
            // Validate password
            const isMatch = await bcrypt.compare(password, user.password);
            console.log('Password match:', isMatch);
    
            if (!isMatch) {
                console.log('Login failed: Incorrect password');
                return done(null, false, { message: 'Incorrect password' });
            }
    
            console.log('Login successful:', user.username);
            return done(null, user);
        } catch (err) {
            console.error('Error in authentication:', err);
            return done(err);
        }
    }));
    
    

    // Serialize user to store in session
    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    // Deserialize user from session
    passport.deserializeUser(async (id, done) => {
        try {
            const user = await User.findById(id);
            done(null, user);
        } catch (err) {
            done(err);
        }
    });
};
