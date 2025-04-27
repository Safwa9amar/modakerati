import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import projectsRouter from './modules/projects.js';
import documentsRouter from './modules/documents.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(bodyParser.json());

let projects = [];

const dataFile = path.join(process.cwd(), 'server', 'projects.json');
if (fs.existsSync(dataFile)) {
  projects = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
}

function saveProjects() {
  fs.writeFileSync(dataFile, JSON.stringify(projects, null, 2));
}

app.use('/api/projects', projectsRouter);
app.use('/api/projects', documentsRouter);

export default app;
