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

// Add a document to a project
router.post('/:id/documents', (req, res) => {
  const { id } = req.params;
  const project = projects.find(p => p.id === id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const newDoc = {
    id: Date.now().toString(),
    addedAt: new Date().toISOString(),
    ...req.body,
  };
  project.documents.push(newDoc);
  saveProjects();
  res.status(201).json(newDoc);
});

// Remove a document from a project
router.delete('/:projectId/documents/:docId', (req, res) => {
  const { projectId, docId } = req.params;
  const project = projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  project.documents = project.documents.filter(d => d.id !== docId);
  saveProjects();
  res.status(204).end();
});

export default router;
