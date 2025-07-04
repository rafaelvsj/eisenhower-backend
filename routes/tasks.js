const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { validateTask } = require('../utils/validation');
const { taskLimiter } = require('../utils/rateLimiter');
const { getCache, setCache, deleteCache } = require('../utils/cache');
const router = express.Router();

// Configuração Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Rate limiting específico para tarefas
router.use(taskLimiter);

// Buscar todas as tarefas do usuário
router.get('/', async (req, res) => {
    try {
        const userId = req.user.userId;
        const cacheKey = `tasks_${userId}`;

        // Verificar cache
        const cachedTasks = getCache(cacheKey);
        if (cachedTasks) {
            return res.json(cachedTasks);
        }

        const { data: tasks, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Fetch tasks error:', error);
            return res.status(500).json({ error: 'Failed to fetch tasks' });
        }

        // Organizar por quadrantes
        const tasksByQuadrant = {
            1: tasks.filter(task => task.quadrant === 1),
            2: tasks.filter(task => task.quadrant === 2),
            3: tasks.filter(task => task.quadrant === 3),
            4: tasks.filter(task => task.quadrant === 4)
        };

        // Armazenar em cache
        setCache(cacheKey, tasksByQuadrant);

        res.json(tasksByQuadrant);

    } catch (error) {
        console.error('Get tasks error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Criar nova tarefa
router.post('/', async (req, res) => {
    try {
        const userId = req.user.userId;
        const { title, quadrant, description, priority, dueDate } = req.body;

        // Validações
        const validation = validateTask({ title, quadrant, description, priority, dueDate });
        if (!validation.isValid) {
            return res.status(400).json({ error: validation.error });
        }

        // Sanitizar dados
        const sanitizedTitle = title.trim().substring(0, 200);
        const sanitizedDescription = description ? description.trim().substring(0, 1000) : null;

        // Obter próximo número da tarefa para o quadrante
        const { data: nextNumber, error: numberError } = await supabase
            .rpc('get_next_task_number', { 
                user_id: userId, 
                quadrant_num: quadrant 
            });

        if (numberError) {
            console.error('Get next task number error:', numberError);
            return res.status(500).json({ error: 'Failed to generate task number' });
        }

        // Criar tarefa
        const { data: newTask, error } = await supabase
            .from('tasks')
            .insert([{
                user_id: userId,
                title: sanitizedTitle,
                description: sanitizedDescription,
                quadrant: quadrant,
                task_number: nextNumber,
                priority: priority || 'medium',
                due_date: dueDate ? new Date(dueDate).toISOString() : null,
                status: 'pending',
                created_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (error) {
            console.error('Create task error:', error);
            return res.status(500).json({ error: 'Failed to create task' });
        }

        // Invalidar cache
        deleteCache(`tasks_${userId}`);

        // Log de auditoria
        console.log(`Task created: ${newTask.id} by user ${userId} at ${new Date().toISOString()}`);

        res.status(201).json({
            message: 'Task created successfully',
            task: newTask
        });

    } catch (error) {
        console.error('Create task error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Atualizar tarefa
router.put('/:id', async (req, res) => {
    try {
        const userId = req.user.userId;
        const taskId = req.params.id;
        const { title, description, priority, dueDate, status } = req.body;

        // Validar se a tarefa pertence ao usuário
        const { data: existingTask, error: fetchError } = await supabase
            .from('tasks')
            .select('*')
            .eq('id', taskId)
            .eq('user_id', userId)
            .single();

        if (fetchError || !existingTask) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Validar dados
        const updateData = {};
        
        if (title !== undefined) {
            if (!title.trim()) {
                return res.status(400).json({ error: 'Title is required' });
            }
            updateData.title = title.trim().substring(0, 200);
        }

        if (description !== undefined) {
            updateData.description = description ? description.trim().substring(0, 1000) : null;
        }

        if (priority !== undefined) {
            if (!['low', 'medium', 'high'].includes(priority)) {
                return res.status(400).json({ error: 'Invalid priority level' });
            }
            updateData.priority = priority;
        }

        if (dueDate !== undefined) {
            updateData.due_date = dueDate ? new Date(dueDate).toISOString() : null;
        }

        if (status !== undefined) {
            if (!['pending', 'in_progress', 'completed'].includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }
            updateData.status = status;
            
            // Se completando a tarefa, marcar timestamp
            if (status === 'completed') {
                updateData.completed_at = new Date().toISOString();
            }
        }

        updateData.updated_at = new Date().toISOString();

        // Atualizar tarefa
        const { data: updatedTask, error } = await supabase
            .from('tasks')
            .update(updateData)
            .eq('id', taskId)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) {
            console.error('Update task error:', error);
            return res.status(500).json({ error: 'Failed to update task' });
        }

        // Invalidar cache
        deleteCache(`tasks_${userId}`);

        // Log de auditoria
        console.log(`Task updated: ${taskId} by user ${userId} at ${new Date().toISOString()}`);

        res.json({
            message: 'Task updated successfully',
            task: updatedTask
        });

    } catch (error) {
        console.error('Update task error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Deletar tarefa
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.user.userId;
        const taskId = req.params.id;

        // Validar se a tarefa pertence ao usuário
        const { data: existingTask, error: fetchError } = await supabase
            .from('tasks')
            .select('id')
            .eq('id', taskId)
            .eq('user_id', userId)
            .single();

        if (fetchError || !existingTask) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Deletar tarefa
        const { error } = await supabase
            .from('tasks')
            .delete()
            .eq('id', taskId)
            .eq('user_id', userId);

        if (error) {
            console.error('Delete task error:', error);
            return res.status(500).json({ error: 'Failed to delete task' });
        }

        // Invalidar cache
        deleteCache(`tasks_${userId}`);

        // Log de auditoria
        console.log(`Task deleted: ${taskId} by user ${userId} at ${new Date().toISOString()}`);

        res.json({ message: 'Task deleted successfully' });

    } catch (error) {
        console.error('Delete task error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Buscar estatísticas das tarefas
router.get('/stats', async (req, res) => {
    try {
        const userId = req.user.userId;
        const cacheKey = `task_stats_${userId}`;

        // Verificar cache
        const cachedStats = getCache(cacheKey);
        if (cachedStats) {
            return res.json(cachedStats);
        }

        const { data: stats, error } = await supabase
            .from('task_stats')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error) {
            console.error('Fetch stats error:', error);
            return res.status(500).json({ error: 'Failed to fetch statistics' });
        }

        // Armazenar em cache
        setCache(cacheKey, stats, 60000); // Cache por 1 minuto

        res.json(stats);

    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Mover tarefa entre quadrantes
router.patch('/:id/move', async (req, res) => {
    try {
        const userId = req.user.userId;
        const taskId = req.params.id;
        const { quadrant } = req.body;

        // Validar quadrante
        if (!quadrant || ![1, 2, 3, 4].includes(quadrant)) {
            return res.status(400).json({ error: 'Invalid quadrant (1-4)' });
        }

        // Validar se a tarefa pertence ao usuário
        const { data: existingTask, error: fetchError } = await supabase
            .from('tasks')
            .select('*')
            .eq('id', taskId)
            .eq('user_id', userId)
            .single();

        if (fetchError || !existingTask) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Obter novo número da tarefa
        const { data: nextNumber, error: numberError } = await supabase
            .rpc('get_next_task_number', { 
                user_id: userId, 
                quadrant_num: quadrant 
            });

        if (numberError) {
            console.error('Get next task number error:', numberError);
            return res.status(500).json({ error: 'Failed to generate task number' });
        }

        // Mover tarefa
        const { data: movedTask, error } = await supabase
            .from('tasks')
            .update({
                quadrant: quadrant,
                task_number: nextNumber,
                updated_at: new Date().toISOString()
            })
            .eq('id', taskId)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) {
            console.error('Move task error:', error);
            return res.status(500).json({ error: 'Failed to move task' });
        }

        // Invalidar cache
        deleteCache(`tasks_${userId}`);

        // Log de auditoria
        console.log(`Task moved: ${taskId} from Q${existingTask.quadrant} to Q${quadrant} by user ${userId}`);

        res.json({
            message: 'Task moved successfully',
            task: movedTask
        });

    } catch (error) {
        console.error('Move task error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;