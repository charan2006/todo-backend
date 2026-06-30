const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const Todo = require('../models/Todo');
const { protect } = require('../middleware/auth');

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

const tools = [
    {
        type: 'function',
        function: {
            name: 'create_todo',
            description: 'Create a new todo task for the user',
            parameters: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'The task title' },
                    description: { type: 'string', description: 'Optional description' },
                    priority: { type: 'string', enum: ['High', 'Medium', 'Low'] },
                    startDate: { type: 'string', description: 'YYYY-MM-DD format, optional' },
                    dueDate: { type: 'string', description: 'YYYY-MM-DD format, optional' },
                },
                required: ['task'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'add_subtask',
            description: 'Add a subtask to an existing todo task',
            parameters: {
                type: 'object',
                properties: {
                    taskName: {
                        type: 'string',
                        description: 'Parent task name'
                    },
                    subtask: {
                        type: 'string',
                        description: 'Subtask title'
                    }
                },
                required: ['taskName', 'subtask']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_todo',
            description: 'Delete (soft-delete) a todo by matching its task name',
            parameters: {
                type: 'object',
                properties: {
                    taskName: { type: 'string', description: 'The task name or close match to find and delete' },
                },
                required: ['taskName'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'edit_todo',
            description: 'Edit/update an existing todo - change its task text, priority, dates, or mark complete',
            parameters: {
                type: 'object',
                properties: {
                    taskName: { type: 'string', description: 'The current task name to find' },
                    newTask: { type: 'string', description: 'New task title, if renaming' },
                    priority: { type: 'string', enum: ['High', 'Medium', 'Low'] },
                    dueDate: { type: 'string', description: 'YYYY-MM-DD format' },
                    startDate: { type: 'string', description: 'YYYY-MM-DD format' },
                    status: { type: 'boolean', description: 'true = mark completed, false = mark incomplete' },
                    description: { type: 'string' },
                },
                required: ['taskName'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_todos',
            description: 'List all current active todos for the user',
            parameters: { type: 'object', properties: {} },
        },
    },
];

const findTodoByName = async (userId, taskName) => {
    const todos = await Todo.find({ user: userId, deleted: false });
    const lower = taskName.toLowerCase();
    return (
        todos.find((t) => t.task.toLowerCase() === lower) ||
        todos.find((t) => t.task.toLowerCase().includes(lower) || lower.includes(t.task.toLowerCase()))
    );
};

const executeTool = async (userId, toolName, input) => {
    switch (toolName) {
        case 'create_todo': {
            const saved = await new Todo({
                user: userId,
                task: input.task,
                description: input.description || '',
                priority: input.priority || 'Medium',
                startDate: input.startDate || '',
                dueDate: input.dueDate || '',
                subtasks: [],
            }).save();
            return { success: true, message: `Created task "${saved.task}"`, todo: saved };
        }
        case 'add_subtask': {
            const found = await findTodoByName(userId, input.taskName);

            if (!found) {
                return {
                    success: false,
                    message: `Task "${input.taskName}" not found`
                };
            }

            found.subtasks.push({
                title: input.subtask,
                completed: false
            });

            await found.save();

            return {
                success: true,
                message: `Added subtask "${input.subtask}" to "${found.task}"`,
                todo: found
            };
        }
        case 'delete_todo': {
            const found = await findTodoByName(userId, input.taskName);
            if (!found) return { success: false, message: `No task found matching "${input.taskName}"` };
            found.deleted = true;
            await found.save();
            return { success: true, message: `Deleted task "${found.task}"`, todo: found };
        }
        case 'edit_todo': {
            const found = await findTodoByName(userId, input.taskName);
            if (!found) return { success: false, message: `No task found matching "${input.taskName}"` };
            if (input.newTask) found.task = input.newTask;
            if (input.priority) found.priority = input.priority;
            if (input.dueDate) found.dueDate = input.dueDate;
            if (input.startDate) found.startDate = input.startDate;
            if (typeof input.status === 'boolean') found.status = input.status;
            if (input.description) found.description = input.description;
            await found.save();
            return { success: true, message: `Updated task "${found.task}"`, todo: found };
        }
        case 'list_todos': {
            const todos = await Todo.find({ user: userId, deleted: false }).sort({ createdAt: 1 });
            return {
                success: true,
                todos: todos.map((t) => ({
                    task: t.task,
                    priority: t.priority,
                    status: t.status ? 'completed' : 'pending',
                    dueDate: t.dueDate || 'none',
                    subtasks: t.subtasks
                })),
            };
        }
        default:
            return { success: false, message: 'Unknown tool' };
    }
};

router.post('/', protect, async (req, res) => {
    try {
        const { message, history = [] } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ message: 'Message is required' });
        }

        const systemPrompt =
            'You are a helpful todo list assistant. You can create, edit, delete, and list tasks for the user using the provided tools. Today\'s date is ' +
            new Date().toISOString().split('T')[0] +
            '. When dates are mentioned like "tomorrow" or "next friday", convert them to YYYY-MM-DD format. Be concise and confirm what action you took.';

        let messages = [
            { role: 'system', content: systemPrompt },
            ...history.map((h) => ({ role: h.role, content: h.content })),
            { role: 'user', content: message },
        ];

        let actionsTaken = [];
        let finalText = '';

        for (let i = 0; i < 5; i++) {
            const completion = await groq.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages,
                tools,
            });

            const choice = completion.choices[0];
            const msg = choice.message;

            if (!msg.tool_calls || msg.tool_calls.length === 0) {
                finalText = msg.content || 'Done!';
                break;
            }

            messages.push(msg);

            for (const toolCall of msg.tool_calls) {
                const args = JSON.parse(toolCall.function.arguments);
                const result = await executeTool(req.user._id, toolCall.function.name, args);
                actionsTaken.push({ tool: toolCall.function.name, ...result });

                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(result),
                });
            }
        }

        return res.status(200).json({
            reply: finalText,
            actionsTaken,
        });
    } catch (err) {
        console.error('Chat error:', err);
        return res.status(500).json({ message: err.message });
    }
});

module.exports = router;