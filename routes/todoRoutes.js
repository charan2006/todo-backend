const express = require('express');
const router = express.Router();
const Todo = require('../models/Todo');
const { protect } = require('../middleware/auth');

// All routes protected
router.get('/', protect, async (req, res) => {
    try {
        const todos = await Todo.find({ user: req.user._id, deleted: false }).sort({ createdAt: 1 });
        res.json(todos);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.get('/trash', protect, async (req, res) => {
    try {
        const todos = await Todo.find({ user: req.user._id, deleted: true }).sort({ updatedAt: -1 });
        res.json(todos);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/', protect, async (req, res) => {
    try {
        const saved = await new Todo({ ...req.body, user: req.user._id }).save();
        res.status(201).json(saved);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

router.put('/:id', protect, async (req, res) => {
    try {
        const updated = await Todo.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            req.body,
            { new: true }
        );
        if (!updated) return res.status(404).json({ message: 'Todo not found' });
        res.json(updated);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

router.delete('/:id', protect, async (req, res) => {
    try {
        const deleted = await Todo.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { deleted: true },
            { new: true }
        );
        if (!deleted) return res.status(404).json({ message: 'Todo not found' });
        res.json(deleted);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.put('/:id/restore', protect, async (req, res) => {
    try {
        const restored = await Todo.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { deleted: false },
            { new: true }
        );
        if (!restored) return res.status(404).json({ message: 'Todo not found' });
        res.json(restored);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;