import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import createRouter, {router} from 'express-file-routing';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from './config/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


dotenv.config();

const app = express();

app.use(cors());
app.use(bodyParser.json());

app.use("/api", await router()) // as router middleware or

await createRouter(app) // as wrapper function
// app.use('/api', router);

// Example endpoint to test Prisma connection
app.get('/api/db-test', async (req, res) => {
  try {
   let user =  await prisma.user.create({
      data : {
        email : "hassanih98@gmail.com",
        phone : "0674020244",
        name : "hamzza hassani"
      }
    })
    let users = await prisma.user.findMany()
    console.log(users);
    
    await prisma.$connect();
    await prisma.$disconnect();
    res.json({ db: 'connected' });
  } catch (error) {
    res.status(500).json({ db: 'error', error: error.message });
  }
});

export default app;
