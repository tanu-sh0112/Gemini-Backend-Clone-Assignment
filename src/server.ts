import express, { Application, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import chatroomRoutes from './routes/chatroom';
import subscriptionRoutes from './routes/subscription';
import webhookRoutes from './routes/webhook';
import errorHandler from './middleware/errorHandler';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { initializeQueue } from './config/queue';

dotenv.config();

const app: Application = express();
const PORT: number = parseInt(process.env.PORT || '3000');

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use('/webhook', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// --- API Routes ---
app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/chatroom', chatroomRoutes);
app.use('/subscription', subscriptionRoutes);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

// 404 Handler for any routes not matched above
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

async function startServer(): Promise<void> {
  try {
    // Establish connections before starting the server
    await connectDatabase();
    await connectRedis();
    await initializeQueue();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
