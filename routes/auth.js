const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const passport = require('passport');
const router = express.Router();


// Show the register form (GET)
router.get('/register', (req, res) => {
    res.render('auth/register');
});

//  Handle user registration (POST)
router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        console.log('Registering user:', { username, email });

        // Check if the username or email already exists
        let existingUser = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
        console.log('User already exists check:', existingUser);

        if (existingUser) {
            return res.send('Username or email already exists'); // Prevent duplicate username/email
        }

        // Create and save new user
        const newUser = new User({ 
            username, 
            email: email.toLowerCase(), 
            password 
        });

        await newUser.save();

        req.flash('success_msg', 'Registration successful! You can now log in.');

        console.log('New user registered:', newUser);

        res.redirect('/auth/login'); // Redirect after successful registration
    } catch (err) {
        console.error('Error registering user:', err);
        res.send('Error registering user');
    }
});




//  Show the login form
router.get('/login', (req, res) => {
    res.render('auth/login'); // This should match "views/login.ejs"
});


router.post('/login', (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) {
            console.error('Error during authentication:', err);
            return next(err);
        }
        if (!user) {
            console.log('Authentication failed:', info.message);
            req.flash('error_msg', info.message);
            return res.redirect('/auth/login');
        }
        req.logIn(user, (err) => {
            if (err) {
                console.error('Login error:', err);
                return next(err);
            }
            console.log('User authenticated successfully:', user)

            return res.redirect('/dashboard');
        });
    })(req, res, next);
});



//  Logout Route
router.get('/logout', (req, res) => {
    req.logout(function(err) {
        if (err) {
            return next(err);
        }
        res.redirect('/');
    });
});


module.exports = router;
