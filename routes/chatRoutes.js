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
            description: 'Create a new todo task. Only call this if the user has provided a clear task title. If no title is given, do NOT call this tool — instead ask the user what the task should be called.',
            parameters: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'The task title — must not be empty' },
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
            name: 'delete_todo',
            description: 'Delete a todo by matching its task name. If multiple tasks match, do NOT delete any — return ambiguous result and ask user to clarify.',
            parameters: {
                type: 'object',
                properties: {
                    taskName: { type: 'string', description: 'The task name to find and delete' },
                },
                required: ['taskName'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'edit_todo',
            description: 'Edit an existing todo. If multiple tasks match the name, do NOT edit any — ask user to clarify which one.',
            parameters: {
                type: 'object',
                properties: {
                    taskName: { type: 'string', description: 'The current task name to find' },
                    newTask: { type: 'string', description: 'New task title, if renaming' },
                    priority: { type: 'string', enum: ['High', 'Medium', 'Low'] },
                    dueDate: { type: 'string', description: 'YYYY-MM-DD format' },
                    startDate: { type: 'string', description: 'YYYY-MM-DD format' },
                    status: { type: 'boolean', description: 'true = completed, false = incomplete' },
                    description: { type: 'string' },
                },
                required: ['taskName'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'add_subtask',
            description: 'Add subtasks to an existing todo. If multiple tasks match, ask user to clarify.',
            parameters: {
                type: 'object',
                properties: {
                    taskName: { type: 'string', description: 'The parent task name' },
                    subtaskTitles: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'List of subtask titles to add',
                    },
                },
                required: ['taskName', 'subtaskTitles'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_todos',
            description: 'List all active todos for the user including subtasks',
            parameters: { type: 'object', properties: {} },
        },
    },
];

const findTodoByName = async (userId, taskName) => {
    const todos = await Todo.find({ user: userId, deleted: false });
    const lower = taskName.toLowerCase();
    const exactMatches = todos.filter((t) => t.task.toLowerCase() === lower);
    if (exactMatches.length === 1) return { match: exactMatches[0], multiple: false };
    if (exactMatches.length > 1) return { match: null, multiple: true, matches: exactMatches };
    const fuzzyMatches = todos.filter((t) =>
        t.task.toLowerCase().includes(lower) || lower.includes(t.task.toLowerCase())
    );
    if (fuzzyMatches.length === 1) return { match: fuzzyMatches[0], multiple: false };
    if (fuzzyMatches.length > 1) return { match: null, multiple: true, matches: fuzzyMatches };
    return { match: null, multiple: false };
};

const executeTool = async (userId, toolName, input) => {
    switch (toolName) {
        case 'create_todo': {
            if (!input.task || !input.task.trim()) {
                return { success: false, message: 'Cannot create a task with an empty title. Ask the user what the task should be called.' };
            }
            const saved = await new Todo({
                user: userId,
                task: input.task.trim(),
                description: input.description || '',
                priority: input.priority || 'Medium',
                startDate: input.startDate || '',
                dueDate: input.dueDate || '',
                subtasks: [],
            }).save();
            return { success: true, message: `Created task "${saved.task}"`, todo: saved };
        }

        case 'delete_todo': {
            const result = await findTodoByName(userId, input.taskName);
            if (result.multiple) {
                return {
                    success: false,
                    ambiguous: true,
                    message: `Multiple tasks match "${input.taskName}": ${result.matches.map((t) => `"${t.task}"`).join(', ')}. Please ask the user to specify which one exactly.`,
                };
            }
            if (!result.match) return { success: false, message: `No task found matching "${input.taskName}". It may not exist.` };
            result.match.deleted = true;
            await result.match.save();
            return { success: true, message: `Deleted task "${result.match.task}"` };
        }

        case 'edit_todo': {
            const result = await findTodoByName(userId, input.taskName);
            if (result.multiple) {
                return {
                    success: false,
                    ambiguous: true,
                    message: `Multiple tasks match "${input.taskName}": ${result.matches.map((t) => `"${t.task}"`).join(', ')}. Please ask the user to specify which one exactly.`,
                };
            }
            if (!result.match) return { success: false, message: `No task found matching "${input.taskName}". It may not exist.` };
            if (input.newTask) result.match.task = input.newTask;
            if (input.priority) result.match.priority = input.priority;
            if (input.dueDate) result.match.dueDate = input.dueDate;
            if (input.startDate) result.match.startDate = input.startDate;
            if (typeof input.status === 'boolean') result.match.status = input.status;
            if (input.description) result.match.description = input.description;
            await result.match.save();
            return { success: true, message: `Updated task "${result.match.task}"`, todo: result.match };
        }

        case 'add_subtask': {
            const result = await findTodoByName(userId, input.taskName);
            if (result.multiple) {
                return {
                    success: false,
                    ambiguous: true,
                    message: `Multiple tasks match "${input.taskName}": ${result.matches.map((t) => `"${t.task}"`).join(', ')}. Please ask the user to specify which one exactly.`,
                };
            }
            if (!result.match) return { success: false, message: `No task found matching "${input.taskName}". It may not exist.` };
            if (!Array.isArray(input.subtaskTitles) || input.subtaskTitles.length === 0) {
                return { success: false, message: 'No subtask titles provided.' };
            }
            const existing = result.match.subtasks || [];
            const existingTitles = existing.map((s) => s.title.toLowerCase());
            const newSubtasks = input.subtaskTitles
                .filter((t) => t && t.trim())
                .filter((t) => !existingTitles.includes(t.trim().toLowerCase()))
                .map((t) => ({ title: t.trim(), completed: false }));
            if (newSubtasks.length === 0) {
                return { success: false, message: `All those subtasks already exist on "${result.match.task}".` };
            }
            result.match.subtasks = [...existing, ...newSubtasks];
            await result.match.save();
            return {
                success: true,
                message: `Added ${newSubtasks.length} subtask(s) [${newSubtasks.map((s) => s.title).join(', ')}] to "${result.match.task}"`,
                todo: result.match,
            };
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
                    subtasks: (t.subtasks || []).map((s) => ({
                        title: s.title,
                        completed: s.completed,
                    })),
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
            'You are a helpful todo list assistant. You can create, edit, delete, list tasks, and add subtasks using ONLY the provided tools. ' +
            'IMPORTANT RULES: ' +
            '1. Never claim you performed an action unless the tool returned success: true. ' +
            '2. If a tool returns ambiguous: true, list the matching task names and ask the user to clarify which one they mean. Do NOT proceed. ' +
            '3. If a task is not found, tell the user clearly — never create a new task to compensate for a missing one. ' +
            '4. If the user says "create a todo" with no title, ask them what the task should be called before calling create_todo. ' +
            '5. If a tool returns success: false, relay that failure message honestly to the user. ' +
            'Today\'s date is ' + new Date().toISOString().split('T')[0] +
            '. Convert relative dates like "tomorrow" or "next friday" to YYYY-MM-DD. ' +
            'Be concise and confirm exactly what action you took.';

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
                let args = {};
                try {
                    args = JSON.parse(toolCall.function.arguments);
                } catch (parseErr) {
                    args = {};
                }
                const result = await executeTool(req.user._id, toolCall.function.name, args);
                actionsTaken.push({ tool: toolCall.function.name, ...result });
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(result),
                });
            }
        }

        if (!finalText) {
            finalText = 'Done! Please check your task list.';
        }

        return res.status(200).json({ reply: finalText, actionsTaken });
    } catch (err) {
        console.error('Chat error:', err);
        return res.status(500).json({ message: err.message });
    }
});

module.exports = router;