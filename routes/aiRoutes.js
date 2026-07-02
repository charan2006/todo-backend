const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const Todo = require('../models/Todo');
const { protect } = require('../middleware/auth');

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

// ── Validators ──────────────────────────────────────────────
const validateCategory = (data) => {
    const valid = ['work', 'personal', 'urgent'];
    return (
        data &&
        typeof data === 'object' &&
        typeof data.category === 'string' &&
        valid.includes(data.category)
    );
};

const validateSuggestion = (data) => {
    const validPriorities = ['High', 'Medium', 'Low'];
    if (!data || typeof data !== 'object') return false;
    if (!data.priority || !validPriorities.includes(data.priority)) return false;
    if (data.dueDate && typeof data.dueDate !== 'string') return false;
    if (data.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate)) return false;
    return true;
};

// ── POST /api/ai/categorize ──────────────────────────────────
router.post('/categorize', protect, async (req, res) => {
    try {
        const { task, description } = req.body;
        if (!task || !task.trim()) {
            return res.status(400).json({ message: 'Task is required' });
        }

        const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                {
                    role: 'system',
                    content:
                        'You are a task categorization assistant. Categorize tasks into exactly one of: work, personal, urgent. ' +
                        'urgent = time-sensitive or high-stakes (taxes, medical, deadlines). ' +
                        'work = professional/career tasks. personal = everything else. ' +
                        'Return ONLY valid JSON. No markdown, no explanation.',
                },
                {
                    role: 'user',
                    content:
                        `Task: "${task.trim()}"` +
                        (description ? `. Description: "${description}"` : '') +
                        '. Return: {"category": "work"|"personal"|"urgent"}',
                },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
        });

        let parsed;
        try {
            parsed = JSON.parse(completion.choices[0].message.content);
        } catch {
            return res.status(200).json({ category: 'personal', fallback: true });
        }

        if (!validateCategory(parsed)) {
            console.warn('Invalid category response:', parsed);
            return res.status(200).json({ category: 'personal', fallback: true });
        }

        return res.status(200).json({ category: parsed.category });
    } catch (err) {
        console.error('Categorize error:', err);
        return res.status(500).json({ message: err.message });
    }
});

// ── POST /api/ai/suggest ─────────────────────────────────────
router.post('/suggest', protect, async (req, res) => {
    try {
        const { task, description } = req.body;
        if (!task || !task.trim()) {
            return res.status(400).json({ message: 'Task is required' });
        }

        const today = new Date().toISOString().split('T')[0];

        const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                {
                    role: 'system',
                    content:
                        `You are a task management assistant. Today is ${today}. ` +
                        'Suggest a realistic priority and due date based on the task text. ' +
                        'High priority = urgent/important. Medium = normal. Low = nice-to-have. ' +
                        'Due date should be realistic (not today unless urgent). ' +
                        'Return ONLY valid JSON. No markdown.',
                },
                {
                    role: 'user',
                    content:
                        `Task: "${task.trim()}"` +
                        (description ? `. Description: "${description}"` : '') +
                        '. Return: {"priority": "High"|"Medium"|"Low", "dueDate": "YYYY-MM-DD", "reasoning": "one sentence explanation"}',
                },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
        });

        let parsed;
        try {
            parsed = JSON.parse(completion.choices[0].message.content);
        } catch {
            return res.status(200).json({
                priority: 'Medium',
                dueDate: '',
                reasoning: 'Could not parse suggestion',
                fallback: true,
            });
        }

        if (!validateSuggestion(parsed)) {
            console.warn('Invalid suggestion response:', parsed);
            return res.status(200).json({
                priority: 'Medium',
                dueDate: '',
                reasoning: 'Suggestion was invalid, defaulting to Medium',
                fallback: true,
            });
        }

        return res.status(200).json({
            priority: parsed.priority,
            dueDate: parsed.dueDate || '',
            reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
        });
    } catch (err) {
        console.error('Suggest error:', err);
        return res.status(500).json({ message: err.message });
    }
});

// ── GET /api/ai/summary ──────────────────────────────────────
router.get('/summary', protect, async (req, res) => {
    try {
        const todos = await Todo.find({
            user: req.user._id,
            deleted: false,
            status: false,
        }).sort({ createdAt: 1 });

        if (todos.length === 0) {
            return res.status(200).json({
                summary: "🎉 You have no pending tasks right now. Great job staying on top of things!",
                totalPending: 0,
            });
        }

        const todoList = todos.map((t) => ({
            task: t.task,
            priority: t.priority,
            category: t.category || 'personal',
            dueDate: t.dueDate || 'no deadline',
            subtaskCount: (t.subtasks || []).length,
        }));

        const today = new Date().toISOString().split('T')[0];

        const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                {
                    role: 'system',
                    content:
                        'You are a helpful productivity assistant. Generate a concise, natural-language daily summary of pending tasks. ' +
                        'Mention counts by priority and category. Call out any tasks with deadlines today or soon. ' +
                        'Be motivating and specific. Keep it under 80 words. No bullet points — write in natural flowing sentences.',
                },
                {
                    role: 'user',
                    content: `Today is ${today}. Generate a daily summary for these ${todos.length} pending tasks: ${JSON.stringify(todoList)}`,
                },
            ],
            temperature: 0.7,
        });

        const summary = completion.choices[0].message.content;

        return res.status(200).json({
            summary,
            totalPending: todos.length,
        });
    } catch (err) {
        console.error('Summary error:', err);
        return res.status(500).json({ message: err.message });
    }
});

module.exports = router;