import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

let projects = [];
const dataFile = path.join(process.cwd(), 'server', 'projects.json');
if (fs.existsSync(dataFile)) {
  projects = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
}
function saveProjects() {
  fs.writeFileSync(dataFile, JSON.stringify(projects, null, 2));
}

// Get all projects
router.get('/', (req, res) => {
  res.json(projects);
});

// Create a new project
router.post('/', (req, res) => {
  const newProject = {
    id: Date.now().toString(),
    createdAt: new Date().toISOString(),
    ...req.body,
    documents: [],
  };
  projects.push(newProject);
  saveProjects();
  res.status(201).json(newProject);
});

// Update a project
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Project not found' });
  projects[idx] = { ...projects[idx], ...req.body };
  saveProjects();
  res.json(projects[idx]);
});

// Delete a project
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  projects = projects.filter(p => p.id !== id);
  saveProjects();
  res.status(204).end();
});

export default router;
