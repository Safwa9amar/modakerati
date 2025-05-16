import { Request, Response, NextFunction } from 'express';
import { fireBaseAuth } from '../config/firebase.js';

// Define the user type based on Firebase Auth token
interface FirebaseUser {
  id: string;
  email: string;
  role: string;
}

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: FirebaseUser;
    }
  }
}

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
      // Get the ID token from the Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
          return res.status(401).json({ error: 'No token provided' });
        }

    const idToken = authHeader.split('Bearer ')[1];

    // Verify the ID token
    const decodedToken = await fireBaseAuth.verifyIdToken(idToken);
    
    // Add the user info to the request object
    req.user = {
      id: decodedToken.uid,
      email: decodedToken.email || '',
      role: decodedToken.role || 'user'
    };
    
    next();
  } catch (error) {
    console.error('Error verifying auth token:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};
