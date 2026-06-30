const mongoose = require('mongoose');

const subtaskSchema = new mongoose.Schema({
    title: { type: String, required: true },
    completed: { type: Boolean, default: false },
});

const todoSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        task: { type: String, required: true },
        startDate: String,
        dueDate: String,
        priority: { type: String, default: 'Medium' },
        description: String,
        status: { type: Boolean, default: false },
        deleted: { type: Boolean, default: false },
        subtasks: [subtaskSchema],
    },
    { timestamps: true }
);

module.exports = mongoose.model('Todo', todoSchema);