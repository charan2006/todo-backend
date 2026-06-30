const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password)
            return res.status(400).json({ message: 'Please fill all fields' });

        const userExist = await User.findOne({ email });
        if (userExist)
            return res.status(400).json({ message: 'User already exists' });

        const user = await User.create({ username, email, password });
        return res.status(201).json({
            id: user._id,
            username: user.username,
            email: user.email,
            token: generateToken(user._id),
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !(await user.matchPassword(password)))
            return res.status(400).json({ message: 'Invalid Credentials' });

        return res.status(200).json({
            id: user._id,
            username: user.username,
            email: user.email,
            token: generateToken(user._id),
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
});

router.get('/me', protect, async (req, res) => {
    return res.status(200).json(req.user);
});

module.exports = router;