const express = require('express');
const User = require('../models/User');
const passport = require('passport');
const router = express.Router();


// Show the register form (GET)
router.get('/register', (req, res) => {
    res.render('auth/register', { formData: {}, errorMessage: null });
});

//  Handle user registration (POST)
router.post('/register', async (req, res) => {
    try {
        const username = req.body.username?.trim();
        const email = req.body.email?.trim().toLowerCase();
        const { password } = req.body;

        console.log('Registering user:', { username, email });

        if (!username || !email || !password) {
            return res.status(400).render('auth/register', {
                formData: { username: username || '', email: email || '' },
                errorMessage: 'Username, email, and password are required.'
            });
        }

        // Check if the username or email already exists
        let existingUser = await User.findOne({ $or: [{ email }, { username }] });
        console.log('User already exists check:', existingUser);

        if (existingUser) {
            return res.status(409).render('auth/register', {
                formData: { username, email },
                errorMessage: 'An account with that username or email already exists. Try logging in instead.'
            });
        }

        // Create and save new user
        const newUser = new User({ 
            username, 
            email, 
            password 
        });

        await newUser.save();

        req.flash('success_msg', 'Registration successful! You can now log in.');

        console.log('New user registered:', newUser);

        res.redirect('/auth/login'); // Redirect after successful registration
    } catch (err) {
        console.error('Error registering user:', err);
        return res.status(500).render('auth/register', {
            formData: {
                username: req.body.username?.trim() || '',
                email: req.body.email?.trim().toLowerCase() || ''
            },
            errorMessage: 'We could not complete registration right now. Please try again.'
        });
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
            req.flash('error_msg', 'We could not process your login right now. Please try again.');
            return res.redirect('/auth/login');
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
