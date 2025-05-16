import prisma from "../config/prisma.js"
import admin, { fireBaseAuth } from "../config/firebase.js"

export const get = async (req, res) => {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    
    try {
        const users = await fireBaseAuth.listUsers()
        console.log(users);
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: "No token provided" });
        }

        const idToken = authHeader.split('Bearer ')[1];
        
        // Verify the ID token
        const decodedToken = await fireBaseAuth.verifyIdToken(idToken);
        const uid = decodedToken.uid;

        // Get user data from Firebase
        const userRecord = await fireBaseAuth.getUser(uid);
        
        // Get user data from your database if needed
        const dbUser = await prisma.user.findUnique({
            where: { firebaseUid: uid }
        });

        return res.json({ 
            firebaseUser: userRecord,
            dbUser: dbUser
        });
    } catch (error) {
        console.error('Error getting user:', error);
        return res.status(401).json({ error: "Invalid token" });
    }
}